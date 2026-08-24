# Runbook

Install with `pnpm run verify` and `scripts\install-all.ps1`, then restart LM Studio once. The script
stages the companion bundle while LM Studio installs the integration because LM Studio 0.4.21 can
replace a sibling local plugin under the same owner. Verify both
`dandyarise/context-compactor` and `dandyarise/openai-compatible-generator` are present after restart.
External readiness requires `/v1/models` and `/v1/chat/completions`. vLLM-compatible providers also
require `/llm/tokenize`; the default local LM Studio server instead requires an exact configured ID
matching a loaded model. Run `pnpm run discover -- <endpoint>` to inspect provider capabilities.
Stop a dev session with Ctrl+C; installed plugins are managed by LM Studio. Reinstall a known
revision for rollback. Optional archives are under the configured folder.
