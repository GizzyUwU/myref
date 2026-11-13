import { Elysia, t } from "elysia";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { projectMembers, projects, references, users } from "../db/schema";
import { loadCslStyle } from "../lib/csl-styles";
import { badRequest } from "../lib/http";
import { getAccessibleProject, getOwnedProject } from "../lib/projects";
import { invalidateBibliography } from "../lib/format";
import { requireUser } from "../lib/session";
import {
  okSchema,
  projectSchema,
  projectWithMetaSchema,
} from "../lib/api-schemas";

export const projectRoutes = new Elysia({ prefix: "/projects" })
  .get("/", async ({ cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));

    const owned = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        styleId: projects.styleId,
        styleTitle: projects.styleTitle,
        styleSource: projects.styleSource,
        fontFamily: projects.fontFamily,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        referenceCount: sql<number>`count(${references.id})::int`,
      })
      .from(projects)
      .leftJoin(references, eq(references.projectId, projects.id))
      .where(eq(projects.userId, user.id))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));

    const shared = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        styleId: projects.styleId,
        styleTitle: projects.styleTitle,
        styleSource: projects.styleSource,
        fontFamily: projects.fontFamily,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        referenceCount: sql<number>`count(${references.id})::int`,
        ownerUsername: users.username,
      })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, user.id),
        ),
      )
      .innerJoin(users, eq(users.id, projects.userId))
      .leftJoin(references, eq(references.projectId, projects.id))
      .groupBy(projects.id, users.username)
      .orderBy(desc(projects.updatedAt));

    const all = [
      ...owned.map((row) => ({
        ...row,
        role: "owner" as const,
        ownerUsername: user.username,
      })),
      ...shared.map((row) => ({ ...row, role: "member" as const })),
    ].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    return { projects: all };
  }, {
    detail: {
      summary: "List projects",
      description: "Owned plus shared projects. Extension sync pulls this first.",
      tags: ["projects"],
    },
    response: t.Object({
      projects: t.Array(projectWithMetaSchema),
    }),
  })
  .get("/:projectId", async ({ params, cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));
    const { project, role } = await getAccessibleProject(
      user.id,
      params.projectId,
    );

    const [owner] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, project.userId))
      .limit(1);

    const [row] = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        styleId: projects.styleId,
        styleTitle: projects.styleTitle,
        styleSource: projects.styleSource,
        fontFamily: projects.fontFamily,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        referenceCount: sql<number>`count(${references.id})::int`,
      })
      .from(projects)
      .leftJoin(references, eq(references.projectId, projects.id))
      .where(eq(projects.id, project.id))
      .groupBy(projects.id)
      .limit(1);

    const base = row ?? { ...project, referenceCount: 0 };
    return {
      project: {
        ...base,
        role,
        ownerUsername: owner?.username ?? "",
      },
    };
  }, {
    detail: { summary: "Get project", tags: ["projects"] },
    response: t.Object({
      project: projectWithMetaSchema,
    }),
  })
  .post(
    "/",
    async ({ body, cookie, request }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));
      const name = body.name.trim();
      const description = (body.description ?? "").trim();

      if (!name) badRequest("Give your project a name.");
      if (name.length > 120) badRequest("Project names must be 120 characters or fewer.");

      const [project] = await db
        .insert(projects)
        .values({ userId: user.id, name, description })
        .returning();

      return {
        project: {
          ...project,
          referenceCount: 0,
          role: "owner" as const,
          ownerUsername: user.username,
        },
      };
    },
    {
      body: t.Object({
        name: t.String({ maxLength: 120 }),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
      detail: {
        summary: "Create project",
        description: "Extension push creates missing projects with this endpoint.",
        tags: ["projects"],
      },
      response: t.Object({
        project: projectWithMetaSchema,
      }),
    },
  )
  .patch(
    "/:projectId",
    async ({ body, params, cookie, request }) => {
      const user = await requireUser(cookie, request.headers.get("authorization"));
      const project = await getOwnedProject(user.id, params.projectId);

      const updates: {
        name?: string;
        description?: string;
        styleId?: string;
        styleTitle?: string;
        styleSource?: string;
        fontFamily?: string;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (body.name !== undefined) {
        const name = body.name.trim();
        if (!name) badRequest("Give your project a name.");
        if (name.length > 120) badRequest("Project names must be 120 characters or fewer.");
        updates.name = name;
      }

      if (body.description !== undefined) {
        updates.description = body.description.trim().slice(0, 500);
      }

      if (body.styleId !== undefined) {
        const style = await loadCslStyle(body.styleId);
        updates.styleId = style.id;
        updates.styleTitle = style.title;
        updates.styleSource = style.sourceUrl;
      }

      if (body.fontFamily !== undefined) {
        const font = body.fontFamily.trim().slice(0, 200);
        if (!font) badRequest("Choose a font.");
        updates.fontFamily = font;
      }

      if (
        body.name === undefined &&
        body.description === undefined &&
        body.styleId === undefined &&
        body.fontFamily === undefined
      ) {
        badRequest("Nothing to update.");
      }

      const [updated] = await db
        .update(projects)
        .set(updates)
        .where(eq(projects.id, project.id))
        .returning();

      invalidateBibliography(project.id);

      return { project: updated };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 120 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        styleId: t.Optional(t.String({ maxLength: 200 })),
        fontFamily: t.Optional(t.String({ maxLength: 200 })),
      }),
      detail: { summary: "Update project", tags: ["projects"] },
      response: t.Object({
        project: projectSchema,
      }),
    },
  )
  .delete("/:projectId", async ({ params, cookie, request }) => {
    const user = await requireUser(cookie, request.headers.get("authorization"));
    const project = await getOwnedProject(user.id, params.projectId);

    await db.delete(projects).where(eq(projects.id, project.id));

    return { ok: true };
  }, {
    detail: { summary: "Delete project", tags: ["projects"] },
    response: okSchema,
  });
