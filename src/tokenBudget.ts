import type { Chat, ChatMessage, LLM, LLMGeneratorHandle } from "@lmstudio/sdk";
import {
  listExternalModels,
  toOpenAIMessages,
  tokenizeExternal,
  type ExternalConnection,
} from "./externalApi";

export type TokenSource = LLM | LLMGeneratorHandle;

export interface ContextMeasurement {
  used: number;
  limit: number;
  rawLimit: number;
  reserve: number;
  modelCount: number;
  countMessage: (message: ChatMessage) => Promise<number>;
}

export interface ExternalMeasurementOptions {
  connection: ExternalConnection;
  model: string;
  contextLimitOverride: number;
  reserveTokens: number;
  signal?: AbortSignal;
  localModelResolver?: (modelId: string) => Promise<LLM | undefined>;
}

export function isLocalLLM(source: TokenSource): source is LLM {
  const candidate = source as LLM;
  return (
    typeof candidate.countTokens === "function" &&
    typeof candidate.getContextLength === "function" &&
    typeof candidate.applyPromptTemplate === "function"
  );
}

export function effectiveReserve(
  rawLimit: number,
  requestedReserve: number,
): number {
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    throw new Error(`Invalid model context length: ${rawLimit}.`);
  }
  if (!Number.isFinite(requestedReserve) || requestedReserve < 0) {
    throw new Error(`Invalid reserved context: ${requestedReserve}.`);
  }

  // A large default is useful for wide-context models but must not make a
  // smaller local or external model unusable. Always retain at least half of
  // the context for the prompt and compacted state.
  return Math.min(
    Math.floor(requestedReserve),
    Math.max(1, Math.floor(rawLimit / 2)),
  );
}

function effectiveLimit(rawLimit: number, reserve: number): number {
  return rawLimit - reserve;
}

export async function measureLocal(
  source: LLM,
  chat: Chat,
  reserveTokens: number,
): Promise<ContextMeasurement> {
  const [rendered, rawLimit] = await Promise.all([
    source.applyPromptTemplate(chat),
    source.getContextLength(),
  ]);
  const used = await source.countTokens(rendered);
  const reserve = effectiveReserve(rawLimit, reserveTokens);
  return {
    used,
    rawLimit,
    reserve,
    // Keep the original LM Studio compaction threshold. The configurable reserve is
    // applied to tool-result capacity, while external generators reserve it before dispatch.
    limit: rawLimit,
    modelCount: 1,
    countMessage: (message) => source.countTokens(message.getText()),
  };
}

function renderedLength(messages: unknown[]): number {
  return Math.max(1, JSON.stringify(messages).length);
}

function proportionalCounter(charsPerToken: number) {
  return (message: ChatMessage): Promise<number> =>
    Promise.resolve(
      Math.max(1, Math.ceil(message.toString().length / charsPerToken)),
    );
}

/**
 * Generator handles expose no tokenizer or context length directly. A generator targeting the
 * default local LM Studio server can resolve the configured loaded model and reuse its native
 * tokenizer. Other providers use their vLLM-compatible endpoint: with an explicit model this
 * performs one /llm/tokenize request; without one it discovers /v1/models, tokenizes against every
 * model once, and combines the largest observed usage with the smallest known context limit.
 */
export async function measureExternal(
  chat: Chat,
  options: ExternalMeasurementOptions,
): Promise<ContextMeasurement> {
  const messages = toOpenAIMessages(chat);
  const requestedModel = options.model.trim();

  if (requestedModel !== "") {
    const localModel = await options.localModelResolver?.(requestedModel);
    if (localModel !== undefined) {
      const [rendered, detectedRawLimit] = await Promise.all([
        localModel.applyPromptTemplate(chat),
        localModel.getContextLength(),
      ]);
      const rawLimit =
        options.contextLimitOverride > 0
          ? options.contextLimitOverride
          : detectedRawLimit;
      const used = await localModel.countTokens(rendered);
      const reserve = effectiveReserve(rawLimit, options.reserveTokens);
      return {
        used,
        rawLimit,
        reserve,
        limit: effectiveLimit(rawLimit, reserve),
        modelCount: 1,
        countMessage: (message) => localModel.countTokens(message.getText()),
      };
    }
    const result = await tokenizeExternal(
      options.connection,
      requestedModel,
      messages,
      options.signal,
    );
    const rawLimit =
      options.contextLimitOverride > 0
        ? options.contextLimitOverride
        : result.contextLength;
    if (rawLimit === undefined) {
      throw new Error(
        "/llm/tokenize did not publish a context limit. Configure External context limit override.",
      );
    }
    const charsPerToken = renderedLength(messages) / result.used;
    const reserve = effectiveReserve(rawLimit, options.reserveTokens);
    return {
      used: result.used,
      rawLimit,
      reserve,
      limit: effectiveLimit(rawLimit, reserve),
      modelCount: 1,
      countMessage: proportionalCounter(charsPerToken),
    };
  }

  const models = await listExternalModels(options.connection, options.signal);
  const results: Array<{ used: number; limit?: number }> = [];
  for (const model of models) {
    const tokenized = await tokenizeExternal(
      options.connection,
      model.id,
      messages,
      options.signal,
    );
    const discoveredLimit = tokenized.contextLength ?? model.contextLength;
    results.push({
      used: tokenized.used,
      ...(discoveredLimit === undefined ? {} : { limit: discoveredLimit }),
    });
  }

  const used = Math.max(...results.map((result) => result.used));
  const advertisedLimits = results.flatMap((result) =>
    result.limit === undefined ? [] : [result.limit],
  );
  const rawLimit =
    options.contextLimitOverride > 0
      ? options.contextLimitOverride
      : advertisedLimits.length > 0
        ? Math.min(...advertisedLimits)
        : undefined;
  if (rawLimit === undefined) {
    throw new Error(
      "No discovered model published a context limit. Configure External context limit override.",
    );
  }

  const charsPerToken = renderedLength(messages) / used;
  const reserve = effectiveReserve(rawLimit, options.reserveTokens);
  return {
    used,
    rawLimit,
    reserve,
    limit: effectiveLimit(rawLimit, reserve),
    modelCount: models.length,
    countMessage: proportionalCounter(charsPerToken),
  };
}

export async function measureContext(
  source: TokenSource,
  chat: Chat,
  options: ExternalMeasurementOptions,
): Promise<ContextMeasurement> {
  return isLocalLLM(source)
    ? measureLocal(source, chat, options.reserveTokens)
    : measureExternal(chat, options);
}
