# Runbook

Install with `pnpm run verify` and `lms dev --install -y`. Verify the plugin appears by starting
`lms dev --no-notify` and checking for `Plugin started`. External readiness requires `/v1/models`,
`/llm/tokenize`, and `/v1/chat/completions`. Run `pnpm run discover -- <endpoint>` to verify the first
two. Stop a dev session with Ctrl+C; installed plugins are managed by LM Studio. Reinstall a known
revision for rollback. Optional archives are under the configured folder.
