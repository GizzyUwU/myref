import { existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./env";
import { defaultStyleTitle } from "./lib/csl-defaults";
import { HttpError } from "./lib/http";
import { initSentry, reportError } from "./lib/sentry";
import { authRoutes } from "./routes/auth";
import { lookupRoutes } from "./routes/lookup";
import { projectRoutes } from "./routes/projects";
import { referenceRoutes } from "./routes/references";
import { styleRoutes } from "./routes/styles";

initSentry();

const app = new Elysia()
  .use(
    cors({
      origin: env.appOrigin,
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
    style: defaultStyleTitle,
  }))
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .use(projectRoutes)
      .use(referenceRoutes)
      .use(styleRoutes)
      .use(lookupRoutes),
  );

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
      // Vite emits content-hashed filenames under /assets/: safe to cache
      // for a year. HTML entry points must revalidate for fresh deploys.
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

const useTls = Boolean(env.tlsCertPath && env.tlsKeyPath);

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