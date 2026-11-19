import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import { env } from "./env";
import { HttpError } from "./lib/http";
import { initSentry, reportError } from "./lib/sentry";
import { extensionOriginPatterns } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { lookupRoutes } from "./routes/lookup";
import { projectRoutes } from "./routes/projects";
import { referenceRoutes } from "./routes/references";
import { sharingRoutes } from "./routes/sharing";
import { styleRoutes } from "./routes/styles";

initSentry();

const app = new Elysia()
  .use(
    cors({
      origin: [env.appOrigin, ...extensionOriginPatterns],
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  )
  .onError(({ code, error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }

    if (code === "VALIDATION") {
      set.status = 422;
      return { error: "Please check the form and try again." };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Not found." };
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      set.status = 409;
      return { error: "That value is already in use." };
    }

    console.error(error);
    reportError(error);
    set.status = 500;
    return { error: "Something went wrong. Please try again." };
  })
  .get("/api/health", () => ({
    ok: true,
    service: "myref-api",
  }), {
    detail: { summary: "Health check", tags: ["auth"] },
    response: t.Object({
      ok: t.Boolean(),
      service: t.String(),
    }),
  })
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .use(projectRoutes)
      .use(referenceRoutes)
      .use(sharingRoutes)
      .use(styleRoutes)
      .use(lookupRoutes),
  );

if (!env.isProduction) {
  app.use(
    swagger({
      path: "/api/docs",
      scalarConfig: {
        spec: { url: "/api/docs/json" },
      },
      documentation: {
        info: {
          title: "MyRef API",
          version: "1.0.0",
          description:
            "Reference manager API. Browser extension flow: POST /api/auth/token with username+password to mint a Bearer token, then send Authorization: Bearer myref_... on every call. See /api/docs/extension for the step-by-step guide.",
        },
        tags: [
          { name: "auth", description: "Login, sessions and API tokens" },
          { name: "projects", description: "Projects owned or shared" },
          { name: "references", description: "References, bibliography and export" },
          { name: "sharing", description: "Share codes and members" },
          { name: "styles", description: "CSL citation styles" },
          { name: "lookup", description: "DOI / ISBN / URL metadata lookup" },
          { name: "extension", description: "How the browser extension uses this API" },
        ],
      },
    }),
  );

app.get("/api/docs/extension", () => ({
    name: "Browser extension integration",
    auth: {
      mintToken: "POST /api/auth/token { username, password, name? } -> { token: { token } }",
      header: "Authorization: Bearer myref_...",
      validate: "GET /api/auth/me -> { user, tokenId }",
      disconnect: "DELETE /api/auth/token revokes the calling token",
    },
    syncOrder: [
      "GET /api/projects",
      "GET /api/projects/:projectId/references per project",
      "POST /api/projects/:projectId/references for local-only rows",
      "PATCH /api/references/:id and DELETE /api/references/:id for local changes",
      "GET /api/styles?q=&limit= then GET /api/styles/:id to cache CSL XML for offline rendering",
    ],
    capture: [
      "GET /api/lookup/doi?doi=",
      "GET /api/lookup/isbn?isbn=",
      "GET /api/lookup/url?url=",
    ],
    notes: [
      "Tokens are long-lived. Store the token, never the password.",
      "Token auth takes precedence over the myref_session cookie.",
      "All non-auth endpoints accept the same Bearer header.",
      "Rate limits answer 429 with a Retry-After header.",
    ],
    endpoints: app.routes
      .filter((route) => route.path.startsWith("/api/") && !route.path.startsWith("/api/docs"))
      .map((route) => ({ method: route.method, path: route.path })),
  }), {
    detail: {
      summary: "Extension guide",
      description: "Sync flow plus every API endpoint the extension can call, generated from the live router.",
      tags: ["extension"],
    },
    response: t.Object({
      name: t.String(),
      auth: t.Object({
        mintToken: t.String(),
        header: t.String(),
        validate: t.String(),
        disconnect: t.String(),
      }),
      syncOrder: t.Array(t.String()),
      capture: t.Array(t.String()),
      notes: t.Array(t.String()),
      endpoints: t.Array(t.Object({
        method: t.String(),
        path: t.String(),
      })),
    }),
  });
}

const distDir = resolve(import.meta.dir, "../../frontend/dist");

if (existsSync(join(distDir, "index.html"))) {
  app.get("/*", async ({ request, set }) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      set.status = 404;
      return { error: "Not found." };
    }

    if (pathname === "/") pathname = "/index.html";

    const filePath = normalize(join(distDir, pathname));
    if (!filePath.startsWith(distDir)) {
      set.status = 403;
      return "Forbidden";
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      const immutable = pathname.startsWith("/assets/");
      return new Response(file, {
        headers: {
          "Cache-Control": immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    }

    const index = Bun.file(join(distDir, "index.html"));
    return new Response(index, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
}

const certConfigured = Boolean(env.tlsCertPath || env.tlsKeyPath);
const certExists = env.tlsCertPath ? existsSync(env.tlsCertPath) : false;
const keyExists = env.tlsKeyPath ? existsSync(env.tlsKeyPath) : false;
const useTls = Boolean(env.tlsCertPath && env.tlsKeyPath) && certExists && keyExists;

if (certConfigured && !useTls) {
  const missing = [
    !certExists ? `cert not found: ${env.tlsCertPath || "(unset)"}` : null,
    !keyExists ? `key not found: ${env.tlsKeyPath || "(unset)"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (env.trustProxy) {
    console.warn(
      `TLS paths configured but files missing (${missing}); ` +
        `TRUST_PROXY=true, falling back to plain HTTP behind the proxy. ` +
        `To terminate TLS directly, mount valid certs. To silence this, set TLS_CERT_PATH= and TLS_KEY_PATH= empty.`,
    );
  } else {
    throw new Error(
      `TLS misconfigured (${missing}): set both TLS_CERT_PATH and TLS_KEY_PATH ` +
        `to valid files, or set TRUST_PROXY=true with both empty when behind a TLS-terminating reverse proxy.`,
    );
  }
}

if (env.isProduction && !useTls && !env.trustProxy) {
  throw new Error(
    "Refusing to serve production traffic over plain HTTP: set TLS_CERT_PATH " +
      "and TLS_KEY_PATH to terminate TLS directly, or set TRUST_PROXY=true " +
      "when running behind a TLS-terminating reverse proxy.",
  );
}

if (useTls) {
  app.listen({
    port: env.port,
    tls: {
      cert: Bun.file(env.tlsCertPath),
      key: Bun.file(env.tlsKeyPath),
    },
  });
} else {
  app.listen(env.port);
}

console.log(
  `MyRef API listening on ${useTls ? "https" : "http"}://localhost:${env.port} (${env.nodeEnv})`,
);
