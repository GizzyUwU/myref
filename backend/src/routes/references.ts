import { Elysia, t } from "elysia";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { encode } from "he";
import sanitize from "sanitize-filename";
import { db } from "../db";
import {
  REFERENCE_TYPES,
  references,
  projects,
  type Author,
  type NewReference,
  type ReferenceType,
} from "../db/schema";
import { loadCslStyle } from "../lib/csl-styles";
import { toBibtex, toRis } from "../lib/export";
import {
  formatBibliography,
  getCachedBibliography,
  invalidateBibliography,
  setCachedBibliography,
  sortReferences,
} from "../lib/format";
import { badRequest, notFound } from "../lib/http";
import { getOwnedProject, isUuid } from "../lib/projects";
import { requireUser } from "../lib/session";

const authorInput = t.Object({
  family: t.String({ maxLength: 300 }),
  given: t.Optional(t.String({ maxLength: 300 })),
});

const referenceInput = t.Object({
  type: t.Optional(t.String({ maxLength: 30 })),
  title: t.Optional(t.String({ maxLength: 1000 })),
  authors: t.Optional(t.Array(authorInput, { maxItems: 100 })),
  editors: t.Optional(t.Array(authorInput, { maxItems: 100 })),
  year: t.Optional(t.String({ maxLength: 20 })),
  containerTitle: t.Optional(t.String({ maxLength: 1000 })),
  publisher: t.Optional(t.String({ maxLength: 500 })),
  place: t.Optional(t.String({ maxLength: 500 })),
  edition: t.Optional(t.String({ maxLength: 100 })),
  volume: t.Optional(t.String({ maxLength: 50 })),
  issue: t.Optional(t.String({ maxLength: 50 })),
  pages: t.Optional(t.String({ maxLength: 100 })),
  doi: t.Optional(t.String({ maxLength: 500 })),
  url: t.Optional(t.String({ maxLength: 2000 })),
  accessedDate: t.Optional(t.Union([t.String({ maxLength: 10 }), t.Null()])),
  publicationDate: t.Optional(t.String({ maxLength: 100 })),
  notes: t.Optional(t.String({ maxLength: 5000 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 50 })),
});

type ReferenceInput = typeof referenceInput.static;
type ReferenceValues = Omit<NewReference, "projectId" | "userId">;

function clean(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function sanitizeAuthors(input: ReferenceInput["authors"]): Author[] {
  return (input ?? [])
    .map((author) => ({
      family: clean(author.family),
      given: clean(author.given),
    }))
    .filter((author) => author.family.length > 0);
}

function normalizeInput(body: ReferenceInput): ReferenceValues {
  const title = clean(body.title);
  if (!title) badRequest("A title is required.");

  const rawType = clean(body.type) || "book";
  const type = (REFERENCE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as ReferenceType)
    : "book";

  const accessedDate = clean(body.accessedDate) || null;
  if (accessedDate && !/^\d{4}-\d{2}-\d{2}$/.test(accessedDate)) {
    badRequest("Accessed date must be a valid date.");
  }

  return {
    type,
    title,
    authors: sanitizeAuthors(body.authors),
    editors: sanitizeAuthors(body.editors),
    year: clean(body.year),
    containerTitle: clean(body.containerTitle),
    publisher: clean(body.publisher),
    place: clean(body.place),
    edition: clean(body.edition),
    volume: clean(body.volume),
    issue: clean(body.issue),
    pages: clean(body.pages),
    doi: clean(body.doi),
    url: clean(body.url),
    accessedDate,
    publicationDate: clean(body.publicationDate),
    notes: clean(body.notes),
    tags: (body.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
  };
}

function filenameFor(name: string): string {
  const safe = sanitize(
    name.trim().replace(/\s+/g, "-").slice(0, 60),
  ).replace(/\s+/g, "-");
  return safe || "references";
}

function escapeHtml(value: string): string {
  return encode(value, { useNamedReferences: true });
}

export const referenceRoutes = new Elysia()
  .get(
    "/projects/:projectId/references",
    async ({ params, query, cookie }) => {
      const user = await requireUser(cookie);
      const project = await getOwnedProject(user.id, params.projectId);

      const conditions: SQL[] = [eq(references.projectId, project.id)];

      const search = (query.q ?? "").trim();
      if (search) {
        const term = `%${search}%`;
        conditions.push(
          sql`(${references.title} ilike ${term} or ${references.containerTitle} ilike ${term} or ${references.authors}::text ilike ${term} or ${references.doi} ilike ${term})`,
        );
      }

      const type = (query.type ?? "").trim();
      if (type && (REFERENCE_TYPES as readonly string[]).includes(type)) {
        conditions.push(eq(references.type, type as ReferenceType));
      }

      const rows = await db
        .select()
        .from(references)
        .where(and(...conditions))
        .orderBy(asc(references.createdAt));

      return { references: rows };
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        type: t.Optional(t.String({ maxLength: 30 })),
      }),
    },
  )
  .post(
    "/projects/:projectId/references",
    async ({ body, params, cookie }) => {
      const user = await requireUser(cookie);
      const project = await getOwnedProject(user.id, params.projectId);
      const values = normalizeInput(body);

      const [reference] = await db
        .insert(references)
        .values({ ...values, projectId: project.id, userId: user.id })
        .returning();

      await db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, project.id));

      invalidateBibliography(project.id);

      return { reference };
    },
    { body: referenceInput },
  )
  .patch(
    "/references/:id",
    async ({ body, params, cookie }) => {
      const user = await requireUser(cookie);
      if (!isUuid(params.id)) notFound("Reference not found.");

      const [existing] = await db
        .select()
        .from(references)
        .where(
          and(eq(references.id, params.id), eq(references.userId, user.id)),
        )
        .limit(1);

      if (!existing) notFound("Reference not found.");

      const values = normalizeInput(body);

      const [reference] = await db
        .update(references)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(references.id, existing.id))
        .returning();

      await db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, existing.projectId));

      invalidateBibliography(existing.projectId);

      return { reference };
    },
    { body: referenceInput },
  )
  .delete("/references/:id", async ({ params, cookie }) => {
    const user = await requireUser(cookie);
    if (!isUuid(params.id)) notFound("Reference not found.");

    const [existing] = await db
      .select()
      .from(references)
      .where(and(eq(references.id, params.id), eq(references.userId, user.id)))
      .limit(1);

    if (!existing) notFound("Reference not found.");

    await db.delete(references).where(eq(references.id, existing.id));
    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, existing.projectId));

    invalidateBibliography(existing.projectId);

    return { ok: true };
  })
  .post(
    "/references/duplicate",
    async ({ body, cookie }) => {
      const user = await requireUser(cookie);
      const target = await getOwnedProject(user.id, body.projectId);

      const ids = [...new Set(body.ids)].filter(isUuid).slice(0, 200);
      if (ids.length === 0) badRequest("Select at least one reference.");

      const rows = await db
        .select()
        .from(references)
        .where(and(inArray(references.id, ids), eq(references.userId, user.id)));

      if (rows.length === 0) notFound("No matching references.");

      const copies = rows.map((row) => {
        const { id, projectId, userId, createdAt, updatedAt, ...fields } = row;
        return { ...fields, projectId: target.id, userId: user.id };
      });

      const created = await db
        .insert(references)
        .values(copies)
        .returning();

      await db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, target.id));

      invalidateBibliography(target.id);

      return { references: created, projectId: target.id };
    },
    {
      body: t.Object({
        ids: t.Array(t.String({ maxLength: 40 }), { maxItems: 200 }),
        projectId: t.String({ maxLength: 40 }),
      }),
    },
  )
  .post(
    "/references/delete",
    async ({ body, cookie }) => {
      const user = await requireUser(cookie);

      const ids = [...new Set(body.ids)].filter(isUuid).slice(0, 200);
      if (ids.length === 0) badRequest("Select at least one reference.");

      const rows = await db
        .select({ id: references.id, projectId: references.projectId })
        .from(references)
        .where(
          and(inArray(references.id, ids), eq(references.userId, user.id)),
        );

      if (rows.length === 0) notFound("No matching references.");

      const foundIds = rows.map((row) => row.id);
      await db
        .delete(references)
        .where(
          and(
            inArray(references.id, foundIds),
            eq(references.userId, user.id),
          ),
        );

      const projectIds = [...new Set(rows.map((row) => row.projectId))];
      for (const projectId of projectIds) {
        await db
          .update(projects)
          .set({ updatedAt: new Date() })
          .where(eq(projects.id, projectId));
        invalidateBibliography(projectId);
      }

      return { deleted: foundIds };
    },
    {
      body: t.Object({
        ids: t.Array(t.String({ maxLength: 40 }), { maxItems: 200 }),
      }),
    },
  )
  .get("/projects/:projectId/bibliography", async ({ params, cookie }) => {
    const user = await requireUser(cookie);
    const project = await getOwnedProject(user.id, params.projectId);

    const rows = await db
      .select()
      .from(references)
      .where(eq(references.projectId, project.id));

    const style = await loadCslStyle(project.styleId);

    const cached = getCachedBibliography(
      project.id,
      project.updatedAt,
      style.id,
    );
    if (cached) return cached;

    const bibliography = formatBibliography(rows, style);
    setCachedBibliography(
      project.id,
      project.updatedAt,
      style.id,
      bibliography,
    );
    return bibliography;
  })
  .get(
    "/projects/:projectId/export",
    async ({ params, query, cookie, set }) => {
      const user = await requireUser(cookie);
      const project = await getOwnedProject(user.id, params.projectId);

      const rows = await db
        .select()
        .from(references)
        .where(eq(references.projectId, project.id));

      const sorted = sortReferences(rows);
      const format = (query.format ?? "text").toLowerCase();
      const filename = filenameFor(project.name);

      if (format === "ris") {
        set.headers["Content-Type"] =
          "application/x-research-info-systems; charset=utf-8";
        set.headers["Content-Disposition"] =
          `attachment; filename="${filename}.ris"`;
        return toRis(sorted);
      }

      if (format === "bibtex" || format === "bib") {
        set.headers["Content-Type"] = "application/x-bibtex; charset=utf-8";
        set.headers["Content-Disposition"] =
          `attachment; filename="${filename}.bib"`;
        return toBibtex(sorted);
      }

      const style = await loadCslStyle(project.styleId);
      const cached = getCachedBibliography(
        project.id,
        project.updatedAt,
        style.id,
      );
      const bibliography = cached ?? formatBibliography(rows, style);
      if (!cached) {
        setCachedBibliography(
          project.id,
          project.updatedAt,
          style.id,
          bibliography,
        );
      }
      const entries = bibliography.entries;

      if (format === "html") {
        const items = entries
          .map((entry) => `      <li>${entry.html}</li>`)
          .join("\n");
        const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(project.name)} — References</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; max-width: 820px; margin: 48px auto; padding: 0 24px; color: #1a1a1a; }
      h1 { font-size: 1.6rem; margin-bottom: 4px; }
      .meta { color: #666; margin-top: 0; }
      li { margin-bottom: 1.1rem; }
      .csl-left-margin { display: inline; margin-right: 0.5em; }
      .csl-right-inline { display: inline; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="meta">${escapeHtml(bibliography.style)}</p>
    <ul>
${items}
    </ul>
  </body>
</html>`;

        set.headers["Content-Type"] = "text/html; charset=utf-8";
        set.headers["Content-Disposition"] =
          `attachment; filename="${filename}.html"`;
        return html;
      }

      if (format !== "text") {
        badRequest("Unknown export format.");
      }

      set.headers["Content-Type"] = "text/plain; charset=utf-8";
      set.headers["Content-Disposition"] =
        `attachment; filename="${filename}.txt"`;
      return entries.map((entry) => entry.plain).join("\n\n") + "\n";
    },
    {
      query: t.Object({
        format: t.Optional(t.String({ maxLength: 20 })),
      }),
    },
  );
