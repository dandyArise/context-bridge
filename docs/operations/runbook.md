# Runbook

Install with `pnpm run verify` and `scripts\install-all.ps1`, then restart LM Studio once. The script
stages the companion bundle while LM Studio installs the integration because LM Studio 0.4.21 can
replace a sibling local plugin under the same owner. Verify both
`dandyarise/context-bridge` and `dandyarise/context-bridge-external` are present after restart.
External readiness requires `/v1/models`, `/llm/tokenize`, and `/v1/chat/completions`. Run
`pnpm run discover -- <endpoint>` to verify the first two. Stop a dev session with Ctrl+C; installed
plugins are managed by LM Studio. Reinstall a known revision for rollback. Optional archives are
under the configured folder.
