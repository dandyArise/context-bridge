import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "externalEndpoint",
    "string",
    {
      displayName: "External OpenAI-compatible endpoint",
      subtitle:
        "Base URL including /v1. Local LM Studio uses its native tokenizer; other external generators use /llm/tokenize.",
      placeholder: "http://127.0.0.1:1234/v1",
    },
    "http://127.0.0.1:1234/v1",
  )
  .field(
    "externalApiKey",
    "string",
    {
      displayName: "External API key (optional)",
      subtitle:
        "Sent only as a Bearer token and stored by LM Studio as a protected value.",
      isProtected: true,
      placeholder: "Leave empty for an unauthenticated local endpoint",
    },
    "",
  )
  .build();

export const configSchematics = createConfigSchematics()
  .field(
    "externalModel",
    "string",
    {
      displayName: "External model (optional)",
      subtitle:
        "Exact /v1/models ID. When empty, token counting checks every advertised model and uses the safest limit.",
      placeholder: "Qwen/Qwen3-32B",
    },
    "",
  )
  .field(
    "contextLimitOverride",
    "numeric",
    {
      displayName: "External context limit override",
      subtitle:
        "0 uses the local LM Studio model, provider metadata, or /llm/tokenize. A positive value is a hard safety ceiling.",
      int: true,
      min: 0,
      max: 4_000_000,
      step: 1024,
    },
    0,
  )
  .field(
    "reserveTokens",
    "numeric",
    {
      displayName: "Reserved context",
      subtitle:
        "Reserved for output/tools and automatically capped at half of smaller model contexts.",
      int: true,
      min: 1000,
      max: 262144,
      step: 1000,
    },
    16000,
  )
  .field(
    "triggerPercent",
    "numeric",
    {
      min: 0.05,
      max: 0.95,
      displayName: "Compaction trigger",
      subtitle:
        "External: fraction after reserve. Local LM Studio: original fraction of the full context.",
      slider: { min: 0.05, max: 0.95, step: 0.05 },
      precision: 2,
    },
    0.6,
  )
  .field(
    "keepRecentTokens",
    "numeric",
    {
      int: true,
      min: 500,
      max: 131072,
      displayName: "Recent context kept verbatim",
      subtitle:
        "Preferred tail budget; automatically reduced when the active model context is smaller.",
      step: 500,
    },
    6000,
  )
  .field(
    "chunkTokens",
    "numeric",
    {
      int: true,
      min: 2000,
      max: 131072,
      displayName: "Summarize in chunks of",
      subtitle:
        "Preferred history size per summary; automatically reduced to fit the active model context.",
      step: 1000,
    },
    16000,
  )
  .field(
    "maxToolResultTokens",
    "numeric",
    {
      int: true,
      min: 500,
      max: 32768,
      displayName: "Maximum size of a tool result",
      subtitle:
        "Per-result ceiling; a shared per-reply budget is enforced as well.",
      step: 500,
    },
    4000,
  )
  .field(
    "vaultPath",
    "string",
    {
      displayName: "Archive folder (optional)",
      subtitle:
        "Writes transcripts and consolidated state locally. Empty writes nothing to disk.",
    },
    "",
  )
  .field(
    "showStatus",
    "boolean",
    {
      displayName: "Announce compaction in chat",
      subtitle:
        "Show before/after token counts without adding the notice to model context.",
    },
    true,
  )
  .build();
