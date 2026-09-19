import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { roommateIds } from "../src/shared/config";

test("real private inference with synthetic receipt image", async ({ request }) => {
  test.skip(process.env.FLAT_TEST_REAL_INFERENCE !== "1", "Explicit isolated inference opt-in required");
  test.setTimeout(200_000);
  const login = await request.post("/api/login", { data: { roommateId: roommateIds[0] } });
  expect(login.status()).toBe(200);
  const before = await request.get("/api/finance");
  const snapshot = await before.text();
  const response = await request.post("/api/finance/receipt/analyze", {
    multipart: {
      receiptText: "Synthetic test receipt. Merchant TEST SHOP. One item Apples 1.00 EUR. Total 1.00 EUR. Split equally. Read the attached synthetic receipt image.",
      receipt: { name: "synthetic.png", mimeType: "image/png", buffer: readFileSync(new URL("./fixtures/synthetic-receipt.png", import.meta.url)) },
    }, timeout: 190_000,
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.analysis.items.length).toBeGreaterThan(0);
  expect(result.analysis.items.reduce((sum: number, item: { amountCents: number }) => sum + item.amountCents, 0)).toBe(100);
  expect(await (await request.get("/api/finance")).text()).toBe(snapshot);
});
