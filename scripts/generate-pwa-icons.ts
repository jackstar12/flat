import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Run with bun; PLAYWRIGHT_CHROMIUM_PATH can select an already installed browser.
// No image-generation dependency. Keep the opaque background for maskable/iOS.
const directory = resolve(import.meta.dir, "../public/icons");
const source = await readFile(resolve(directory, "source.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
try {
  for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["maskable-512", 512], ["apple-touch-icon", 180]] as const) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.screenshot({ path: resolve(directory, `${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
