import { describe, expect, it } from "vitest";
import {
  InternalSeparatorStreamFilter,
  stripInternalSeparators,
} from "../src/internalSeparator";

const marker =
  "__LM_STUDIO_INTERNAL_LSEP_SYNTHETIC_REASONING_END_f4e9a8d2c6b14d0c9e5f3a7b8c1d2e6a__";
const escapedMarker = marker.replaceAll("_", "\\_");

describe("LM Studio internal separator filtering", () => {
  it("removes raw and Markdown-escaped separators", () => {
    expect(stripInternalSeparators(`before${marker}after`)).toBe("beforeafter");
    expect(stripInternalSeparators(`before${escapedMarker}after`)).toBe(
      "beforeafter",
    );
  });

  it("removes a separator at every possible fragment boundary", () => {
    for (const separator of [marker, escapedMarker]) {
      const input = `before${separator}after`;
      for (let split = 0; split <= input.length; split++) {
        const filter = new InternalSeparatorStreamFilter();
        const output =
          filter.push(input.slice(0, split)) +
          filter.push(input.slice(split)) +
          filter.flush();
        expect(output).toBe("beforeafter");
      }
    }
  });

  it("drops an incomplete private marker without hiding ordinary text", () => {
    const filter = new InternalSeparatorStreamFilter();
    expect(filter.push("visible __LM_STUDIO_INTERNAL_LSEP_SYNTHETIC")).toBe(
      "visible ",
    );
    expect(filter.flush()).toBe("");
    expect(stripInternalSeparators("ordinary_reasoning_text")).toBe(
      "ordinary_reasoning_text",
    );
  });
});
