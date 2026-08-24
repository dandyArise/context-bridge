# Context Compactor

## Purpose

Context Compactor is an LM Studio integration that keeps long working chats below their context limit.
It preserves LM Studio's native local-model path and can compact external generator conversations.
Its companion `dandyarise/openai-compatible-generator` provides OpenAI-compatible generation for
vLLM, LiteLLM, LM Studio Server, and similar endpoints.

## Main capabilities

- Exact local-model measurement through the LM Studio SDK.
- External-generator measurement through `POST /llm/tokenize` for vLLM-compatible providers.
- Native SDK tokenization when the external generator targets a loaded model on the local LM Studio
  server at `http://127.0.0.1:1234`.
- One tokenize request when an external model ID is configured.
- When the model ID is empty: `GET /v1/models`, one tokenize request per model, then the safest
  combination (largest observed prompt and smallest known context window).
- Optional `/v1/model/info` enrichment for tool choice, function calling, response schema, web,
  reasoning, and vision capabilities; unsupported providers fall back to `/v1/models`.
- Configurable hard context override and configurable reserve (`16,000` tokens by default), safely
  capped at half of smaller context windows.
- Source-derived, chunk-cached summaries with context-aware chunk sizing and hierarchical merging.
- MCP request/result pairs are never split; tool payload shape is preserved when text is capped.
- Private LM Studio reasoning separators are removed from streamed output and stored summaries.
- Optional local transcript/state archive with atomic writes.
- Companion generator with OpenAI-compatible streaming, reasoning fragments, function calls,
  optional Bearer authentication, and cancellation.

## Architecture summary

The prediction-loop handler owns compaction and tool-result budgets. For a local LM Studio model it
uses `applyPromptTemplate`, `countTokens`, and `getContextLength`. For a generator targeting the
default local LM Studio server, it resolves the configured loaded model and uses the same native
tokenizer. Other generator handles call the configured external `/llm/tokenize` endpoint. The
separate `openai-compatible-generator` artifact streams `/v1/chat/completions`. This split is required
because LM Studio hides generator plugins from Integrations and exposes them as models. The
displayed chat is never modified; only the prompt copy passed to the selected model is rebuilt.
This follows [LM Studio's documented fit check](https://lmstudio.ai/docs/python/model-info/get-context-length):
render the chat with the model prompt template, count its tokens, and compare that count with the
loaded model's context length.

See [architecture-overview.md](docs/architecture/architecture-overview.md).

## Requirements

- LM Studio with plugin support and `lms` CLI.
- Node.js 20 or newer for development.
- An external server implementing `/v1/chat/completions`; non-LM-Studio providers must also expose
  `/llm/tokenize` for exact external compaction.

## Installation

```powershell
pnpm install
pnpm run verify
.\scripts\install-all.ps1
```

Keep LM Studio open and fully initialized while running the installer, then restart it once. The
script preserves both plugin bundles despite the LM Studio 0.4.21 local installer's same-owner
replacement behavior.

Enable `dandyarise/context-compactor` in Integrations. Keep a normal local model selected for the
local path, or select `dandyarise/openai-compatible-generator` in the model dropdown for an
OpenAI-compatible endpoint.

## Configuration

Global settings, persisted by LM Studio:

- `External OpenAI-compatible endpoint`: base URL ending in `/v1`.
- `External API key`: optional protected Bearer token.

The integration's per-chat settings include external model ID, context-limit override,
`16,000`-token reserve, compaction trigger, verbatim tail, summary chunk size, tool cap, and archive
folder. After selecting the generator companion, open the chat configuration tab (sliders icon) to
set its model ID, temperature, and maximum-output settings; its plugin-wide endpoint and optional
Bearer key are shown once in the same panel. Configure the same endpoint, API key, and model ID in
both artifacts. For `http://127.0.0.1:1234/v1`, the ID must match a model already loaded in LM
Studio so its native tokenizer can be used. An empty generator model ID auto-selects the model only
when `/v1/models` returns exactly one ID; otherwise the error lists the available IDs so no
arbitrary model is used. A zero context override requires the local loaded model, `/llm/tokenize`,
or model metadata to report the limit. The requested reserve is automatically capped at half of the
active model context, so the `16,000` default remains usable with 2K/8K models. It lowers the external compaction
ceiling; for local LM Studio models it protects output/tool capacity without changing the original
full-context compaction threshold. The verbatim tail and summary chunks are also reduced
automatically when they cannot fit the loaded model.

List model IDs, context sizes, tokenizer availability, and advertised capabilities without placing
the key on the command line:

```powershell
$env:CONTEXT_BRIDGE_API_KEY = 'your-key-if-required'
pnpm run discover -- http://127.0.0.1:1234/v1
Remove-Item Env:CONTEXT_BRIDGE_API_KEY
```

## Local development

```powershell
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
lms dev --no-notify # integration only
```

## Testing

```powershell
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Tests cover endpoint construction, Bearer-safe URL validation, tokenize response variants, the
single-model request count, empty-model safe aggregation, MCP cut boundaries, edit invalidation,
2K-context summary chunking, internal-separator filtering across stream boundaries, tool-shape
preservation, and split SSE frames.

## Build

`pnpm run build` emits CommonJS plugin files at the project root. Generated `.js` and source maps are
ignored; TypeScript in `src/` is authoritative.

## Deployment

For a local LM Studio installation, run `.\scripts\install-all.ps1`. It installs the integration
and its companion generator. Neither artifact is a standalone HTTP service or opens a listening
port.

## Troubleshooting

- `Unexpected endpoint or method (/llm/tokenize)`: for local LM Studio on port `1234`, set the exact
  ID of an already loaded model in both plugins; otherwise the provider must expose the tokenizer
  contract.
- `did not publish a context limit`: set `External context limit override` to the deployed limit.
- `maximum context length` while summarizing: update/reinstall the plugin; current releases derive
  summary chunks from the loaded context length. If it occurs during the final reply, lower the
  verbatim tail or tool-result ceiling.
- No tools: verify tool plugins are enabled for that chat; Context Compactor reports refused sessions.
- A plugin spins indefinitely or disappears after installing its companion: confirm
  `C:\Users\<you>\.lmstudio\.internal\utils\node.exe` exists, run `scripts\install-all.ps1`, then
  restart LM Studio. Do not install the two repositories sequentially with raw `lms dev --install`.

See [troubleshooting.md](docs/operations/troubleshooting.md).

## Documentation index

- [Architecture overview](docs/architecture/architecture-overview.md)
- [System context](docs/architecture/system-context.md)
- [Container view](docs/architecture/container-view.md)
- [Component view](docs/architecture/component-view.md)
- [Data flow](docs/architecture/data-flow.md)
- [Security](docs/architecture/security.md)
- [Observability](docs/architecture/observability.md)
- [Deployment](docs/architecture/deployment.md)
- [Local development](docs/development/local-development.md)
- [Testing strategy](docs/development/testing-strategy.md)
- [Coding standards](docs/development/coding-standards.md)
- [Runbook](docs/operations/runbook.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
