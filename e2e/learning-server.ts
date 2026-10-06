// Isolated UI fixture: real app routes/storage, deterministic inference only.
import { resolve } from "node:path";
import { app } from "../server/app";
import { LocalDatabase } from "../server/db";
import { roommateIds } from "../src/shared/config";

const port = Number(process.env.E2E_LEARNING_PORT);
const path = process.env.E2E_LEARNING_DATABASE_PATH;
if (process.env.FLAT_E2E_LEARNING !== "synthetic-only" || !path?.startsWith("/tmp/flat-e2e-learning-") || !Number.isInteger(port) || port < 4000 || port === 8787) {
  throw new Error("Isolated learning fixture configuration required");
}
const database = new LocalDatabase(path);
database.migrate();
const bindings = {
  DB: database,
  IDENTITY_MAP: [{ email: "owner@example.test", uid: "fixture-owner", roommateId: "kran" }],
  TRUSTED_ORIGINS: [`http://127.0.0.1:${port}`],
  analyzeReceipt: async ({ prompt }: { prompt: string }) => {
    const name = prompt.match(/TEST_PRODUCT=([^\n]+)/)?.[1] ?? "Testprodukt";
    return JSON.stringify({ merchant: "Synthetischer Testmarkt", receiptDate: "2026-10-05", warnings: [], items: [{
      name, normalizedName: name, category: "Sonstiges", quantity: "1", amountCents: 300,
      assignmentReason: "Synthetische Inferenz", assignmentRuleId: null,
      splits: roommateIds.map((roommateId) => ({ roommateId, amountCents: 100 })),
    }] });
  },
};
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return app.fetch(request, bindings);
  const root = resolve(import.meta.dir, "../dist");
  const filePath = resolve(root, `.${url.pathname}`);
  if (filePath.startsWith(`${root}/`) && await Bun.file(filePath).exists()) return new Response(Bun.file(filePath));
  return new Response(Bun.file(`${root}/index.html`));
} });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.stop(); database.close(); process.exit(0); });
