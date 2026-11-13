import * as Sentry from "@sentry/bun";
import { env } from "../env";

let initialized = false;

export function initSentry(): void {
  if (initialized || !env.sentryDsn) return;
  initialized = true;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    debug: false,
    tracesSampleRate: 0,
    sendClientReports: false,
  });
}

export function reportError(error: unknown): void {
  if (!initialized) return;
  Sentry.captureException(error);
}
