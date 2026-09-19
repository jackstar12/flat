import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { z } from "zod";

type ReceiptRequest = {
  prompt: string;
  document: File | null;
  outputSchema: Record<string, unknown>;
};

export const receiptModel = "gpt-5.6-sol";
export const receiptReasoningEffort = "low";
const maximumResponseBytes = 2_000_000;

// Options permit deterministic failure tests; production uses the fixed three-minute deadline.
export async function analyzeReceipt(request: ReceiptRequest, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  if (!apiKey || !baseUrl) throw new Error("Rechnungsanalyse ist nicht konfiguriert.");
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/responses`);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Rechnungsanalyse erfordert eine HTTPS-API-URL.");
  }
  const directory = await mkdtemp(join(tmpdir(), "flat-receipt-"));
  try {
    const content: Record<string, unknown>[] = [{ type: "input_text", text: request.prompt }];
    if (request.document) {
      for (const path of await documentImagePaths(directory, request.document)) {
        const mime = { ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" }[extname(path)] ?? "image/jpeg";
        content.push({ type: "input_image", image_url: `data:${mime};base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}` });
      }
    }
    const signal = AbortSignal.timeout(options.timeoutMs ?? 180_000);
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: receiptModel, reasoning: { effort: receiptReasoningEffort },
        input: [{ role: "user", content }], tools: [], tool_choice: "none",
        store: false, max_output_tokens: 16_384,
        text: { format: { type: "json_schema", name: "receipt", strict: true, schema: request.outputSchema } },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Rechnungsanalyse fehlgeschlagen (HTTP ${response.status}).`);
    }
    if (!response.body) throw new Error("Rechnungsanalyse hat keine Antwort geliefert.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximumResponseBytes) throw new Error("Rechnungsanalyse-Antwort ist zu gross.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (envelope.status !== "completed" || !Array.isArray(envelope.output)) throw new Error("Rechnungsanalyse ist unvollstandig.");
    const messages = envelope.output.filter((item: { type: string }) => item.type === "message");
    const parts = messages.flatMap((item: { content: unknown[] }) => item.content);
    if (!parts.length || parts.some((part: { type: string }) => part.type !== "output_text")) throw new Error("Rechnungsanalyse hat keine Textantwort geliefert.");
    const output = parts.map((part: { text: string }) => part.text).join("");
    const parsed = JSON.parse(output);
    if (!z.fromJSONSchema(request.outputSchema).safeParse(parsed).success) throw new Error("Rechnungsanalyse hat ein ungultiges Schema geliefert.");
    return output;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Rechnungsanalyse")) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new Error("Rechnungsanalyse hat das Zeitlimit uberschritten.");
    throw new Error("Rechnungsanalyse hat keine gultige Antwort geliefert.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function documentImagePaths(directory: string, document: File): Promise<string[]> {
  const isPdf = document.type === "application/pdf" || document.name.toLocaleLowerCase().endsWith(".pdf");
  if (!isPdf) {
    const imagePath = join(directory, imageFilename(document.type));
    await Bun.write(imagePath, document);
    return [imagePath];
  }

  const pdfPath = join(directory, "receipt.pdf");
  const outputPrefix = join(directory, "receipt-page");
  await Bun.write(pdfPath, document);
  const conversion = Bun.spawn(["pdftoppm", "-png", "-r", "160", "-f", "1", "-l", "8", pdfPath, outputPrefix], {
    cwd: directory,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const timer = setTimeout(() => conversion.kill(), 180_000);
  const exitCode = await conversion.exited.finally(() => clearTimeout(timer));
  if (exitCode !== 0) {
    throw new Error("PDF konnte nicht gelesen werden.");
  }

  const pages = (await readdir(directory))
    .filter((name) => /^receipt-page-\d+\.png$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => join(directory, name));
  if (pages.length === 0) {
    throw new Error("PDF enthalt keine lesbaren Seiten.");
  }
  return pages;
}

function imageFilename(mimeType: string): string {
  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/gif"
          ? "gif"
          : "jpg";
  return `receipt.${extension}`;
}
