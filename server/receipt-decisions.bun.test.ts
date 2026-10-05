import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { analyzeWithJev, jevEndpoint, receiptDecisionConfig, type JevTransport } from "./receipt-decisions";
import type { ReceiptAssignmentRule, ReceiptAnalysis } from "../src/shared/types";
import { roommateIds } from "../src/shared/config";
import { app } from "./app";
import { LocalDatabase } from "./db";

const rule = (id: string, target: "category" | "item", match: string, shares = { kran: 100, stadlmann: 0, mitter: 0 }, extraDescription: string | null = null): ReceiptAssignmentRule => ({ id, target, match, shares, extraDescription });
const rules = [rule("fruit", "category", "Obst", { kran: 50, stadlmann: 50, mitter: 0 }),
  rule("milk", "category", "Milchprodukte", { kran: 40, stadlmann: 30, mitter: 30 }),
  rule("yogurt", "item", "Griechischer Joghurt"), rule("veg", "category", "Gemüse"),
  rule("nuts", "item", "Nüsse und Nussmus"), rule("tomato", "item", "Tomatenmark"),
  rule("coupon", "item", "App-Gutschein und App-Joker", { kran: 33, stadlmann: 33, mitter: 34 }, "Centgenau gleichmaßig teilen."),
  rule("deposit", "item", "Pfand und Leergut", { kran: 33, stadlmann: 33, mitter: 34 }, "Gleichmäßig teilen.")];
const item = (name: string, amountCents = 301, normalizedName = name) => ({ name, normalizedName, amountCents, quantity: null });
const extracted = (items = [item("APFELSTGELSTARTA")]) => ({ merchant: "Synthetic", receiptDate: "2026-10-05", printedTotalCents: items.reduce((s, i) => s + i.amountCents, 0), warnings: [], items });
type Choices = [string, string, number?, number?][];
function responseFor(body: string, choices: Choices) {
  const request = JSON.parse(body);
  return { model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 10 }, answers: Object.fromEntries(Object.entries(request.questions).map(([key, q]) => {
    const [index, kind] = key.split("-");
    const selected = choices[Number(index)];
    const choice = selected[kind === "category" ? 0 : 1];
    return [key, { type: "choice", choice, confidence: selected[kind === "category" ? 2 : 3] ?? 0.99,
      probabilities: Object.fromEntries(Object.keys((q as { criteria: object }).criteria).map(k => [k, k === choice ? 1 : 0])) }];
  })) };
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const transportFor = (choices: Choices, mutate?: (r: ReturnType<typeof responseFor>) => void): JevTransport => async (url, init) => {
  expect(url).toBe(jevEndpoint);
  expect(init.redirect).toBe("error"); expect(init.credentials).toBe("omit");
  expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
  const request = JSON.parse(init.body);
  expect(request.model).toBe("jev-latest");
  expect(request.state).not.toContain("amountCents"); expect(request.state).not.toContain('"shares"');
  const response = responseFor(init.body, choices); mutate?.(response); return json(response);
};
async function run(items = [item("APFELSTGELSTARTA")], choices: Choices = [["Obst", "none", 0.99, 0.47]], selectedRules = rules) {
  return analyzeWithJev({ text: "synthetic", document: null, rules: selectedRules, roommateIds,
    extract: async request => {
      expect(request.prompt).not.toContain('"shares"');
      const schema = JSON.stringify(request.outputSchema);
      for (const field of ["category", "assignmentRuleId", "assignmentReason", "splits"]) expect(schema).not.toContain(`"${field}"`);
      return JSON.stringify(extracted(items));
    }, transport: transportFor(choices) });
}

describe("Jev decision stage", () => {
  test("defaults legacy; unbound Jev fails before paid extraction", async () => {
    expect(receiptDecisionConfig("legacy")).toEqual({ provider: "legacy" });
    expect(() => receiptDecisionConfig("typo")).toThrow();
    let calls = 0;
    await expect(analyzeWithJev({ text: "", document: null, rules, roommateIds,
      extract: async () => { calls++; return "{}"; } })).rejects.toThrow("not configured");
    expect(calls).toBe(0);
  });
  // Held-out local fallback tests, not claims of new provider accuracy.
  for (const label of ["APFELSTGELSTARTA", "APFEL GALA KL.1", "BIO ÄPFEL ELSTAR", "APFEL GOLDEN DEL."]) {
    test(`exact category fallback after missing rule: ${label}`, async () => {
      const result = await run([item(label)]);
      expect(result.items[0].splits).toEqual([{ roommateId: "kran", amountCents: 151 }, { roommateId: "stadlmann", amountCents: 150 }]);
      expect(result.warnings.join(" ")).toContain("unsicher");
    });
  }
  test("semantic Greek yogurt item outranks category; literal item also beats selected category", async () => {
    for (const [label, normalized, selected] of [["SPAR BIO GRIECH.JOG.", "SPAR BIO GRIECH.JOG.", "yogurt"], ["GR.JOG", "Griechischer Joghurt", "milk"]]) {
      const result = await run([item(label, 301, normalized)], [["Milchprodukte", selected]]);
      expect(result.items[0].splits).toEqual([{ roommateId: "kran", amountCents: 301 }]);
    }
  });
  test("nut butter is not vegetables; corrected tomato identity uses its item rule", async () => {
    const result = await run([item("SPAR BIOERDNUSS GROB"), item("SPAR BIO-TOMA.BA200G")], [["Nüsse & Snacks", "nuts"], ["Gemüse", "none"]]);
    expect(result.items.map(i => i.category)).toEqual(["Nüsse & Snacks", "Gemüse"]);
    expect(result.items[1].normalizedName).toBe("Tomatenmark");
    for (const i of result.items) expect(i.splits).toEqual([{ roommateId: "kran", amountCents: 301 }]);
  });
  test("signed coupon/deposit allocation, equal prose and amounts are immutable", async () => {
    const items = [item("APP-JOKER", -101), item("LEERGUT", -25), item("PFAND", 25), item("APFEL", 1002)];
    const before = JSON.stringify(items);
    const result = await run(items, [["Pfand & Rabatte", "coupon"], ["Pfand & Rabatte", "deposit"], ["Pfand & Rabatte", "deposit"], ["Obst", "fruit"]]);
    expect(JSON.stringify(items)).toBe(before);
    expect(result.items[0].splits.map(s => s.amountCents)).toEqual([-34, -34, -33]);
    expect(result.items[1].splits.map(s => s.amountCents)).toEqual([-9, -8, -8]);
    expect(result.items[2].splits.map(s => s.amountCents)).toEqual([9, 8, 8]);
    expect(result.totalCents).toBe(901);
    expect(result.roommateTotals.reduce((s, i) => s + i.amountCents, 0)).toBe(901);
    const exclusive = await run([item("APP-JOKER", -101)], [["Pfand & Rabatte", "coupon"]], [rule("coupon", "item", "App-Joker", undefined, "gleichmäßig")]);
    expect(exclusive.items[0].splits).toEqual([{ roommateId: "kran", amountCents: -101 }]);
  });
  test("unknown SKU remains reviewable Sonstiges with equal default", async () => {
    const result = await run([item("XQZ 483")], [["Sonstiges", "none"]]);
    expect(result.items[0].normalizedName).toBe("XQZ 483");
    expect(result.items[0].splits.map(s => s.amountCents)).toEqual([101, 100, 100]);
    expect(result.warnings.join(" ")).toContain("unsicher");
  });
  test("invalid extraction fails before Jev including mismatched signed totals", async () => {
    for (const change of [{ printedTotalCents: 302 }, { printedTotalCents: null }, { items: [] }, { category: "Obst" }, { items: [{ ...item("APFEL"), amountCents: 1.5 }] }]) {
      let calls = 0;
      await expect(analyzeWithJev({ text: "", document: null, rules, roommateIds,
        extract: async () => JSON.stringify({ ...extracted(), ...change }), transport: async () => { calls++; return json({}); } })).rejects.toThrow();
      expect(calls).toBe(0);
    }
  });
  const invalid: [string, (r: any) => void][] = [
    ["missing answer", r => delete r.answers["0-rule"]], ["extra answer", r => r.answers.extra = r.answers["0-rule"]],
    ["unknown category", r => r.answers["0-category"].choice = "hacked"], ["unknown rule", r => r.answers["0-rule"].choice = "hacked"],
    ["wrong model", r => r.model = "jev-2"], ["extra financial output", r => r.amountCents = 999],
    ["non-choice", r => r.answers["0-rule"].type = "text"], ["extra answer fields", r => r.answers["0-rule"].splits = []],
    ["bad confidence", r => r.answers["0-rule"].confidence = 2], ["missing probabilities", r => delete r.answers["0-rule"].probabilities],
    ["unknown probability key", r => r.answers["0-rule"].probabilities.hacked = 0],
    ["contradictory category rule", r => r.answers["0-rule"].choice = "milk"],
  ];
  for (const [name, mutate] of invalid) test(`rejects ${name}`, async () => {
    await expect(analyzeWithJev({ text: "", document: null, rules, roommateIds, extract: async () => JSON.stringify(extracted()),
      transport: transportFor([["Obst", "none"]], mutate) })).rejects.toThrow();
  });
  test("rejects non-JSON, excessive stream, redirects, 401, and transport errors without retry", async () => {
    const responses = [() => new Response("private", { status: 401 }), () => new Response(null, { status: 302, headers: { Location: "https://evil.test" } }),
      () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      () => new Response("x".repeat(1_000_001), { headers: { "Content-Type": "application/json" } }),
      () => new Response("not json", { headers: { "Content-Type": "application/json" } }),
      () => { throw new Error("private transport details"); }];
    for (const make of responses) {
      let calls = 0;
      await expect(analyzeWithJev({ text: "", document: null, rules, roommateIds, extract: async () => JSON.stringify(extracted()),
        transport: async () => { calls++; return make(); } })).rejects.toThrow("Jev");
      expect(calls).toBe(1);
    }
  });
  test("bounds both stalled transport and stalled response body", async () => {
    for (const transport of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } })]) {
      await expect(analyzeWithJev({ text: "", document: null, rules, roommateIds, extract: async () => JSON.stringify(extracted()), transport }, { timeoutMs: 10 })).rejects.toMatchObject({ code: "timeout" });
    }
  });
});

const headers = { "X-Flat-Proxy-Token": "a".repeat(64), "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "synthetic", Origin: "http://flat.test" };
function bindings(db: LocalDatabase, transport: JevTransport, items = [item("APFELSTGELSTARTA")]) {
  return { DB: db, PROXY_TOKEN: "a".repeat(64), IDENTITY_MAP: [{ email: "owner@example.test", uid: "synthetic", roommateId: "kran" }], TRUSTED_ORIGINS: ["http://flat.test"],
    receiptDecisions: { provider: "jev" as const, transport }, analyzeReceipt: async () => JSON.stringify(extracted(items)) };
}
let sourceNumber = 0;
function form() { const body = new FormData(); body.set("receiptText", `synthetic receipt ${++sourceNumber}`); return body; }
test("actual Jev provider 401 => route 502, never login or draft/expense write", async () => {
  const db = new LocalDatabase(":memory:"); db.migrate();
  try {
    const response = await app.request("/api/finance/receipt/analyze", { method: "POST", headers, body: form() }, bindings(db, async () => new Response("private", { status: 401 })));
    expect(response.status).toBe(502); expect(response.headers.has("Location")).toBe(false);
    expect(await response.json()).toMatchObject({ code: "inference_unavailable" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipt_analysis_drafts").first<{ n: number }>()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM finance_transactions").first<{ n: number }>()).toEqual({ n: 0 });
  } finally { db.close(); }
});
test("saved pasta corrections remain effective; explicit rules still outrank learning", async () => {
  const db = new LocalDatabase(":memory:"); db.migrate();
  try {
    const analyze = async () => {
      const response = await app.request("/api/finance/receipt/analyze", { method: "POST", headers, body: form() },
        bindings(db, transportFor([["Getreide & Frühstück", "none"]]), [item("SPAR BIO VK.TORRI")]));
      expect(response.status).toBe(200);
      return await response.json() as { analysis: ReceiptAnalysis; analysisId: string };
    };
    for (let i = 0; i < 2; i++) {
      const draft = await analyze();
      const corrected = draft.analysis.items.map(item => ({ ...item, splits: [{ roommateId: "kran", amountCents: 301 }] }));
      const response = await app.request("/api/finance/expenses", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({
        receiptAnalysisId: draft.analysisId, description: "Synthetic", paidBy: "kran", paidAt: "2026-10-05", splitMode: "custom", participantIds: [], amountCents: 301,
        receiptItems: corrected, splits: [{ roommateId: "kran", owedCents: 301 }],
      }) }, bindings(db, transportFor([])));
      expect(response.status).toBe(201);

    }
    const learned = (await analyze()).analysis.items[0];
    expect(learned.normalizedName).toBe("Vollkornnudeln");
    expect(learned.splits).toEqual([{ roommateId: "kran", amountCents: 301 }]);
    expect(learned.assignmentReason).toContain("Korrekturen");
    db.prepare(`INSERT INTO receipt_assignment_rules (id, household_id, target, match, shares, extra_description, sort_order, created_at, updated_at)
      VALUES ('pasta', 'wg-main', 'item', 'Vollkornnudeln', '{"kran":0,"stadlmann":0,"mitter":100}', NULL, 90, 'test', 'test')`).run();
    expect((await analyze()).analysis.items[0].splits).toEqual([{ roommateId: "mitter", amountCents: 301 }]);
  } finally { db.close(); }
});


describe("separately provisioned app credential", () => {
  // Synthetic token only; never open the configured production credential path.
  const token = "fixture-app-token-0123456789";
  function withFile(run: (path: string) => void | Promise<void>) {
    const directory = mkdtempSync(join(tmpdir(), "flat-jev-key-test-"));
    const path = join(directory, "synthetic.key");
    writeFileSync(path, `${token}\n`, { mode: 0o600 });
    return Promise.resolve().then(() => run(path)).finally(() => rmSync(directory, { recursive: true, force: true }));
  }
  test("legacy ignores credential path; missing Jev config fails before extraction", () => {
    expect(receiptDecisionConfig("legacy", { keyFile: "/does-not-exist/synthetic.key" })).toEqual({ provider: "legacy" });
    expect(() => receiptDecisionConfig("jev", { keyFile: "" })).toThrow("credential file is missing or invalid");
    expect(() => receiptDecisionConfig("jev", { keyFile: "/does-not-exist/synthetic.key" })).toThrow("credential file is missing or invalid");
    expect(() => receiptDecisionConfig("jev", { keyFile: "relative.key" })).toThrow("credential file is missing or invalid");
  });
  test("fixed verified HTTPS fetch with no redirect, key in header only, provided abort", async () => {
    await withFile(async path => {
      let calls = 0;
      const config = receiptDecisionConfig("jev", { keyFile: path, fetch: (async (url: unknown, init: BunFetchRequestInit) => {
        calls++;
        expect(url).toBe(jevEndpoint);
        expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", tls: { rejectUnauthorized: true }, verbose: false });
        expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
        expect(init.signal).toBe(signal);
        expect(init.body).toBe("{}");
        return json({});
      }) as unknown as typeof fetch });
      if (config.provider !== "jev" || !config.transport) throw new Error("binding missing");
      const signal = new AbortController().signal;
      const init = { method: "POST" as const, redirect: "error" as const, credentials: "omit" as const,
        signal, headers: { "Content-Type": "application/json" as const }, body: "{}" };
      await config.transport(jevEndpoint, init);
      await expect(config.transport("http://evil.test" as typeof jevEndpoint, init)).rejects.toThrow("Invalid Jev endpoint");
      expect(calls).toBe(1);
    });
  });
  test("rejects blank, placeholder, sentinel, multiline and oversized files", async () => {
    await withFile(path => {
      for (const value of ["", "   \n", "__OPENCLAW_SECRET_SENTINEL_123456__", "oc-sent-v2.synthetic-fixture.end", "secret://typesafe/key", "REDACTED_PLACEHOLDER", "TYPESAFE_API_KEY", "provision-app-key-here", `${token}\nsecond-line`, "x".repeat(4097)]) {
        writeFileSync(path, value);
        expect(() => receiptDecisionConfig("jev", { keyFile: path })).toThrow("credential file is missing or invalid");
      }
    });
  });
  test("rejects public-readable files, directories and symlinks", async () => {
    await withFile(path => {
      chmodSync(path, 0o644);
      expect(() => receiptDecisionConfig("jev", { keyFile: path })).toThrow("credential file is missing or invalid");
      chmodSync(path, 0o600);
      symlinkSync(path, `${path}.link`);
      expect(() => receiptDecisionConfig("jev", { keyFile: `${path}.link` })).toThrow("credential file is missing or invalid");
      expect(() => receiptDecisionConfig("jev", { keyFile: join(path, "..") })).toThrow("credential file is missing or invalid");
    });
  });
  test("refuses globally disabled TLS verification", async () => {
    await withFile(path => {
      const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      try {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        expect(() => receiptDecisionConfig("jev", { keyFile: path })).toThrow("requires TLS verification");
      } finally {
        if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
      }
    });
  });
  test("transport exceptions are redacted and aborted calls are not retried", async () => {
    await withFile(async path => {
      let calls = 0;
      const config = receiptDecisionConfig("jev", { keyFile: path, fetch: (async (_url: unknown, init: BunFetchRequestInit) => {
        calls++; expect(init.signal?.aborted).toBe(true);
        throw new Error(`private payload ${token}`);
      }) as unknown as typeof fetch });
      if (config.provider !== "jev" || !config.transport) throw new Error("binding missing");
      const controller = new AbortController(); controller.abort();
      await expect(config.transport(jevEndpoint, { method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: "{}" })).rejects.toThrow("Jev transport is unavailable.");
      expect(calls).toBe(1);
    });
  });
});

test("request guidance is general; neither compressed apple nor opaque SKU is locally forced", async () => {
  const items = [item("APFELSTGELSTARTA"), item("XQZ 483")];
  const result = await analyzeWithJev({ text: "", document: null, rules, roommateIds,
    extract: async () => JSON.stringify(extracted(items)), transport: async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.questions["0-category"].instructions).toContain('item id "0"');
      expect(body.questions["0-category"].instructions).toContain("concatenate product words");
      expect(body.questions["1-category"].instructions).toContain("opaque SKU");
      expect(JSON.stringify(body.questions["0-category"].criteria)).not.toContain("APFELSTGELSTARTA");
      return json(responseFor(init.body, [["Sonstiges", "none", 0.3], ["Sonstiges", "none", 0.99]]));
    } });
  expect(result.items.map(item => item.category)).toEqual(["Sonstiges", "Sonstiges"]);
  expect(result.items.map(item => item.normalizedName)).toEqual(items.map(item => item.name));
  expect(result.warnings.filter(warning => warning.includes("unsicher"))).toHaveLength(2);
});


test("digital PDF prompt prefers coherent embedded text; conflicting cents fail before Jev without repair", async () => {
  for (const yogurtCents of [164, 161]) {
    let decisionCalls = 0;
    const items = [item("Synthetic product A", 199), item("Synthetic product B", 224), item("Synthetic eggs", 351), item("Synthetic yogurt", yogurtCents)];
    const analyze = analyzeWithJev({ text: "synthetic PDF text", document: null, rules, roommateIds,
      extract: async request => {
        expect(request.prompt).toContain("prefer coherent embedded PDF text for exact printed labels, prices, date and total");
        expect(request.prompt).toContain("do not override clear, coherent embedded text with an uncertain visual reading of a digit");
        expect(request.prompt).toContain("independently read printed total");
        expect(request.prompt).toContain("never repair arithmetic by guessing");
        return JSON.stringify({ ...extracted(items), printedTotalCents: 935 });
      }, transport: async (_url, init) => {
        decisionCalls++;
        return json(responseFor(init.body, items.map(() => ["Sonstiges", "none"])));
      } });
    if (yogurtCents === 164) {
      await expect(analyze).rejects.toThrow("Rechnungssumme");
      expect(decisionCalls).toBe(0);
      expect(items[3].amountCents).toBe(164);
    } else {
      const result = await analyze;
      expect(decisionCalls).toBe(1);
      expect(result.totalCents).toBe(935);
      expect(result.items.map(item => item.amountCents)).toEqual([199, 224, 351, 161]);
    }
  }
});
