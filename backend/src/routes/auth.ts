import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { projects, users } from "../db/schema";
import { badRequest, HttpError, notFound } from "../lib/http";
import { isUuid } from "../lib/projects";
import { hashPassword, verifyPassword, verifyPasswordSafe } from "../lib/password";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import {
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  getAuthInfo,
  getSessionUser,
  isExtensionOrigin,
  publicUser,
  requireUser,
  setSessionCookie,
} from "../lib/session";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  revokeCurrentToken,
} from "../lib/tokens";
import {
  errorResponse,
  meResponse,
  okSchema,
  tokenResponse,
  tokensResponse,
  userResponse,
} from "../lib/api-schemas";

function assertValidUsername(username: string): void {
  if (username.length < 3 || username.length > 30) {
    badRequest(
      "Username must be 3-30 characters using only letters, numbers or underscores.",
    );
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    badRequest(
      "Username must be 3-30 characters using only letters, numbers or underscores.",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/me", async ({ cookie, request }) => {
    const info = await getAuthInfo(
      cookie,
      request.headers.get("authorization"),
    );
    return {
      user: info.user ? publicUser(info.user) : null,
      tokenId: info.tokenId,
    };
  }, {
    detail: {
      summary: "Current session",
      description: "Returns the signed-in user. Used by the extension validateToken() call.",
      tags: ["auth"],
    },
    response: meResponse,
  })
  .get("/config", () => ({
    registrationEnabled: env.registrationEnabled,
  }), {
    detail: { summary: "Public config", tags: ["auth"] },
    response: t.Object({
      registrationEnabled: t.Boolean(),
    }),
  })
  .post(
    "/register",
    async ({ body, cookie, request, server, set }) => {
      if (!env.registrationEnabled) {
        throw new HttpError(403, "Registration is disabled.");
      }

      const limit = checkRateLimit(
        `register:${clientIp(request, server, env.trustProxy)}`,
        10,
        60 * 60 * 1000,
      );
      if (!limit.allowed) {
        set.status = 429;
        set.headers["retry-after"] = String(limit.retryAfter);
        return { error: "Too many attempts. Try again later." };
      }

      const username = body.username.trim();
      const password = body.password;

      assertValidUsername(username);
      if (password.length < 8) {
        badRequest("Password must be at least 8 characters.");
      }
      if (Buffer.byteLength(password, "utf8") > 72) {
        badRequest("Password must be 72 characters or fewer.");
      }

      const existing = await db
        .select({ username: users.username })
        .from(users)
        .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
        .limit(1);

      if (existing.length > 0) {
        throw new HttpError(409, "That username is already taken.");
      }

      const passwordHash = await hashPassword(password);

      let created;
      try {
        created = await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({ username, passwordHash })
            .returning();

          if (!user) throw new HttpError(500, "Could not create account.");

          await tx.insert(projects).values({
            userId: user.id,
            name: "My References",
            description: "Your default referencing project.",
          });

          return user;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, "That username is already taken.");
        }
        throw error;
      }

      const token = await createSession(created.id);
      setSessionCookie(cookie, token, {
        crossSite: isExtensionOrigin(request.headers.get("origin")),
      });

      return { user: publicUser(created) };
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
        password: t.String({ maxLength: 200 }),
      }),
      detail: { summary: "Register", tags: ["auth"] },
      response: {
        200: userResponse,
        429: errorResponse,
      },
    },
  )
  .post(
    "/login",
    async ({ body, cookie, request, server, set }) => {
      const limit = checkRateLimit(
        `login:${clientIp(request, server, env.trustProxy)}`,
        10,
        10 * 60 * 1000,
      );
      if (!limit.allowed) {
        set.status = 429;
        set.headers["retry-after"] = String(limit.retryAfter);
        return { error: "Too many attempts. Try again later." };
      }

      const username = body.username.trim().toLowerCase();
      if (!username) badRequest("Enter your username.");

      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.username}) = ${username}`)
        .limit(1);

      const passwordOk = await verifyPasswordSafe(
        body.password,
        user?.passwordHash,
      );

      if (!user || !passwordOk) {
        throw new HttpError(401, "Incorrect username or password.");
      }

      const token = await createSession(user.id);
      setSessionCookie(cookie, token, {
        crossSite: isExtensionOrigin(request.headers.get("origin")),
      });

      return { user: publicUser(user) };
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
        password: t.String({ maxLength: 200 }),
      }),
      detail: { summary: "Login", tags: ["auth"] },
      response: {
        200: userResponse,
        429: errorResponse,
      },
    },
  )
  .post("/logout", async ({ cookie }) => {
    await destroySession(cookie);
    clearSessionCookie(cookie);
    return { ok: true };
  }, {
    detail: { summary: "Logout", tags: ["auth"] },
    response: okSchema,
  })
  .post(
    "/token",
    async ({ body, request, server, set }) => {
      const limit = checkRateLimit(
        `api-token:${clientIp(request, server, env.trustProxy)}`,
        10,
        10 * 60 * 1000,
      );
      if (!limit.allowed) {
        set.status = 429;
        set.headers["retry-after"] = String(limit.retryAfter);
        return { error: "Too many attempts. Try again later." };
      }

      const username = body.username.trim().toLowerCase();
      if (!username) badRequest("Enter your username.");

      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.username}) = ${username}`)
        .limit(1);

      const passwordOk = await verifyPasswordSafe(
        body.password,
        user?.passwordHash,
      );

      if (!user || !passwordOk) {
        throw new HttpError(401, "Incorrect username or password.");
      }

      const token = await createApiToken(
        user.id,
        body.name?.trim() || "Browser extension",
      );
      return { token };
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
        password: t.String({ maxLength: 200 }),
        name: t.Optional(t.String({ maxLength: 100 })),
      }),
      detail: {
        summary: "Mint API token",
        description: "Extension login: exchange username+password for a long-lived Bearer token. The extension stores only this token.",
        tags: ["auth"],
      },
      response: {
        200: tokenResponse,
        429: errorResponse,
      },
    },
  )
  .get("/tokens", async ({ cookie, request }) => {
    const user = await requireUser(
      cookie,
      request.headers.get("authorization"),
    );
    return { tokens: await listApiTokens(user.id) };
  }, {
    detail: { summary: "List API tokens", tags: ["auth"] },
    response: tokensResponse,
  })
  .post(
    "/tokens",
    async ({ body, cookie, request }) => {
      const user = await requireUser(
        cookie,
        request.headers.get("authorization"),
      );
      const token = await createApiToken(
        user.id,
        body.name?.trim() || "Browser extension",
      );
      return { token };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 100 })),
      }),
      detail: { summary: "Create API token", tags: ["auth"] },
      response: tokenResponse,
    },
  )
  .delete("/token", async ({ cookie, request }) => {
    const revoked = await revokeCurrentToken(
      request.headers.get("authorization"),
    );
    if (!revoked) notFound("Token not found.");
    return { ok: true };
  }, {
    detail: {
      summary: "Revoke current token",
      description: "Extension disconnect: revokes the Bearer token used for this request.",
      tags: ["auth"],
    },
    response: okSchema,
  })
  .delete("/tokens/:id", async ({ cookie, params, request }) => {
    const user = await requireUser(
      cookie,
      request.headers.get("authorization"),
    );
    if (!isUuid(params.id)) notFound("Token not found.");
    const revoked = await revokeApiToken(user.id, params.id);
    if (!revoked) notFound("Token not found.");
    return { ok: true };
  }, {
    detail: { summary: "Revoke API token", tags: ["auth"] },
    response: okSchema,
  })
  .patch(
    "/username",
    async ({ cookie, body, request }) => {
      const user = await getSessionUser(
        cookie,
        request.headers.get("authorization"),
      );
      if (!user) throw new HttpError(401, "Not authenticated.");

      const username = body.username.trim();
      assertValidUsername(username);

      if (username.toLowerCase() === user.username.toLowerCase()) {
        if (username === user.username) return { user: publicUser(user) };
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
        .limit(1);

      if (existing.length > 0 && existing[0]!.id !== user.id) {
        throw new HttpError(409, "That username is already taken.");
      }

      try {
        const [updated] = await db
          .update(users)
          .set({ username })
          .where(eq(users.id, user.id))
          .returning();
        if (!updated) throw new HttpError(500, "Could not update username.");
        return { user: publicUser(updated) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, "That username is already taken.");
        }
        throw error;
      }
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
      }),
      detail: { summary: "Rename user", tags: ["auth"] },
      response: userResponse,
    },
  )
  .post(
    "/change-password",
    async ({ cookie, body, request }) => {
      const user = await getSessionUser(
        cookie,
        request.headers.get("authorization"),
      );
      if (!user) throw new HttpError(401, "Not authenticated.");

      const currentPassword = body.currentPassword;
      const newPassword = body.newPassword;

      if (newPassword.length < 8) {
        badRequest("New password must be at least 8 characters.");
      }
      if (Buffer.byteLength(newPassword, "utf8") > 72) {
        badRequest("New password must be 72 characters or fewer.");
      }

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        throw new HttpError(401, "Current password is incorrect.");
      }

      const passwordHash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash }).where(sql`${users.id} = ${user.id}`);

      await destroyOtherSessions(
        cookie,
        user.id,
        request.headers.get("authorization"),
      );

      return { ok: true };
    },
    {
      body: t.Object({
        currentPassword: t.String({ maxLength: 200 }),
        newPassword: t.String({ maxLength: 200 }),
      }),
      detail: { summary: "Change password", tags: ["auth"] },
      response: okSchema,
    },
  )
  .post(
    "/delete-account",
    async ({ cookie, body, request }) => {
      const user = await getSessionUser(
        cookie,
        request.headers.get("authorization"),
      );
      if (!user) throw new HttpError(401, "Not authenticated.");

      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) {
        throw new HttpError(401, "Password is incorrect.");
      }

      await db.delete(users).where(sql`${users.id} = ${user.id}`);
      await destroySession(cookie);
      clearSessionCookie(cookie);
      return { ok: true };
    },
    {
      body: t.Object({
        password: t.String({ maxLength: 200 }),
      }),
      detail: { summary: "Delete account", tags: ["auth"] },
      response: okSchema,
    },
  );
