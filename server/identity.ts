import { findRoommate } from "../src/shared/config";
import { hasProxyProof } from "./proxy";

export type IdentityMapping = { email: string; uid: string; roommateId: string };
const emailPattern = /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/;
const uidPattern = /^[a-zA-Z0-9_-]{1,128}$/;

export function parseIdentityMappings(value: string | undefined): IdentityMapping[] {
  try {
    const entries: unknown = JSON.parse(value ?? "");
    if (!Array.isArray(entries) || entries.length === 0) throw new Error();
    const emails = new Set<string>();
    const uids = new Set<string>();
    const roommates = new Set<string>();
    return entries.map((entry) => {
      if (!entry || typeof entry.email !== "string" || typeof entry.uid !== "string" ||
          typeof entry.roommateId !== "string" || !emailPattern.test(entry.email) ||
          !uidPattern.test(entry.uid) || !findRoommate(entry.roommateId)) throw new Error();
      const email = entry.email.toLowerCase();
      if (emails.has(email) || uids.has(entry.uid) || roommates.has(entry.roommateId)) throw new Error();
      emails.add(email); uids.add(entry.uid); roommates.add(entry.roommateId);
      return { email, uid: entry.uid, roommateId: entry.roommateId };
    });
  } catch {
    // Never include private mappings in configuration errors.
    throw new Error("FLAT_IDENTITY_MAP requires unique email, UID and existing roommate ID entries.");
  }
}

export function verifiedRoommate(request: Request, token: string, mappings: readonly IdentityMapping[]) {
  if (!hasProxyProof(request, token)) return null;
  const email = request.headers.get("X-Flat-Email") ?? "";
  const uid = request.headers.get("X-Flat-Uid") ?? "";
  if (!emailPattern.test(email) || !uidPattern.test(uid)) return null;
  const matches = mappings.filter((entry) => entry.email.toLowerCase() === email.toLowerCase() || entry.uid === uid);
  if (matches.length !== 1 || matches[0].email.toLowerCase() !== email.toLowerCase() || matches[0].uid !== uid) return null;
  return findRoommate(matches[0].roommateId) ?? null;
}
