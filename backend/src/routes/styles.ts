import { Elysia, t } from "elysia";
import { loadCslStyle, searchCslStyles } from "../lib/csl-styles";
import { requireUser } from "../lib/session";
import { styleDetailSchema, styleSummarySchema } from "../lib/api-schemas";

export const styleRoutes = new Elysia({ prefix: "/styles" })
  .get(
    "/",
    async ({ query, cookie, request }) => {
      await requireUser(cookie, request.headers.get("authorization"));
      const styles = await searchCslStyles(
        query.q ?? "",
        query.limit === undefined
          ? undefined
          : Number.parseInt(query.limit, 10),
      );
      return { styles };
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        limit: t.Optional(t.String({ maxLength: 5 })),
      }),
      detail: {
        summary: "Search styles",
        description: "Search the Zotero CSL catalogue. Extension caches results for offline use.",
        tags: ["styles"],
      },
      response: t.Object({
        styles: t.Array(styleSummarySchema),
      }),
    },
  )
  .get(
    "/:id",
    async ({ params, cookie, request }) => {
      await requireUser(cookie, request.headers.get("authorization"));
      const style = await loadCslStyle(params.id);
      return {
        id: style.id,
        title: style.title,
        xml: style.xml,
        sourceUrl: style.sourceUrl,
        locales: style.locales,
      };
    },
    {
      params: t.Object({
        id: t.String({ maxLength: 200 }),
      }),
      detail: {
        summary: "Get style XML",
        description: "Full CSL XML plus locales for clients that render with citeproc themselves, like the offline extension.",
        tags: ["styles"],
      },
      response: styleDetailSchema,
    },
  );
