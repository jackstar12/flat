import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { roommateIds } from "../src/shared/config";
import { normalizeReceiptAnalysis } from "../src/shared/receipt";
import { receiptTrackingCategories } from "../src/shared/types";
import type { FinancePayload, ReceiptAnalysis, ReceiptAssignmentRule } from "../src/shared/types";

const apiBase = process.env.FLAT_IMPORT_API_URL?.trim() || "http://127.0.0.1:8787";
const invoiceDirectory = resolve(process.env.FLAT_INVOICE_DIRECTORY ?? "data/spar-rechnungen-26-drive");
const parsedDirectory = resolve(process.env.FLAT_PARSED_DIRECTORY ?? ".firecrawl/invoices");
const resultsDirectory = resolve(process.env.FLAT_IMPORT_RESULTS_DIRECTORY ?? ".firecrawl/import-results");
const payerId = process.env.FLAT_IMPORT_PAYER_ID?.trim() || "kran";
const concurrency = Math.max(1, Number(process.env.FLAT_IMPORT_CONCURRENCY ?? "3"));
const reuseResults = process.env.FLAT_IMPORT_REUSE_RESULTS === "1";
const refreshAnalysis = process.env.FLAT_IMPORT_REFRESH_ANALYSIS === "1";
const password = process.env.MAGIC_PASSWORD?.trim();

if (!password) {
  throw new Error("MAGIC_PASSWORD fehlt.");
}

await mkdir(resultsDirectory, { recursive: true });
const cookie = await login(password);
const current = await api<FinancePayload>("/api/finance", { cookie });
const currentRules = await api<{ rules: ReceiptAssignmentRule[] }>("/api/receipt-rules", { cookie });
const rulesFingerprint = Bun.hash(JSON.stringify({ rules: currentRules.rules, categories: receiptTrackingCategories })).toString(16);
const transactionsBySource = new Map(
  current.transactions
    .filter((transaction) => Boolean(transaction.receiptSourceRef))
    .map((transaction) => [transaction.receiptSourceRef as string, transaction]),
);
const invoiceNames = (await readdir(invoiceDirectory))
  .filter((name) => name.endsWith(".pdf") && !name.includes("__"))
  .map((name) => name.slice(0, -4))
  .sort();
const queue = invoiceNames.filter((sourceRef) => {
  const transaction = transactionsBySource.get(sourceRef);
  return refreshAnalysis || !transaction || !transaction.receiptUpload;
});
const failures: { sourceRef: string; error: string }[] = [];
let nextIndex = 0;
let importedCount = 0;
let updatedCount = 0;
let attachedCount = 0;
let processedCount = invoiceNames.length - queue.length;

console.log(`Processing ${queue.length} of ${invoiceNames.length} invoices missing data or an original file.`);

await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      const sourceRef = queue[index];
      if (!sourceRef) return;

      try {
        const sourcePath = resolve(invoiceDirectory, `${sourceRef}.pdf`);
        const existingTransaction = transactionsBySource.get(sourceRef);
        if (existingTransaction && !refreshAnalysis) {
          await attachOriginal(existingTransaction.id, sourcePath, sourceRef, cookie);
          attachedCount += 1;
          processedCount += 1;
          console.log(`[${processedCount}/${invoiceNames.length}] ${sourceRef}: original PDF attached`);
          continue;
        }

        const parsedPath = resolve(parsedDirectory, `${sourceRef}.md`);
        const resultPath = resolve(resultsDirectory, `${sourceRef}.json`);
        const receiptText = await Bun.file(parsedPath).text();
        if (!receiptText.trim()) throw new Error("Parsed receipt text is empty.");
        const printedTotalCents = receiptTotalFromText(receiptText);
        if (printedTotalCents === null) throw new Error("Printed SUMME could not be determined.");

        let analysis: ReceiptAnalysis | null = null;
        if (reuseResults && (await Bun.file(resultPath).exists())) {
          try {
            const cached = JSON.parse(await Bun.file(resultPath).text()) as {
              analysis: ReceiptAnalysis;
              rulesFingerprint?: string;
            };
            if (cached.rulesFingerprint !== rulesFingerprint) throw new Error("Receipt rules changed.");
            analysis = normalizeReceiptAnalysis(cached.analysis, roommateIds);
            validateAnalysis(analysis, printedTotalCents);
          } catch {
            analysis = null;
            console.log(`${sourceRef}: cached analysis rejected; analyzing again.`);
          }
        }
        if (!analysis) {
          analysis = await analyze(receiptText, cookie);
          validateAnalysis(analysis, printedTotalCents);
        }
        const paidAt = analysis.receiptDate ?? dateFromReceiptText(receiptText);
        if (!paidAt) throw new Error("Receipt date could not be determined.");

        const transaction = await api<{ transaction: { id: string } }>(
          existingTransaction ? `/api/finance/expenses/${existingTransaction.id}` : "/api/finance/expenses",
          {
          cookie,
          method: existingTransaction ? "PATCH" : "POST",
          body: {
            description: existingTransaction?.description ?? `SPAR Rechnung ${formatDate(paidAt)} · ${sourceRef.slice(-6)}`,
            amountCents: analysis.totalCents,
            paidBy: existingTransaction?.paidBy ?? payerId,
            paidAt: existingTransaction?.paidAt ?? paidAt,
            splitMode: "custom",
            participantIds: [],
            splits: analysis.roommateTotals.map((split) => ({
              roommateId: split.roommateId,
              owedCents: split.amountCents,
            })),
            receiptItems: analysis.items,
            receiptSourceRef: sourceRef,
          },
        },
        );
        if (!existingTransaction?.receiptUpload) {
          await attachOriginal(transaction.transaction.id, sourcePath, sourceRef, cookie);
          attachedCount += 1;
        }

        await Bun.write(
          resultPath,
          JSON.stringify(
            {
              sourceRef,
              sourceFile: `${sourceRef}.pdf`,
              transactionId: transaction.transaction.id,
              rulesFingerprint,
              analysis,
            },
            null,
            2,
          ),
        );
        if (existingTransaction) updatedCount += 1;
        else importedCount += 1;
        processedCount += 1;
        console.log(
          `[${processedCount}/${invoiceNames.length}] ${sourceRef}: ${existingTransaction ? "updated" : "imported"}, ${formatMoney(analysis.totalCents)}, ${analysis.items.length} items`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ sourceRef, error: message });
        console.error(`${sourceRef}: ${message}`);
      }
    }
  }),
);

const finalFinance = await api<FinancePayload>("/api/finance", { cookie });
await Bun.write(
  resolve(resultsDirectory, "summary.json"),
  JSON.stringify(
    {
      uniqueInvoiceFiles: invoiceNames.length,
      importedThisRun: importedCount,
      updatedThisRun: updatedCount,
      originalsAttachedThisRun: attachedCount,
      transactionCount: finalFinance.transactions.filter((transaction) => transaction.receiptSourceRef).length,
      originalFileCount: finalFinance.transactions.filter((transaction) => transaction.receiptUpload).length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) {
  throw new Error(`${failures.length} invoice(s) failed. See ${resolve(resultsDirectory, "summary.json")}.`);
}

console.log(`Complete: ${finalFinance.transactions.filter((transaction) => transaction.receiptSourceRef).length} invoices.`);

async function login(magicPassword: string): Promise<string> {
  const response = await fetch(`${apiBase}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roommateId: payerId, password: magicPassword }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Login returned no session cookie.");
  return cookie;
}

async function analyze(receiptText: string, cookie: string): Promise<ReceiptAnalysis> {
  const form = new FormData();
  form.set("receiptText", receiptText);
  const response = await fetch(`${apiBase}/api/finance/receipt/analyze`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  if (!response.ok) throw new Error(`Analysis failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { analysis: ReceiptAnalysis }).analysis;
}

async function attachOriginal(transactionId: string, sourcePath: string, sourceRef: string, cookie: string): Promise<void> {
  const source = Bun.file(sourcePath);
  if (!(await source.exists())) throw new Error(`Original PDF is missing: ${sourcePath}`);
  const form = new FormData();
  form.set("receipt", source, `${sourceRef}.pdf`);
  const response = await fetch(`${apiBase}/api/finance/expenses/${transactionId}/receipt-file`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: form,
  });
  if (!response.ok) throw new Error(`Original upload failed: ${response.status} ${await response.text()}`);
}

async function api<T>(
  path: string,
  options: { cookie: string; method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Cookie: options.cookie,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

function validateAnalysis(analysis: ReceiptAnalysis, printedTotalCents: number): void {
  if (!analysis.items.length || analysis.totalCents <= 0) throw new Error("Analysis returned no payable items.");
  const itemTotal = analysis.items.reduce((sum, item) => sum + item.amountCents, 0);
  const roommateTotal = analysis.roommateTotals.reduce((sum, split) => sum + split.amountCents, 0);
  if (itemTotal !== analysis.totalCents || roommateTotal !== analysis.totalCents) {
    throw new Error(`Analysis totals disagree: total=${analysis.totalCents}, items=${itemTotal}, roommates=${roommateTotal}.`);
  }
  if (analysis.totalCents !== printedTotalCents) {
    throw new Error(`Analysis total ${analysis.totalCents} does not match printed SUMME ${printedTotalCents}.`);
  }
  for (const item of analysis.items) {
    const splitTotal = item.splits.reduce((sum, split) => sum + split.amountCents, 0);
    if (splitTotal !== item.amountCents) throw new Error(`Item split mismatch for ${item.name}.`);
  }
}

function receiptTotalFromText(text: string): number | null {
  const match = /^SUMME:\s*(-?\d{1,6}[.,]\d{2})\s*$/im.exec(text);
  if (!match) return null;
  return Math.round(Number(match[1].replace(",", ".")) * 100);
}

function dateFromReceiptText(text: string): string | null {
  const match = /Ihr Einkauf am\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(cents / 100);
}
