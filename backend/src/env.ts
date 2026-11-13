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
  trustProxy: ["true", "1", "yes", "on", "enabled"].includes(
    (process.env.TRUST_PROXY ?? "").trim().toLowerCase(),
  ),
  sessionDays: 30,
  registrationEnabled: registrationEnabled(),
  extensionOrigins: (process.env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  sentryDsn: process.env.SENTRY_DSN ?? "",
};

function registrationEnabled(): boolean {
  const configured = (process.env.REGISTRATION_ENABLED ?? "").trim();
  if (!configured)
    return (process.env.NODE_ENV ?? "development") !== "production";
  return parseEnabled(configured, true);
}
