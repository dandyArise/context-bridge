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
} from "../src/compaction";
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
});
