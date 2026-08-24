import { describe, expect, it } from "vitest";
import { contextMeasurementFailureText } from "../src/predictionLoopHandler";

describe("prediction-loop diagnostics", () => {
  it("explains unreachable external endpoints without returning an empty reply", () => {
    expect(
      contextMeasurementFailureText(
        new TypeError("fetch failed", {
          cause: new Error("connect ECONNREFUSED 127.0.0.1:8000"),
        }),
      ),
    ).toMatch(/endpoint is unreachable/i);
  });

  it("explains tokenizer incompatibility for LM Studio and vLLM", () => {
    expect(
      contextMeasurementFailureText(
        new Error("/llm/tokenize returned no usable token count."),
      ),
    ).toMatch(/exact ID of a loaded model.*\/llm\/tokenize/i);
  });

  it("preserves the actionable reserved-context validation", () => {
    expect(
      contextMeasurementFailureText(
        new Error(
          "Reserved context (16000) must be smaller than the model context length (8192).",
        ),
      ),
    ).toBe(
      "Reserved context (16000) must be smaller than the model context length (8192).",
    );
  });
});
