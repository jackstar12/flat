import { describe, expect, it } from "vitest";
import { resolveExpensePayer } from "./expense-payer";

describe("expense payer defaults (manual and receipt forms)", () => {
  it("waits for asynchronous identity without inventing a payer", () => {
    const newFormPayer = null;
    expect(resolveExpensePayer(newFormPayer, undefined)).toBe("");
    expect(resolveExpensePayer(newFormPayer, "synthetic-actor")).toBe("synthetic-actor");
  });

  it("keeps a manual choice made before identity arrives", () => {
    const selected = "synthetic-other";
    expect(resolveExpensePayer(selected, undefined)).toBe(selected);
    expect(resolveExpensePayer(selected, "synthetic-actor")).toBe(selected);
  });

  it("preserves explicit choices, including the current default, on identity updates", () => {
    expect(resolveExpensePayer("synthetic-actor", "synthetic-actor")).toBe("synthetic-actor");
    expect(resolveExpensePayer("synthetic-actor", "synthetic-next")).toBe("synthetic-actor");
  });

  it("preserves an existing expense's payer across asynchronous identity changes", () => {
    const savedPayer = "synthetic-saved";
    expect(resolveExpensePayer(savedPayer, undefined)).toBe(savedPayer);
    expect(resolveExpensePayer(savedPayer, "synthetic-actor")).toBe(savedPayer);
    expect(resolveExpensePayer("", "synthetic-actor")).toBe("");
  });

  it("uses the latest identity after a new form resets or reopens", () => {
    let payer: string | null = "synthetic-override";
    expect(resolveExpensePayer(payer, "synthetic-actor")).toBe(payer);
    payer = null;
    expect(resolveExpensePayer(payer, "synthetic-next")).toBe("synthetic-next");
    expect(resolveExpensePayer(payer, null)).toBe("");
  });
});
