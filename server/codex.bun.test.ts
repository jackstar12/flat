import { describe, expect, test } from "bun:test";
import { receiptCodexModelArgs } from "./codex";

describe("receipt Codex invocation", () => {
  test("pins the model and reasoning effort", () => {
    expect(receiptCodexModelArgs).toEqual([
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="low"',
    ]);
  });
});
