import { describe, expect, it } from "vitest";
import { stripInternalSeparators } from "../src/internalSeparator";

const marker =
  "__LM_STUDIO_INTERNAL_LSEP_SYNTHETIC_REASONING_END_f4e9a8d2c6b14d0c9e5f3a7b8c1d2e6a__";
const escapedMarker = marker.replaceAll("_", "\\_");
const markdownMarker = `**${marker.slice(2, -2).replaceAll("_", "\\_")}**`;

describe("LM Studio internal separator filtering", () => {
  it("removes raw, escaped, and Markdown-rendered separators", () => {
    for (const separator of [marker, escapedMarker, markdownMarker]) {
      expect(stripInternalSeparators(`before${separator}after`)).toBe(
        "beforeafter",
      );
    }
  });

  it("does not alter ordinary model text", () => {
    expect(stripInternalSeparators("ordinary_reasoning_text")).toBe(
      "ordinary_reasoning_text",
    );
  });
});
