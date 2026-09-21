// Local test-only cookie gate. Never part of the app server or production build.
// Browser-owned manifest/worker requests must prove cookie handling, not rely on
// Playwright extraHTTPHeaders (which do not model Authentik browser sessions).
const upstream = new URL(process.env.E2E_BACKEND_URL!);
const port = Number(process.env.E2E_PWA_PORT);
if (process.env.FLAT_E2E_GATEWAY !== "synthetic-only" || upstream.hostname !== "127.0.0.1" ||
    Number(upstream.port) < 1024 || upstream.port === "8787" || !Number.isInteger(port) || port < 1024 || port === 8787) {
  throw new Error("PWA fixture requires an isolated loopback backend and port");
}
let scriptMode = "v1";
let navigationStatus = 200;
let mutationRequests = 0;
let scriptRequests = 0;
let manifestCookieRequests = 0;
const noStore = { "Cache-Control": "no-store" };
const loginPage = () => new Response("<!doctype html><html><title>Fixture login</title><h1>Synthetic sign-in</h1></html>", {
  headers: { ...noStore, "Content-Type": "text/html" },
});

Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/__test/health") return new Response("ok");
  if (url.pathname === "/__test/login") return new Response("fixture session", {
    headers: { ...noStore, "Set-Cookie": "pwa_fixture=authenticated; HttpOnly; SameSite=Lax; Path=/" },
  });
  if (url.pathname === "/__test/expire") return new Response("expired", {
    headers: { ...noStore, "Set-Cookie": "pwa_fixture=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" },
  });
  if (url.pathname === "/__test/state") {
    if (request.method === "POST") {
      const state = await request.json();
      if (state.reset) {
        scriptMode = "v1"; navigationStatus = 200; mutationRequests = 0; scriptRequests = 0; manifestCookieRequests = 0;
      }
      if (state.scriptMode) scriptMode = state.scriptMode;
      if (state.navigationStatus) navigationStatus = state.navigationStatus;
    }
    return Response.json({ scriptMode, navigationStatus, mutationRequests, scriptRequests, manifestCookieRequests }, { headers: noStore });
  }
  if (url.pathname === "/outpost.goauthentik.io/start") return loginPage();
  if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method)) mutationRequests++;
  if (url.pathname === "/sw.js") scriptRequests++;
  const authenticated = request.headers.get("cookie")?.split("; ").includes("pwa_fixture=authenticated");
  if (!authenticated || (url.pathname === "/sw.js" && scriptMode === "redirect")) {
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Authentication required" }, { status: 401, headers: noStore });
    return new Response(null, { status: 302, headers: { ...noStore, Location: "/outpost.goauthentik.io/start" } });
  }
  if (url.pathname === "/" && navigationStatus !== 200) return new Response("Gate response", { status: navigationStatus, headers: noStore });
  if (url.pathname === "/sw.js" && scriptMode === "html") return loginPage();
  if (url.pathname === "/sw.js" && scriptMode === "401") return new Response("Unauthorized", { status: 401, headers: noStore });
  if (url.pathname === "/manifest.webmanifest") manifestCookieRequests++;
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.set("X-Flat-Proxy-Token", "a".repeat(64));
  headers.set("X-Flat-Email", "owner@example.test");
  headers.set("X-Flat-Uid", "fixture-owner");
  headers.set("Origin", upstream.origin);
  const response = await fetch(new URL(url.pathname + url.search, upstream), {
    method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });
  if (url.pathname === "/sw.js" && response.ok && request.method === "GET") {
    // A real network update with changed bytes; never fulfill worker requests via
    // page.route, which cannot faithfully intercept browser worker-script fetches.
    return new Response(`${await response.text()}\n// synthetic revision ${scriptMode}\n`, { headers: response.headers });
  }
  return response;
} });
