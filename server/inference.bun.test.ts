import { afterAll, describe, expect, test } from "bun:test";
import { analyzeReceipt } from "./inference";
const original = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };
process.env.OPENAI_API_KEY = "synthetic-secret";
process.env.OPENAI_BASE_URL = "https://inference.test/v1";
afterAll(() => {
  if (original.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.key;
  if (original.url === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = original.url;
});
const request = { prompt: "synthetic", document: null, outputSchema: { type: "object", additionalProperties: false, required: ["total"], properties: { total: { type: "integer" } } } };
const envelope = (text: string, status = "completed") => JSON.stringify({ status, output: [{ type: "message", content: [{ type: "output_text", text }] }] });
function fake(body: string, status = 200): typeof fetch { return (async () => new Response(body, { status })) as unknown as typeof fetch; }
describe("receipt inference", () => {
  test("preserves model, schema, vision and disables tools", async () => {
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("gpt-5.6-sol");
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(body.tools).toEqual([]);
      expect(body.tool_choice).toBe("none");
      expect(body.text.format.schema).toEqual(request.outputSchema);
      expect(body.input[0].content[1].image_url).toStartWith("data:image/png;base64,");
      return new Response(envelope('{"total":100}'));
    }) as unknown as typeof fetch;
    expect(await analyzeReceipt({ ...request, document: new File(["synthetic"], "receipt.png", { type: "image/png" }) }, { fetch: fetcher })).toBe('{"total":100}');
  });
  for (const [name, body] of [["invalid JSON", "bad"], ["invalid schema", envelope('{"total":"bad"}')], ["extra properties", envelope('{"total":1,"extra":true}')], ["incomplete", envelope('{"total":1}', "incomplete")], ["empty", JSON.stringify({ status: "completed", output: [] })], ["oversized", "x".repeat(2_000_001)]]) {
    test(`rejects ${name}`, async () => { await expect(analyzeReceipt(request, { fetch: fake(body) })).rejects.toThrow("Rechnungsanalyse"); });
  }
  test("rasterizes PDFs and caps attachments at eight", async () => {
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count 9 /Kids [${Array.from({ length: 9 }, (_, i) => `${i + 3} 0 R`).join(" ")}] >>`, ...Array.from({ length: 9 }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>")];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const content = JSON.parse(init.body as string).input[0].content;
      expect(content).toHaveLength(9);
      expect(content.slice(1).every((part: { image_url: string }) => part.image_url.startsWith("data:image/png;base64,"))).toBe(true);
      return new Response(envelope('{"total":100}'));
    }) as unknown as typeof fetch;
    await analyzeReceipt({ ...request, document: new File([pdf], "synthetic.pdf", { type: "application/pdf" }) }, { fetch: fetcher });
  });
  test("redacts provider errors", async () => {
    await expect(analyzeReceipt(request, { fetch: fake("secret provider details", 401) })).rejects.toThrow("Rechnungsanalyse fehlgeschlagen (HTTP 401).");
  });
  test("times out actual fetch", async () => {
    const server = Bun.serve({ port: 0, fetch: async () => { await Bun.sleep(100); return new Response("late"); } });
    try {
      const fetcher = ((_url: unknown, init: RequestInit) => fetch(`http://127.0.0.1:${server.port}`, init)) as unknown as typeof fetch;
      await expect(analyzeReceipt(request, { fetch: fetcher, timeoutMs: 10 })).rejects.toThrow("Zeitlimit");
    } finally { server.stop(true); }
  });
});
