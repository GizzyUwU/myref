import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { projects, users } from "../db/schema";
import { badRequest, HttpError } from "../lib/http";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../lib/password";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import {
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  getSessionUser,
  publicUser,
  setSessionCookie,
} from "../lib/session";

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
  .get("/me", async ({ cookie }) => {
    const user = await getSessionUser(cookie);
    return { user: user ? publicUser(user) : null };
  })
  .get("/config", () => ({
    registrationEnabled: env.registrationEnabled,
  }))
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
      if (password.length > 128) {
        badRequest("Password must be 128 characters or fewer.");
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
      setSessionCookie(cookie, token);

      return { user: publicUser(created) };
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
        password: t.String({ maxLength: 200 }),
      }),
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

      // Always run a bcrypt comparison — against a dummy hash when the
      // account doesn't exist — so timing can't reveal registered accounts.
      const passwordOk = await verifyPassword(
        body.password,
        user ? user.passwordHash : DUMMY_PASSWORD_HASH,
      );

      if (!user || !passwordOk) {
        throw new HttpError(401, "Incorrect username or password.");
      }

      const token = await createSession(user.id);
      setSessionCookie(cookie, token);

      return { user: publicUser(user) };
    },
    {
      body: t.Object({
        username: t.String({ maxLength: 30 }),
        password: t.String({ maxLength: 200 }),
      }),
    },
  )
  .post("/logout", async ({ cookie }) => {
    await destroySession(cookie);
    clearSessionCookie(cookie);
    return { ok: true };
  })
  .patch(
    "/username",
    async ({ cookie, body }) => {
      const user = await getSessionUser(cookie);
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
    },
  )
  .post(
    "/change-password",
    async ({ cookie, body }) => {
      const user = await getSessionUser(cookie);
      if (!user) throw new HttpError(401, "Not authenticated.");

      const currentPassword = body.currentPassword;
      const newPassword = body.newPassword;

      if (newPassword.length < 8) {
        badRequest("New password must be at least 8 characters.");
      }
      if (newPassword.length > 128) {
        badRequest("New password must be 128 characters or fewer.");
      }

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        throw new HttpError(401, "Current password is incorrect.");
      }

      const passwordHash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash }).where(sql`${users.id} = ${user.id}`);

      // Revoke every other session so a stolen session can't survive this change.
      await destroyOtherSessions(cookie, user.id);

      return { ok: true };
    },
    {
      body: t.Object({
        currentPassword: t.String({ maxLength: 200 }),
        newPassword: t.String({ maxLength: 200 }),
      }),
    },
  )
  .post(
    "/delete-account",
    async ({ cookie, body }) => {
      const user = await getSessionUser(cookie);
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
    },
  );
