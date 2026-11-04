import { Elysia, t } from "elysia";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { projects, references } from "../db/schema";
import { loadCslStyle } from "../lib/csl-styles";
import { badRequest } from "../lib/http";
import { getOwnedProject } from "../lib/projects";
import { requireUser } from "../lib/session";

export const projectRoutes = new Elysia({ prefix: "/projects" })
  .get("/", async ({ cookie }) => {
    const user = await requireUser(cookie);

    const rows = await db
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

    return { projects: rows };
  })
  .get("/:projectId", async ({ params, cookie }) => {
    const user = await requireUser(cookie);
    const project = await getOwnedProject(user.id, params.projectId);

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

    return { project: row ?? { ...project, referenceCount: 0 } };
  })
  .post(
    "/",
    async ({ body, cookie }) => {
      const user = await requireUser(cookie);
      const name = body.name.trim();
      const description = (body.description ?? "").trim();

      if (!name) badRequest("Give your project a name.");
      if (name.length > 120) badRequest("Project names must be 120 characters or fewer.");

      const [project] = await db
        .insert(projects)
        .values({ userId: user.id, name, description })
        .returning();

      return { project: { ...project, referenceCount: 0 } };
    },
    {
      body: t.Object({
        name: t.String({ maxLength: 120 }),
        description: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  .patch(
    "/:projectId",
    async ({ body, params, cookie }) => {
      const user = await requireUser(cookie);
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

      return { project: updated };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 120 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        styleId: t.Optional(t.String({ maxLength: 200 })),
        fontFamily: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )
  .delete("/:projectId", async ({ params, cookie }) => {
    const user = await requireUser(cookie);
    const project = await getOwnedProject(user.id, params.projectId);

    await db.delete(projects).where(eq(projects.id, project.id));

    return { ok: true };
  });
