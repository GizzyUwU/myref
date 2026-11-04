import { Elysia, t } from "elysia";
import { searchCslStyles } from "../lib/csl-styles";
import { requireUser } from "../lib/session";

export const styleRoutes = new Elysia({ prefix: "/styles" }).get(
  "/",
  async ({ query, cookie }) => {
    await requireUser(cookie);
    const limit = Number.parseInt(query.limit ?? "30", 10);
    const styles = await searchCslStyles(query.q ?? "", limit);
    return { styles };
  },
  {
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 200 })),
      limit: t.Optional(t.String({ maxLength: 3 })),
    }),
  },
);
