import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/externalApi.ts",
        "src/tokenBudget.ts",
        "src/toolCap.ts",
        "src/compaction.ts",
      ],
      thresholds: {
        statements: 50,
        branches: 55,
        functions: 55,
        lines: 50,
      },
    },
  },
});
