import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dir, "../../.env") });

function parseEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  return !["false", "0", "no", "off", "disabled"].includes(
    value.trim().toLowerCase(),
  );
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://myref:myref@localhost:5432/myref",
  nodeEnv: process.env.NODE_ENV ?? "development",
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  tlsCertPath: process.env.TLS_CERT_PATH ?? "",
  tlsKeyPath: process.env.TLS_KEY_PATH ?? "",
  trustProxy: parseEnabled(process.env.TRUST_PROXY, false),
  sessionDays: 30,
  registrationEnabled: parseEnabled(process.env.REGISTRATION_ENABLED, true),
  sentryDsn: process.env.SENTRY_DSN ?? "",
};
