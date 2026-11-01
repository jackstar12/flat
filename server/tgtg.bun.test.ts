import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTgtgReader } from "./tgtg";
import { app } from "./app";
import { LocalDatabase } from "./db";
const directory = mkdtempSync(join(tmpdir(), "flat-tgtg-test-"));
const tokenFile = join(directory, "proof");
writeFileSync(tokenFile, "synthetic-proof");
afterAll(() => rmSync(directory, { recursive: true }));
test("bridge selects personal scope from verified roommate, never query identity", async () => {
  const calls: { url: URL; headers: Headers }[] = [];
  const read = createTgtgReader({ tokenFile, request: (async (url: URL, options: RequestInit) => {
    calls.push({ url, headers: new Headers(options.headers) });
    return Response.json({ items: [] });
  }) as unknown as typeof fetch });
  for (const id of ["kran", "stadlmann", "mitter"]) {
    expect((await read("catalog", new URLSearchParams("user=kran&personal=true&upstream=https://example.test"), id)).status).toBe(200);
  }
  expect(calls[0].url.href).toBe("http://127.0.0.1:8797/api/catalog");
  expect(new Set(calls.map(c => c.headers.get("X-Tgtg-User"))).size).toBe(3);
  expect(calls[0].headers.get("X-Tgtg-User")).toBe("1b1f0e1737bb174f96db3b15e8c545ef6abe4ae5724b15ac0f2fdcc81863cbc7");
  expect(calls.every(c => c.headers.get("X-Tgtg-Groups") === "WG" && c.headers.get("X-Tgtg-Proxy-Token") === "synthetic-proof")).toBe(true);
  expect((await read("purchase", new URLSearchParams(), "kran")).status).toBe(404);
  expect((await read("photo", new URLSearchParams("id=https://example.test"), "kran")).status).toBe(400);
  expect((await read("photo", new URLSearchParams("id=123&kind=raw"), "kran")).status).toBe(400);
  expect(calls.length).toBe(3);
});
test("bridge rejects redirects, private upstream errors and invalid media", async () => {
  for (const response of [new Response("private secret", { status: 403 }), new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })]) {
    const read = createTgtgReader({ tokenFile, request: (async () => response) as unknown as typeof fetch });
    const result = await read("catalog", new URLSearchParams(), "kran");
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("private secret");
  }
});
test("Flat gate and stale-identity guard run before TGTG bridge", async () => {
  const database = new LocalDatabase(":memory:");
  database.migrate();
  const calls: string[] = [];
  const env = { DB: database, IDENTITY_MAP: [{ email: "owner@example.test", uid: "fixture-owner", roommateId: "kran" }, { email: "other@example.test", uid: "fixture-other", roommateId: "stadlmann" }], TRUSTED_ORIGINS: [], analyzeReceipt: async () => "", tgtgRead: async (_: string, _q: URLSearchParams, id: string) => { calls.push(id); return Response.json({ personal: id === "kran" }); } };
  try {
    for (const path of ["catalog", "history?id=123", "photo?id=123"]) {
      expect((await app.request(`/api/tgtg/${path}`, {}, env)).status).toBe(403);
      expect((await app.request(`/api/tgtg/${path}`, { headers: { "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "fixture-other" } }, env)).status).toBe(403);
    }
    expect((await app.request("/api/tgtg/catalog", { headers: { "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "fixture-owner", "X-Expected-Roommate-Id": "stadlmann" } }, env)).status).toBe(409);
    expect(calls).toEqual([]);
    const result = await app.request("/api/tgtg/catalog?personal=true", { headers: { "X-Flat-Email": "other@example.test", "X-Flat-Uid": "fixture-other", "X-Tgtg-User": "kran" } }, env);
    expect(await result.json()).toEqual({ personal: false });
    expect(calls).toEqual(["stadlmann"]);
  } finally { database.close(); }
});
