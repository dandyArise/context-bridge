import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverExternalCatalog,
  endpointFor,
  isMaximumContextError,
  normalizeEndpoint,
  parseTokenizeResult,
} from "../src/externalApi";

afterEach(() => vi.unstubAllGlobals());

describe("external API boundaries", () => {
  it("normalizes the OpenAI base and keeps tokenize outside /v1", () => {
    const connection = { endpoint: "http://127.0.0.1:8000/v1/", apiKey: "" };
    expect(endpointFor(connection, "models").href).toBe(
      "http://127.0.0.1:8000/v1/models",
    );
    expect(endpointFor(connection, "modelInfo").href).toBe(
      "http://127.0.0.1:8000/v1/model/info",
    );
    expect(endpointFor(connection, "chat").href).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
    expect(endpointFor(connection, "tokenize").href).toBe(
      "http://127.0.0.1:8000/llm/tokenize",
    );
  });

  it("rejects secrets embedded in URLs", () => {
    expect(() => normalizeEndpoint("https://secret@example.com/v1")).toThrow(
      /credentials/i,
    );
  });

  it("accepts common token-count response shapes", () => {
    expect(
      parseTokenizeResult({ token_count: 42, context_length: 32768 }),
    ).toEqual({
      used: 42,
      contextLength: 32768,
    });
    expect(parseTokenizeResult({ tokens: [1, 2, 3] })).toEqual({ used: 3 });
  });

  it("detects old and new context overflow messages", () => {
    expect(isMaximumContextError(new Error("exceed_context_size"))).toBe(true);
    expect(
      isMaximumContextError(
        new Error(
          "This model's maximum context length is 8192 tokens and your request has 9000",
        ),
      ),
    ).toBe(true);
    expect(isMaximumContextError(new Error("socket closed"))).toBe(false);
  });

  it("merges optional model capabilities without changing the base model list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        return Promise.resolve(
          url.endsWith("/v1/models")
            ? Response.json({ data: [{ id: "model-a", context_length: 8192 }] })
            : Response.json({
                data: [
                  {
                    model_name: "model-a",
                    model_info: {
                      max_input_tokens: 16384,
                      supports_function_calling: true,
                      supports_vision: false,
                    },
                  },
                ],
              }),
        );
      }),
    );

    await expect(
      discoverExternalCatalog({
        endpoint: "http://provider.test/v1",
        apiKey: "",
      }),
    ).resolves.toEqual({
      models: [
        {
          id: "model-a",
          contextLength: 16384,
          capabilities: {
            supports_function_calling: true,
            supports_vision: false,
          },
        },
      ],
      warnings: [],
    });
  });

  it("falls back cleanly when /v1/model/info is unsupported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        return Promise.resolve(
          url.endsWith("/v1/models")
            ? Response.json({ data: [{ id: "model-a" }] })
            : new Response(null, { status: 404 }),
        );
      }),
    );

    const catalog = await discoverExternalCatalog({
      endpoint: "http://provider.test/v1",
      apiKey: "",
    });
    expect(catalog.models).toEqual([{ id: "model-a" }]);
    expect(catalog.warnings[0]).toMatch(/not supported/i);
  });
});
