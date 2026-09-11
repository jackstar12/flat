import { timingSafeEqual } from "node:crypto";

// Private server-to-server proof, never a browser credential or a person identity.
export function hasProxyProof(request: Request, token: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const value = request.headers.get("X-Flat-Proxy-Token") ?? "";
  return /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

export function isHealthRequest(request: Request): boolean {
  return ["GET", "HEAD"].includes(request.method) && new URL(request.url).pathname === "/healthz";
}
