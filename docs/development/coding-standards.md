# Coding standards

Keep network parsing at `externalApi.ts`, context arithmetic at `tokenBudget.ts`, and orchestration in
the prediction handler. Validate untrusted response shapes before use. Never log secrets or prompts.
Preserve MCP structures, abort signals, exact local-model behavior, and strict TypeScript settings.
New error patterns require regression tests.
