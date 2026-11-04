import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
config({ path: envPath });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://myref:myref@localhost:5432/myref",
  },
  verbose: true,
  strict: false,
});
