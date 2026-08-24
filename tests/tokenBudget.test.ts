import { Chat, type LLM } from "@lmstudio/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveReserve,
  measureExternal,
  measureLocal,
} from "../src/tokenBudget";

const chat = Chat.from([{ role: "user", content: "hello" }]);
const options = {
  connection: { endpoint: "http://provider.test/v1", apiKey: "secret" },
  contextLimitOverride: 0,
  reserveTokens: 16000,
};

afterEach(() => vi.unstubAllGlobals());

describe("external generator measurement", () => {
  it("uses the native LM Studio tokenizer for a matching local server model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const localModel = {
      applyPromptTemplate: () => Promise.resolve("rendered local prompt"),
      getContextLength: () => Promise.resolve(8192),
      countTokens: (text: string) =>
        Promise.resolve(text === "rendered local prompt" ? 900 : 12),
    } as unknown as LLM;

    const result = await measureExternal(chat, {
      ...options,
      connection: { endpoint: "http://127.0.0.1:1234/v1", apiKey: "" },
      model: "local-model",
      reserveTokens: 1000,
      localModelResolver: (modelId) =>
        Promise.resolve(modelId === "local-model" ? localModel : undefined),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      used: 900,
      rawLimit: 8192,
      limit: 7192,
      reserve: 1000,
      modelCount: 1,
    });
    await expect(
      result.countMessage(chat.getMessagesArray()[0]!),
    ).resolves.toBe(12);
  });

  it("uses exactly one tokenize call when a model is configured", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return Promise.resolve(
          Response.json({ token_count: 1200, context_length: 64000 }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await measureExternal(chat, {
      ...options,
      model: "model-a",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const called = fetchMock.mock.calls[0]?.[0];
    expect(called instanceof Request ? called.url : called?.toString()).toBe(
      "http://provider.test/llm/tokenize",
    );
    expect(result).toMatchObject({
      used: 1200,
      rawLimit: 64000,
      limit: 48000,
      modelCount: 1,
    });
  });

  it("checks every advertised model and keeps the safest combined budget", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(
            Response.json({
              data: [
                { id: "wide", context_length: 131072 },
                { id: "tight", context_length: 32768 },
              ],
            }),
          );
        }
        if (typeof init?.body !== "string") {
          throw new Error("Expected a string request body");
        }
        const body = JSON.parse(init.body) as { model: string };
        return Promise.resolve(
          Response.json(
            body.model === "wide"
              ? { token_count: 900, context_length: 131072 }
              : { token_count: 1100, context_length: 32768 },
          ),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await measureExternal(chat, { ...options, model: "" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      used: 1100,
      rawLimit: 32768,
      limit: 16768,
      modelCount: 2,
    });
  });

  it("requires an override when tokenization publishes no limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ token_count: 50 }))),
    );
    await expect(
      measureExternal(chat, { ...options, model: "model-a" }),
    ).rejects.toThrow(/context limit override/i);
  });
});

describe("local LM Studio measurement", () => {
  it("keeps the original full-context trigger and safely caps the reserve", async () => {
    const source = {
      applyPromptTemplate: () => Promise.resolve("rendered prompt"),
      getContextLength: () => Promise.resolve(8192),
      countTokens: () => Promise.resolve(4000),
    } as unknown as LLM;

    await expect(measureLocal(source, chat, 16000)).resolves.toMatchObject({
      used: 4000,
      rawLimit: 8192,
      limit: 8192,
      reserve: 4096,
    });
  });

  it("retains half of a small model context for prompt input", () => {
    expect(effectiveReserve(2048, 16000)).toBe(1024);
    expect(effectiveReserve(131072, 16000)).toBe(16000);
  });
});
