import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ReceiptRequest = {
  prompt: string;
  document: File | null;
  outputSchema: Record<string, unknown>;
};

const codexTimeoutMs = 180_000;
export const receiptCodexModelArgs = ["--model", "gpt-5.6-sol", "--config", 'model_reasoning_effort="low"'] as const;

export async function analyzeReceiptWithCodex(request: ReceiptRequest): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flat-codex-"));
  const schemaPath = join(directory, "receipt.schema.json");
  const outputPath = join(directory, "response.json");

  try {
    await Bun.write(schemaPath, JSON.stringify(request.outputSchema));
    const args = [
      process.env.CODEX_BIN?.trim() || "codex",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ignore-rules",
      ...receiptCodexModelArgs,
      "-C",
      directory,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      request.prompt,
    ];

    if (request.document) {
      for (const imagePath of await documentImagePaths(directory, request.document)) {
        args.push("--image", imagePath);
      }
    }
    const subprocess = Bun.spawn(args, {
      cwd: directory,
      env: globalThis.process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      subprocess.kill();
    }, codexTimeoutMs);
    const exitCode = await subprocess.exited;
    clearTimeout(timeout);

    if (timedOut) {
      throw new Error("Codex-Rechnungsanalyse hat das Zeitlimit uberschritten.");
    }
    if (exitCode !== 0) {
      const details = (await new Response(subprocess.stderr).text()).trim();
      throw new Error(`Codex-Rechnungsanalyse fehlgeschlagen${details ? `: ${details}` : "."}`);
    }

    const output = await Bun.file(outputPath).text();
    if (!output.trim()) {
      throw new Error("Codex-Rechnungsanalyse hat keine Antwort geliefert.");
    }
    return output;
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
    stderr: "pipe",
  });
  const exitCode = await conversion.exited;
  if (exitCode !== 0) {
    const details = (await new Response(conversion.stderr).text()).trim();
    throw new Error(`PDF konnte nicht gelesen werden${details ? `: ${details}` : "."}`);
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
