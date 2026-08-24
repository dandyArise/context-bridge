# Data flow

1. LM Studio supplies a copy of visible history and the selected token source.
2. Local models are measured by their prompt template/tokenizer. Generator handles are measured by
   one `/llm/tokenize` call for a fixed model, or discovery plus one call per model when empty.
3. External generators remove the configured reserve from the raw compaction limit. Local LM
   Studio models retain the original full-context trigger; in both paths the reserve protects
   output and tool-result capacity. A safe completed-turn cut never separates MCP calls/results.
4. Original messages are chunked. Cached hashes reuse identical summaries; uncached chunks are
   summarized by the selected model and merged.
5. Only the prompt copy is rebuilt. Optional archives receive the removed transcript and state.
6. Tools run normally. Returned text is capped in place, preserving result structure.
7. The selected model/generator streams the response back into LM Studio content blocks.

Failures in compaction restore full history. Network/tokenization failures are explicit because a
fabricated context limit would be unsafe. Archives have no automatic retention; users control the
folder lifecycle.
