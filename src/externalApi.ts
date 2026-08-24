import type { Chat, ChatMessage } from "@lmstudio/sdk";

export interface ExternalConnection {
  endpoint: string;
  apiKey: string;
}

export interface ExternalModelInfo {
  id: string;
  contextLength?: number;
  capabilities?: Partial<Record<ExternalCapability, boolean>>;
}

export type ExternalCapability =
  | "supports_tool_choice"
  | "supports_function_calling"
  | "supports_response_schema"
  | "supports_web_search"
  | "supports_reasoning"
  | "supports_vision";

export interface ExternalCatalog {
  models: ExternalModelInfo[];
  warnings: string[];
}

const CAPABILITIES: ExternalCapability[] = [
  "supports_tool_choice",
  "supports_function_calling",
  "supports_response_schema",
  "supports_web_search",
  "supports_reasoning",
  "supports_vision",
];

export class ExternalApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExternalApiError";
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveInteger(...values: unknown[]): number | undefined {
  return values.find(
    (value) =>
      typeof value === "number" && Number.isInteger(value) && value > 0,
  ) as number | undefined;
}

export function normalizeEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (error) {
    throw new ExternalApiError(
      "External endpoint is not a valid URL.",
      undefined,
      { cause: error },
    );
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new ExternalApiError(
      "External endpoint must use http:// or https://.",
    );
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ExternalApiError(
      "External endpoint must not contain credentials, a query string, or a fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

export function endpointFor(
  connection: ExternalConnection,
  route: "models" | "modelInfo" | "tokenize" | "chat",
) {
  const base = normalizeEndpoint(connection.endpoint);
  switch (route) {
    case "models":
      return new URL("models", base);
    case "modelInfo":
      return new URL("model/info", base);
    case "chat":
      return new URL("chat/completions", base);
    case "tokenize":
      return new URL("../llm/tokenize", base);
  }
}

export function requestHeaders(connection: ExternalConnection): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (connection.apiKey.trim() !== "") {
    headers.set("Authorization", `Bearer ${connection.apiKey.trim()}`);
  }
  return headers;
}

async function json(response: Response, operation: string): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ExternalApiError(
      `${operation} returned invalid JSON.`,
      response.status,
      { cause: error },
    );
  }
  if (!response.ok) {
    const detail = asObject(body)?.error;
    const safeDetail =
      typeof detail === "string"
        ? detail
        : typeof asObject(detail)?.message === "string"
          ? String(asObject(detail)?.message)
          : `HTTP ${response.status}`;
    throw new ExternalApiError(
      `${operation} failed: ${safeDetail}`,
      response.status,
    );
  }
  return body;
}

export async function listExternalModels(
  connection: ExternalConnection,
  signal?: AbortSignal,
): Promise<ExternalModelInfo[]> {
  const response = await fetch(endpointFor(connection, "models"), {
    headers: requestHeaders(connection),
    ...(signal === undefined ? {} : { signal }),
  });
  const body = asObject(await json(response, "Model discovery"));
  const data = Array.isArray(body?.data) ? body.data : [];
  const models = data.flatMap((value) => {
    const record = asObject(value);
    if (
      record === undefined ||
      typeof record.id !== "string" ||
      record.id.trim() === ""
    )
      return [];
    const nested = asObject(record.model_info);
    const contextLength = positiveInteger(
      record.max_input_tokens,
      record.context_length,
      record.context_window,
      record.max_model_len,
      nested?.max_input_tokens,
      nested?.context_length,
      nested?.context_window,
      nested?.max_model_len,
    );
    return [
      {
        id: record.id.trim(),
        ...(contextLength === undefined ? {} : { contextLength }),
      },
    ];
  });
  if (models.length === 0)
    throw new ExternalApiError("Model discovery returned no model IDs.");
  return models;
}

function modelInfoId(record: Record<string, unknown>): string | undefined {
  const nested = asObject(record.model_info);
  const candidate =
    record.id ??
    record.model_name ??
    record.model ??
    nested?.id ??
    nested?.model_name;
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : undefined;
}

function modelInfoContext(record: Record<string, unknown>): number | undefined {
  const nested = asObject(record.model_info);
  return positiveInteger(
    record.max_input_tokens,
    record.context_length,
    record.context_window,
    record.max_model_len,
    nested?.max_input_tokens,
    nested?.context_length,
    nested?.context_window,
    nested?.max_model_len,
  );
}

function modelInfoCapabilities(
  record: Record<string, unknown>,
): Partial<Record<ExternalCapability, boolean>> | undefined {
  const nested = asObject(record.model_info);
  const capabilities: Partial<Record<ExternalCapability, boolean>> = {};
  for (const capability of CAPABILITIES) {
    const value = record[capability] ?? nested?.[capability];
    if (typeof value === "boolean") capabilities[capability] = value;
  }
  return Object.keys(capabilities).length === 0 ? undefined : capabilities;
}

/**
 * Enriches the standard /v1/models list with optional /v1/model/info metadata.
 * Providers that do not implement the extension remain fully supported.
 */
export async function discoverExternalCatalog(
  connection: ExternalConnection,
  signal?: AbortSignal,
): Promise<ExternalCatalog> {
  const models = await listExternalModels(connection, signal);
  const response = await fetch(endpointFor(connection, "modelInfo"), {
    headers: requestHeaders(connection),
    ...(signal === undefined ? {} : { signal }),
  });
  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 501
  ) {
    return {
      models,
      warnings: [
        "/v1/model/info is not supported; using /v1/models metadata only.",
      ],
    };
  }

  const body = asObject(await json(response, "Model capability discovery"));
  const data = Array.isArray(body?.data) ? body.data : [];
  const metadata = new Map<string, ExternalModelInfo>();
  for (const value of data) {
    const record = asObject(value);
    if (record === undefined) continue;
    const id = modelInfoId(record);
    if (id === undefined) continue;
    const contextLength = modelInfoContext(record);
    const capabilities = modelInfoCapabilities(record);
    metadata.set(id, {
      id,
      ...(contextLength === undefined ? {} : { contextLength }),
      ...(capabilities === undefined ? {} : { capabilities }),
    });
  }

  return {
    models: models.map((model) => {
      const details = metadata.get(model.id);
      if (details === undefined) return model;
      return {
        ...model,
        ...(details.contextLength === undefined
          ? {}
          : { contextLength: details.contextLength }),
        ...(details.capabilities === undefined
          ? {}
          : { capabilities: details.capabilities }),
      };
    }),
    warnings:
      data.length === 0 ? ["/v1/model/info returned no model metadata."] : [],
  };
}

export interface TokenizeResult {
  used: number;
  contextLength?: number;
}

export function parseTokenizeResult(payload: unknown): TokenizeResult {
  const body = asObject(payload);
  if (body === undefined)
    throw new ExternalApiError("/llm/tokenize returned an invalid object.");
  const tokens = Array.isArray(body.tokens) ? body.tokens.length : undefined;
  const used = positiveInteger(
    body.token_count,
    body.tokenCount,
    body.count,
    body.num_tokens,
    tokens,
  );
  if (used === undefined)
    throw new ExternalApiError("/llm/tokenize returned no usable token count.");
  const contextLength = positiveInteger(
    body.context_length,
    body.contextLength,
    body.max_context_length,
    body.maxContextLength,
    body.max_model_len,
  );
  return { used, ...(contextLength === undefined ? {} : { contextLength }) };
}

export async function tokenizeExternal(
  connection: ExternalConnection,
  model: string,
  messages: unknown[],
  signal?: AbortSignal,
): Promise<TokenizeResult> {
  const response = await fetch(endpointFor(connection, "tokenize"), {
    method: "POST",
    headers: requestHeaders(connection),
    body: JSON.stringify({ model, messages }),
    ...(signal === undefined ? {} : { signal }),
  });
  return parseTokenizeResult(await json(response, "External tokenization"));
}

export function toOpenAIMessages(history: Chat | ChatMessage[]): unknown[] {
  const messages = Array.isArray(history)
    ? history
    : history.getMessagesArray();
  const output: unknown[] = [];
  for (const message of messages) {
    switch (message.getRole()) {
      case "system":
      case "user":
        output.push({ role: message.getRole(), content: message.getText() });
        break;
      case "assistant": {
        const toolCalls = message.getToolCallRequests().map((call) => ({
          id: call.id ?? "",
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        }));
        output.push({
          role: "assistant",
          content: message.getText(),
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
        });
        break;
      }
      case "tool":
        output.push(
          ...message.getToolCallResults().map((result) => ({
            role: "tool",
            tool_call_id: result.toolCallId ?? "",
            content: String(result.content),
          })),
        );
        break;
    }
  }
  return output;
}

export function isMaximumContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exceed_context_size|exceeds? the available context size|maximum context length|context length.*(?:exceed|limit)|max(?:imum)? model len/i.test(
    message,
  );
}
