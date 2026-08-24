const CHARS_PER_TOKEN = 4;
const STRUCTURAL_STRING_MAX = 200;

function notice(kept: number, total: number): string {
  return kept === 0
    ? `[context-compactor: no context remains for this tool output; ${total} characters were dropped. The tool itself ran.]`
    : `\n\n[Truncated by context-compactor: kept ${kept} of ${total} characters. Ask for a smaller range instead of repeating the call.]`;
}

function capDeep(value: unknown, budget: { left: number }): unknown {
  if (typeof value === "string") {
    if (value.length <= STRUCTURAL_STRING_MAX) return value;
    const kept = Math.max(0, budget.left);
    budget.left -= Math.min(value.length, kept);
    return value.length <= kept
      ? value
      : value.slice(0, kept) + notice(kept, value.length);
  }
  if (Array.isArray(value)) return value.map((item) => capDeep(item, budget));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, capDeep(item, budget)]),
    );
  }
  return value;
}

export function capResult(result: unknown, maxTokens: number): unknown {
  return capDeep(result, { left: maxTokens * CHARS_PER_TOKEN });
}

function measureTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

export function capTools<
  T extends { implementation: (...args: never[]) => unknown },
>(tools: T[], options: { maxPerResult: number; budget: number }): T[] {
  let spent = 0;
  return tools.map((tool) => ({
    ...tool,
    implementation: async (...args: never[]) => {
      const result = await tool.implementation(...args);
      const remaining = Math.max(0, options.budget - spent);
      const capped = capResult(
        result,
        Math.min(options.maxPerResult, remaining),
      );
      spent += measureTokens(capped);
      return capped;
    },
  }));
}
