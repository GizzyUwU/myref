import * as Sentry from "@sentry/bun";
import { env } from "../env";

let initialized = false;

/** Initialize Sentry only when a DSN is configured, so local/dev runs pay
 *  zero overhead. Tracing and session tracking stay off: we report error
 *  events only, which are rare and sent on a background thread. */
export function initSentry(): void {
  if (initialized || !env.sentryDsn) return;
  initialized = true;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    debug: false,
    // No performance tracing: adds per-request span overhead for data we
    // don't need. Error events still include a stack trace and context.
    tracesSampleRate: 0,
    // Skip extra background traffic (session envelopes, client reports).
    sendClientReports: false,
  });
}

/** Fire-and-forget: Sentry flushes on its own schedule, so callers must
 *  never await this on the request path. No-op when Sentry is disabled. */
export function reportError(error: unknown): void {
  if (!initialized) return;
  Sentry.captureException(error);
}
