import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roommates } from "./src/shared/config";

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
    extraHTTPHeaders: { Origin: e2eBaseUrl, "X-Flat-Proxy-Token": "a".repeat(64), "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "fixture-owner" },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : undefined),
    },
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun server/index.ts",
    env: {
      FLAT_TRUSTED_ORIGINS: e2eBaseUrl,
      FLAT_PROXY_TOKEN: "a".repeat(64),
      FLAT_IDENTITY_MAP: JSON.stringify([
        { email: "owner@example.test", uid: "fixture-owner", roommateId: "kran" },
        ...roommates.slice(1).map((roommate) => ({
          email: `ui-${roommate.id}@example.test`, uid: `ui-${roommate.id}`, roommateId: roommate.id,
        })),
      ]),
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
