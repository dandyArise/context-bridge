import { Chat } from "@lmstudio/sdk";
import { describe, expect, it } from "vitest";
import {
  buildChat,
  countLeadingSystemMessages,
  findSplitIndex,
  folderName,
  isSafeCut,
  prefixHash,
  renderTranscript,
  summarize,
} from "../src/compaction";
import type { TokenSource } from "../src/tokenBudget";
import { capResult } from "../src/toolCap";

function toolConversation() {
  return Chat.from({
    messages: [
      { role: "user", content: [{ type: "text", text: "inspect" }] },
      {
        role: "assistant",
        content: [
          {
            type: "toolCallRequest",
            toolCallRequest: {
              type: "function",
              id: "call-1",
              name: "read",
              arguments: {},
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "toolCallResult", toolCallId: "call-1", content: "result" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ],
  }).getMessagesArray();
}

describe("safe compaction", () => {
  it("never cuts between an MCP request and its result", () => {
    const messages = toolConversation();
    expect(isSafeCut(messages, 2)).toBe(false);
    expect(isSafeCut(messages, 3)).toBe(true);
  });

  it("prefers a user boundary within the token tail", async () => {
    const messages = toolConversation();
    await expect(
      findSplitIndex(messages, 0, 10, () => Promise.resolve(1)),
    ).resolves.toBe(4);
  });

  it("changes the prefix hash when compacted source messages are edited", () => {
    const before = toolConversation();
    const hash = prefixHash(before, 4);
    before[0]?.replaceText("edited");
    expect(prefixHash(before, 4)).not.toBe(hash);
  });

  it("builds a compacted chat without mutating the displayed history", () => {
    const history = Chat.from([
      { role: "system", content: "rules" },
      { role: "user", content: "old" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "recent" },
    ]);
    const messages = history.getMessagesArray();
    expect(countLeadingSystemMessages(messages)).toBe(1);
    const compacted = buildChat(history, messages, 1, {
      splitIndex: 3,
      summary: "state",
      memoryNote: "memory",
    });
    expect(history.getLength()).toBe(4);
    expect(compacted.getLength()).toBe(2);
    expect(compacted.getSystemPrompt()).toContain("state");
    expect(compacted.getSystemPrompt()).toContain("memory");
    expect(compacted.at(1).getText()).toBe("recent");
  });

  it("renders deterministic transcripts and readable archive folder names", () => {
    const messages = toolConversation();
    expect(renderTranscript(messages)).toContain("[calls tool: read({})]");
    expect(renderTranscript(messages)).toContain("[tool result: result]");
    expect(folderName(messages)).toMatch(/^inspect-[a-f0-9]{8}$/);
  });

  it("caps payload strings while preserving MCP result structure", () => {
    const capped = capResult(
      { content: [{ type: "text", text: "x".repeat(500) }], ok: true },
      20,
    ) as { content: Array<{ type: string; text: string }>; ok: boolean };
    expect(capped.content[0]?.type).toBe("text");
    expect(capped.content[0]?.text).toContain("Truncated by context-compactor");
    expect(capped.ok).toBe(true);
  });

  it("adapts summary chunks to a 2048-token model", async () => {
    const messages = Chat.from([
      { role: "user", content: "long context ".repeat(1200) },
    ]).getMessagesArray();
    const prompts: string[] = [];
    const outputCaps: number[] = [];
    const source = {
      applyPromptTemplate: (chat: Chat) =>
        Promise.resolve(`[template]\n${chat.at(0).getText()}`),
      getContextLength: () => Promise.resolve(2048),
      countTokens: (text: string) =>
        Promise.resolve(Math.ceil(text.length / 4)),
      respond: (
        chat: Chat,
        options: { maxTokens?: number },
      ): Promise<{ content: string }> => {
        prompts.push(chat.at(0).getText());
        outputCaps.push(options.maxTokens ?? 0);
        return Promise.resolve({ content: `summary ${prompts.length}` });
      },
    } as unknown as TokenSource;
    const cache = new Map<string, string>();

    const result = await summarize(source, messages, {
      signal: new AbortController().signal,
      cache: {
        get: (key) => Promise.resolve(cache.get(key)),
        set: (key, value) => {
          cache.set(key, value);
          return Promise.resolve();
        },
      },
      chunkTokens: 16000,
      rawContextTokens: 2048,
      countTokens: (message) =>
        Promise.resolve(Math.ceil(message.getText().length / 4)),
    });

    expect(result.chunksTotal).toBeGreaterThan(1);
    expect(result.summary).not.toBe("");
    expect(outputCaps.every((cap) => cap === 256)).toBe(true);
    expect(prompts.every((prompt) => Math.ceil(prompt.length / 4) < 2048)).toBe(
      true,
    );
  });
});
