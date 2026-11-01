import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type TgtgRead = (endpoint: string, query: URLSearchParams, roommateId: string) => Promise<Response>;
const ownerUid = "1b1f0e1737bb174f96db3b15e8c545ef6abe4ae5724b15ac0f2fdcc81863cbc7";

// Only this server-side bridge holds the read-only tracker proof. Caller headers
// and query parameters cannot select a personal-data identity or upstream URL.
export function createTgtgReader(options: { tokenFile?: string; upstream?: string; request?: typeof fetch } = {}): TgtgRead {
  const request = options.request ?? fetch;
  const upstream = options.upstream ?? "http://127.0.0.1:8797";
  const tokenFile = options.tokenFile ?? "/home/jacksn/.config/tgtg-dashboard/proxy-token";
  return async (endpoint, query, roommateId) => {
    if (!["catalog", "history", "photo"].includes(endpoint)) return new Response(null, { status: 404 });
    const url = new URL(`/api/${endpoint}`, upstream);
    if (endpoint !== "catalog") {
      const id = query.get("id") ?? "";
      if (!/^\d{1,30}$/.test(id)) return Response.json({ error: "Ungültige Sackerl-ID." }, { status: 400 });
      url.searchParams.set("id", id);
      if (endpoint === "photo") {
        const kind = query.get("kind") ?? "cover";
        if (!["cover", "logo"].includes(kind)) return new Response(null, { status: 400 });
        url.searchParams.set("kind", kind);
      }
    }
    try {
      const token = (await readFile(tokenFile, "utf8")).trim();
      const response = await request(url, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(endpoint === "photo" ? 20000 : 15000),
        headers: {
          "X-Tgtg-Proxy-Token": token,
          "X-Tgtg-Groups": "WG",
          "X-Tgtg-User": roommateId === "kran" ? ownerUid : createHash("sha256").update(`flat-tgtg:${roommateId}`).digest("hex"),
        },
      });
      if (!response.ok) {
        return Response.json({ error: "TGTG-Daten nicht verfügbar. Bitte erneut versuchen." }, { status: response.status === 404 ? 404 : 502 });
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!(endpoint === "photo" ? /^image\/(jpeg|png|webp)$/.test(contentType) : contentType.startsWith("application/json"))) {
        return Response.json({ error: "Ungültige TGTG-Antwort." }, { status: 502 });
      }
      return new Response(response.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return Response.json({ error: "TGTG-Daten nicht verfügbar. Bitte erneut versuchen." }, { status: 503 });
    }
  };
}
