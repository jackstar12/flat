import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const e2eDatabasePath = join(tmpdir(), `flat-e2e-${process.pid}-${Date.now()}.sqlite`);
const e2ePort = Number(process.env.E2E_PORT ?? 4387);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    extraHTTPHeaders: { Origin: e2eBaseUrl, "X-Flat-Proxy-Token": "a".repeat(64) },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/snap/bin/chromium",
    },
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run build && bun server/index.ts",
    env: {
      FLAT_TRUSTED_ORIGINS: e2eBaseUrl,
      FLAT_PROXY_TOKEN: "a".repeat(64),
      SESSION_SECRET: "dev-secret-change-before-deploy",
      FLAT_DATABASE_PATH: e2eDatabasePath,
      PORT: String(e2ePort),
    },
    url: `${e2eBaseUrl}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
