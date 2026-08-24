# Component view

- `src/index.ts`: plugin registration.
- `src/config.ts`: global protected provider fields and per-chat controls.
- `src/predictionLoopHandler.ts`: orchestration, failure classification, UI event rendering.
- `src/tokenBudget.ts`: exact local and conservative external measurements.
- `src/externalApi.ts`: validated URLs, Bearer headers, discovery, tokenization, chat conversion.
- `../context-bridge-external/src/generator.ts`: `openai-compatible-generator` request and
  SSE/tool-call streaming.
- `src/compaction.ts`: safe cuts, chunk summaries, prompt rebuilding, edit-sensitive hashes.
- `src/toolCap.ts`: shape-preserving per-result and shared reply limits.
- `src/cache.ts` / `src/archive.ts`: bounded cached summaries and atomic local persistence.
