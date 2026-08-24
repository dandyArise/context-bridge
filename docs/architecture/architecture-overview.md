# Architecture overview

Context Compactor consists of two companion Node.js LM Studio plugins. The
`dandyarise/context-compactor` prediction-loop handler compacts the prompt copy, bounds tool output,
and renders model events. The separate `dandyarise/openai-compatible-generator` artifact translates
LM Studio chats/tools to OpenAI-compatible requests.

The important boundary is token measurement. `tokenBudget.ts` delegates local handles to exact SDK
methods. A generator targeting the default local LM Studio server resolves its configured loaded
model and reuses those methods; other external generator handles delegate to `externalApi.ts`.
External measurement is conservative when no model is fixed. Configuration is split between
protected global provider settings and per-chat behavior. Archives own transcript/state files; LM
Studio owns the visible chat.

Quality priorities are safe MCP pairing, explicit failure, bounded context growth, no secret
logging, stable cached chunks, and a fail-open compaction path that retains the original history.
The primary risks are the experimental LM Studio prediction-loop/generator APIs, the two-artifact
configuration that must remain aligned, exact local model-ID matching, and non-standard
`/llm/tokenize` availability.
