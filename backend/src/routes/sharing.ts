import { createHash, randomBytes } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { projectMembers, projectShareCodes, projects, users } from "../db/schema";
import { badRequest, HttpError, notFound } from "../lib/http";
import { getOwnedProject } from "../lib/projects";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import { requireUser } from "../lib/session";
import {
  errorResponse,
  memberSchema,
  okSchema,
  shareCodeSchema,
} from "../lib/api-schemas";

function generateShareCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) {
    code += "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[byte! % 30];
  }
  return code;
}

function hashShareCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function normalizeShareCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export const sharingRoutes = new Elysia()
  .post(
    "/projects/:projectId/share-codes",
    async ({ body, params, cookie, request }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));
      const project = await getOwnedProject(user.id, params.projectId);

      const days = body.expiresInDays ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        badRequest("Expiry must be between 1 and 30 days.");
      }

      await db
        .delete(projectShareCodes)
        .where(
          and(
            eq(projectShareCodes.projectId, project.id),
            lte(projectShareCodes.expiresAt, new Date()),
          ),
        );

      const active = await db
        .select({ id: projectShareCodes.id })
        .from(projectShareCodes)
        .where(eq(projectShareCodes.projectId, project.id));
      if (active.length >= 10) {
        throw new HttpError(409, "Too many active share codes.");
      }

      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateShareCode();
        try {
          const [row] = await db
            .insert(projectShareCodes)
            .values({
              projectId: project.id,
              codeHash: hashShareCode(code),
              createdBy: user.id,
              expiresAt,
            })
            .returning({ id: projectShareCodes.id });
          return { code, expiresAt: expiresAt.toISOString(), id: row!.id };
        } catch {
        }
      }
      throw new HttpError(500, "Could not generate a share code.");
    },
    {
      body: t.Object({
        expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      }),
      detail: { summary: "Create share code", tags: ["sharing"] },
      response: t.Object({
        code: t.String(),
        expiresAt: t.String(),
        id: t.String(),
      }),
    },
  )
  .get("/projects/:projectId/share-codes", async ({ params, cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));
    const project = await getOwnedProject(user.id, params.projectId);

    const rows = await db
      .select({
        id: projectShareCodes.id,
        expiresAt: projectShareCodes.expiresAt,
        createdAt: projectShareCodes.createdAt,
      })
      .from(projectShareCodes)
      .where(eq(projectShareCodes.projectId, project.id));

    return { codes: rows };
  }, {
    detail: { summary: "List share codes", tags: ["sharing"] },
    response: t.Object({
      codes: t.Array(shareCodeSchema),
    }),
  })
  .delete(
    "/projects/:projectId/share-codes/:codeId",
    async ({ params, cookie, request }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));
      const project = await getOwnedProject(user.id, params.projectId);

      await db
        .delete(projectShareCodes)
        .where(
          and(
            eq(projectShareCodes.id, params.codeId),
            eq(projectShareCodes.projectId, project.id),
          ),
        );

      return { ok: true };
    }, {
      detail: { summary: "Delete share code", tags: ["sharing"] },
      response: okSchema,
    },
  )
  .post(
    "/share/join",
    async ({ body, cookie, request, server, set }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));

      const limit = checkRateLimit(
        `share-join:${clientIp(request, server, env.trustProxy)}`,
        10,
        10 * 60 * 1000,
      );
      if (!limit.allowed) {
        set.status = 429;
        set.headers["retry-after"] = String(limit.retryAfter);
        return { error: "Too many attempts. Try again later." };
      }

      const code = normalizeShareCode(body.code);
      if (!code) badRequest("Enter a share code.");

      const [share] = await db
        .select()
        .from(projectShareCodes)
        .where(
          and(
            eq(projectShareCodes.codeHash, hashShareCode(code)),
            gt(projectShareCodes.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!share) {
        throw new HttpError(404, "That code is invalid or has expired.");
      }

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, share.projectId))
        .limit(1);
      if (!project) notFound("Project not found.");

      if (project.userId !== user.id) {
        await db
          .insert(projectMembers)
          .values({ projectId: project.id, userId: user.id })
          .onConflictDoNothing();
      }

      return { projectId: project.id };
    },
    {
      body: t.Object({
        code: t.String({ maxLength: 20 }),
      }),
      detail: { summary: "Join project", tags: ["sharing"] },
      response: {
        200: t.Object({
          projectId: t.String(),
        }),
        429: errorResponse,
      },
    },
  )
  .get("/projects/:projectId/members", async ({ params, cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));
    const project = await getOwnedProject(user.id, params.projectId);

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, project.id));

    return { members: rows };
  }, {
    detail: { summary: "List members", tags: ["sharing"] },
    response: t.Object({
      members: t.Array(memberSchema),
    }),
  })
  .delete(
    "/projects/:projectId/members/:userId",
    async ({ params, cookie, request }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));
      const project = await getOwnedProject(user.id, params.projectId);

      await db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, project.id),
            eq(projectMembers.userId, params.userId),
          ),
        );

      return { ok: true };
    }, {
      detail: { summary: "Remove member", tags: ["sharing"] },
      response: okSchema,
    },
  )
  .delete("/projects/:projectId/membership", async ({ params, cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));

    await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, params.projectId),
          eq(projectMembers.userId, user.id),
        ),
      );

    return { ok: true };
  }, {
    detail: { summary: "Leave project", tags: ["sharing"] },
    response: okSchema,
  });
