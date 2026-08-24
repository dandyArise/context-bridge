# Troubleshooting

## Tokenizer endpoint missing

If `/llm/tokenize` returns “Unexpected endpoint or method,” external compaction cannot obtain an
authoritative count from that provider. For `http://127.0.0.1:1234`, configure the exact ID of a
model already loaded in LM Studio so Context Compactor can use its native SDK tokenizer. Otherwise use
a compatible vLLM bridge or the directly selected local-model path. Do not substitute a guessed
limit.

## Context limit absent

Set the override to the actual deployed `max_model_len`. The integration automatically caps the
requested reserve at half of that limit.

## Summary request exceeds context

The integration reads the loaded local model context length and reduces its summary chunk, output,
and verbatim-tail budgets accordingly. A `request (...) exceeds ... n_ctx` error from an older bundle
means the fixed chunk size exceeded the summarizer context; rebuild and reinstall both artifacts with
`scripts\install-all.ps1`.

## Repeated compaction

Large tool dumps or bulk-data analysis do not compress well. Lower tool results, request ranges, or
disable the plugin for dump-oriented work.

## Internal reasoning separator appears

Strings beginning with `__LM_STUDIO_INTERNAL_LSEP_` are private LM Studio delimiters, not model
content. Current bundles remove raw and Markdown-escaped forms from summaries, tool transcripts, and
streamed content even when a delimiter spans multiple fragments.

## Provider authentication

401/403 indicates a missing/invalid protected API key. The key is never printed by the plugin.

## Tools unavailable

Enable the relevant tool plugins per chat. Context Compactor reports a refused or empty tool session
instead of silently pretending tool use succeeded.

## Plugin spins or companion disappears

LM Studio 0.4.21 may replace a locally installed sibling plugin under the same owner when two raw
`lms dev --install` commands run sequentially. It may also log `spawn ...node.exe ENOENT` when an
installation races LM Studio's first-start runtime extraction. Wait until
`%USERPROFILE%\.lmstudio\.internal\utils\node.exe` exists, run `scripts\install-all.ps1`, and restart
LM Studio once. The installer verifies both manifests and both production bundles before returning.
