# Troubleshooting

## Tokenizer endpoint missing

If `/llm/tokenize` returns “Unexpected endpoint or method,” external compaction cannot obtain an
authoritative count. Use a compatible vLLM bridge or the local-model path. Do not substitute a
guessed limit.

## Context limit absent

Set the override to the actual deployed `max_model_len`. The reserve must be smaller than that limit.

## Repeated compaction

Large tool dumps or bulk-data analysis do not compress well. Lower tool results, request ranges, or
disable the plugin for dump-oriented work.

## Provider authentication

401/403 indicates a missing/invalid protected API key. The key is never printed by the plugin.

## Tools unavailable

Enable the relevant tool plugins per chat. Context Bridge reports a refused or empty tool session
instead of silently pretending tool use succeeded.

## Plugin spins or companion disappears

LM Studio 0.4.21 may replace a locally installed sibling plugin under the same owner when two raw
`lms dev --install` commands run sequentially. It may also log `spawn ...node.exe ENOENT` when an
installation races LM Studio's first-start runtime extraction. Wait until
`%USERPROFILE%\.lmstudio\.internal\utils\node.exe` exists, run `scripts\install-all.ps1`, and restart
LM Studio once. The installer verifies both manifests and both production bundles before returning.
