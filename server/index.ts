import { resolve, sep } from "node:path";
import { analyzeReceipt } from "./inference";
import { readConfig } from "./config";
import { LocalDatabase } from "./db";
import { hasProxyProof, isHealthRequest } from "./proxy";
import { verifiedRoommate } from "./identity";
import { app } from "./app";

const config = readConfig();
const database = new LocalDatabase(config.databasePath);
const migrations = database.migrate();
const bindings = {
  DB: database,
  PROXY_TOKEN: config.proxyToken,
  IDENTITY_MAP: config.identityMappings,
  TRUSTED_ORIGINS: config.trustedOrigins,
  analyzeReceipt: analyzeReceipt,
};
const apiOnly = process.argv.includes("--api-only");
const distDirectory = resolve(import.meta.dir, "../dist");

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(request) {
    if (!isHealthRequest(request) && !hasProxyProof(request, config.proxyToken)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/healthz" || url.pathname.startsWith("/api/")) {
      return app.fetch(request, bindings);
    }
    if (!verifiedRoommate(request, config.proxyToken, config.identityMappings)) {
      return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (apiOnly) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const decodedPath = decodeURIComponent(url.pathname);
    const requestedPath = resolve(distDirectory, `.${decodedPath}`);
    const withinDist = requestedPath === distDirectory || requestedPath.startsWith(`${distDirectory}${sep}`);
    if (withinDist && !decodedPath.endsWith("/")) {
      const asset = Bun.file(requestedPath);
      if (await asset.exists()) {
        return new Response(request.method === "HEAD" ? null : asset, {
          headers: { "Cache-Control": decodedPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" },
        });
      }
    }

    const index = Bun.file(resolve(distDirectory, "index.html"));
    if (!(await index.exists())) {
      return new Response("Frontend build missing. Run `bun run build`.", { status: 503 });
    }
    return new Response(request.method === "HEAD" ? null : index, {
      headers: { "Cache-Control": "no-cache", "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(
  `Flat Web listening on http://${server.hostname}:${server.port}${apiOnly ? " (API only)" : ""}; ${migrations.length} migration(s) applied.`,
);

function shutdown() {
  server.stop();
  database.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
