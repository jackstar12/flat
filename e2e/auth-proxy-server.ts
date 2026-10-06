// Real canonical Caddy + isolated native-gate fixture. Never a production login.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const backend = new URL(process.env.E2E_BACKEND_URL!);
const port = Number(process.env.E2E_AUTH_PROXY_PORT);
if (process.env.FLAT_E2E_AUTH_PROXY !== "synthetic-only" || backend.hostname !== "127.0.0.1" ||
    backend.protocol !== "http:" || Number(backend.port) < 1024 || backend.port === "8787" || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 8787 || !process.env.FLAT_TEST_PROXY_SNIPPET) throw new Error("Isolated proxy fixture required");
const auth = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const url = new URL(request.url);
  const actor = request.headers.get("cookie")?.match(/(?:^|;\s*)flat_fixture=(kran|stadlmann|unmapped)(?:;|$)/)?.[1];
  const noStore = { "Cache-Control": "no-store" };
  if (url.pathname === "/outpost.goauthentik.io/fixture-login") {
    const next = url.searchParams.get("actor") === "stadlmann" ? "stadlmann" : url.searchParams.get("actor") === "unmapped" ? "unmapped" : "kran";
    return new Response("Synthetic session", { headers: { ...noStore, "Set-Cookie": `flat_fixture=${next}; Path=/; HttpOnly; SameSite=Lax` } });
  }
  if (["/outpost.goauthentik.io/sign_out", "/outpost.goauthentik.io/fixture-expire"].includes(url.pathname)) {
    return new Response("Synthetic sign-out", { headers: { ...noStore, "Set-Cookie": "flat_fixture=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } });
  }
  if (url.pathname === "/outpost.goauthentik.io/start") return new Response("<!doctype html><h1>Synthetic sign-in</h1>", { headers: { ...noStore, "Content-Type": "text/html" } });
  if (!actor) return new Response(null, { status: 302, headers: { Location: "/outpost.goauthentik.io/start" } });
  return new Response(null, { headers: {
    "X-Authentik-Email": actor === "kran" ? "owner@example.test" : `ui-${actor}@example.test`,
    "X-Authentik-Uid": actor === "kran" ? "fixture-owner" : `ui-${actor}`,
    "Set-Cookie": "refresh_fixture=renewed; Path=/; HttpOnly; SameSite=Lax",
  } });
} });
const dir = await mkdtemp(join(tmpdir(), "flat-auth-caddy-"));
const snippet = (await readFile(process.env.FLAT_TEST_PROXY_SNIPPET, "utf8"))
  .replaceAll("127.0.0.1:19000", `127.0.0.1:${auth.port}`)
  .replaceAll("https://dev.tail685c39.ts.net:18787", backend.origin);
if (snippet.includes("dev.tail685c39.ts.net") || snippet.includes("127.0.0.1:19000") || snippet.includes("/etc/caddy/")) throw new Error("Unreplaced production upstream in fixture");
const config = `{\n admin off\n auto_https off\n}\n(public_upstream) {\n header_up -X-Authentik-*\n}\nhttp://127.0.0.1:${port} {\n bind 127.0.0.1\n route {\n${snippet}\n}\n}\n`;
await writeFile(join(dir, "Caddyfile"), config);
const proxy = Bun.spawn([process.env.CADDY_TEST_BINARY ?? "caddy", "run", "--config", join(dir, "Caddyfile"), "--adapter", "caddyfile"], { stdout: "ignore", stderr: "inherit", env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data") } });
async function stop() { proxy.kill(); await proxy.exited; auth.stop(true); await rm(dir, { recursive: true, force: true }); process.exit(); }
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
await proxy.exited;
auth.stop(true); await rm(dir, { recursive: true, force: true });
