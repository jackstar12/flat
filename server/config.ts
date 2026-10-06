import { parseIdentityMappings, type IdentityMapping } from "./identity";
import { resolve } from "node:path";

export type LocalConfig = {
  databasePath: string;
  host: string;
  port: number;
  identityMappings: IdentityMapping[];
  trustedOrigins: string[];
};

export function readConfig(): LocalConfig {
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT muss eine gultige Portnummer sein.");
  }

  return {
    databasePath: resolve(process.env.FLAT_DATABASE_PATH ?? "./data/flat.sqlite"),
    host: process.env.HOST?.trim() || "127.0.0.1",
    port,
    identityMappings: parseIdentityMappings(process.env.FLAT_IDENTITY_MAP),
    trustedOrigins: parseTrustedOrigins(process.env.FLAT_TRUSTED_ORIGINS),
  };
}


export function parseTrustedOrigins(value: string | undefined): string[] {
  const origins = value?.split(",").map((origin) => origin.trim()) ?? [];
  if (!origins.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin;
    } catch {
      return true;
    }
  })) {
    throw new Error("FLAT_TRUSTED_ORIGINS muss explizite, kommagetrennte HTTP(S)-Origins ohne Pfad enthalten.");
  }
  return [...new Set(origins)];
}
