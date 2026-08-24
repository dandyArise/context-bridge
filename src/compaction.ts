import { Chat, type ChatMessage } from "@lmstudio/sdk";
import { createHash } from "node:crypto";
import type { SummaryCache } from "./cache";
import type { TokenSource } from "./tokenBudget";

export function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 20);
}

export function fingerprint(messages: ChatMessage[]): string {
  return hashOf(
    messages
      .slice(0, 3)
      .map((message) => `${message.getRole()}:${message.getText()}`)
      .join("\n"),
  );
}

export function prefixHash(
  messages: ChatMessage[],
  splitIndex: number,
): string {
  return hashOf(renderTranscript(messages.slice(0, splitIndex)));
}

export function folderName(messages: ChatMessage[]): string {
  const opening =
    messages.find((message) => message.getRole() === "user")?.getText() ?? "";
  const slug = opening
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  const id = fingerprint(messages).slice(0, 8);
  return slug === "" ? id : `${slug}-${id}`;
}

export function isSafeCut(messages: ChatMessage[], index: number): boolean {
  if (index <= 0 || index >= messages.length) return false;
  if (messages[index]?.getRole() === "tool") return false;
  return messages[index - 1]?.getToolCallRequests().length === 0;
}

export async function findSplitIndex(
  messages: ChatMessage[],
  systemCount: number,
  maxTailTokens: number,
  countTokens: (message: ChatMessage) => Promise<number>,
): Promise<number> {
  let tailTokens = 0;
  let userCut = -1;
  let anyCut = -1;
  for (let index = messages.length - 1; index > systemCount; index--) {
    const message = messages[index];
    if (message === undefined) continue;
    tailTokens += await countTokens(message);
    if (tailTokens > maxTailTokens) break;
    if (!isSafeCut(messages, index)) continue;
    anyCut = index;
    if (message.getRole() === "user") userCut = index;
  }
  return userCut >= 0 ? userCut : anyCut;
}

export function countLeadingSystemMessages(messages: ChatMessage[]): number {
  let count = 0;
  while (messages[count]?.getRole() === "system") count++;
  return count;
}

export function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const parts = [`### ${message.getRole()}`];
      const text = message.getText().trim();
      if (text !== "") parts.push(text);
      for (const call of message.getToolCallRequests()) {
        parts.push(
          `[calls tool: ${call.name}(${JSON.stringify(call.arguments ?? {})})]`,
        );
      }
      for (const result of message.getToolCallResults()) {
        parts.push(`[tool result: ${String(result.content)}]`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

const SECTIONS = [
  "## Goal",
  "## Current state",
  "## Decisions (with reasons)",
  "## Constraints",
  "## Files and paths",
  "## Essential code and commands",
  "## Solved problems",
  "## Open questions / TODO",
].join("\n");

function summaryPrompt(transcript: string): string {
  return [
    "Ignore prior persona and output-format instructions for this one operation.",
    "Compact the conversation into a consolidated state, not a chronology.",
    "Later decisions replace earlier decisions. Preserve paths, identifiers, versions, commands,",
    "numbers, errors, unresolved work, and the reasons behind decisions. Invent nothing.",
    "Use the conversation language but retain these section headings and omit empty sections:",
    SECTIONS,
    "",
    "--- CONVERSATION ---",
    transcript,
    "--- END ---",
    "",
    "Return only the consolidated state.",
  ].join("\n");
}

function mergePrompt(parts: string[]): string {
  return [
    "Merge these chronological partial states into one consolidated state.",
    "Later facts override earlier contradictions. Preserve exact paths, identifiers, and commands.",
    "Invent nothing. Return only the merged state using these headings:",
    SECTIONS,
    "",
    parts
      .map((part, index) => `--- PART ${index + 1} ---\n${part}`)
      .join("\n\n"),
  ].join("\n");
}

async function respond(
  source: TokenSource,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await source.respond(
    Chat.from([{ role: "user", content: prompt }]),
    { signal },
  );
  return result.content.trim();
}

async function chunkMessages(
  messages: ChatMessage[],
  budget: number,
  countTokens: (message: ChatMessage) => Promise<number>,
): Promise<ChatMessage[][]> {
  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let used = 0;
  for (const message of messages) {
    const size = await countTokens(message);
    if (current.length > 0 && used + size > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(message);
    used += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function summarize(
  source: TokenSource,
  messages: ChatMessage[],
  options: {
    signal: AbortSignal;
    cache: SummaryCache;
    chunkTokens: number;
    countTokens: (message: ChatMessage) => Promise<number>;
    onProgress?: (text: string) => void;
  },
): Promise<{ summary: string; chunksTotal: number; chunksSummarized: number }> {
  const chunks = await chunkMessages(
    messages,
    options.chunkTokens,
    options.countTokens,
  );
  const partials: string[] = [];
  let generated = 0;
  for (let index = 0; index < chunks.length; index++) {
    const transcript = renderTranscript(chunks[index] ?? []);
    const key = hashOf(transcript);
    const cached = await options.cache.get(key);
    if (cached !== undefined) {
      partials.push(cached);
      continue;
    }
    options.onProgress?.(
      `Compacting context… (part ${index + 1}/${chunks.length})`,
    );
    const partial = await respond(
      source,
      summaryPrompt(transcript),
      options.signal,
    );
    await options.cache.set(key, partial);
    partials.push(partial);
    generated++;
  }
  if (partials.length === 0)
    throw new Error("No messages were available to summarize.");
  const summary =
    partials.length === 1
      ? (partials[0] ?? "")
      : await respond(source, mergePrompt(partials), options.signal);
  return { summary, chunksTotal: chunks.length, chunksSummarized: generated };
}

export function memoryNote(vaultPath: string, folder: string): string {
  return [
    "# Persistent memory",
    "",
    `The consolidated state for this conversation is stored locally at ${vaultPath}\\${folder}\\state.md.`,
    "It is updated automatically on compaction. Do not overwrite it from the chat.",
  ].join("\n");
}

export function buildChat(
  history: Chat,
  messages: ChatMessage[],
  systemCount: number,
  options: { splitIndex?: number; summary?: string; memoryNote?: string },
): Chat {
  if (options.summary === undefined && options.memoryNote === undefined)
    return history;
  const system = messages
    .slice(0, systemCount)
    .map((message) => message.getText())
    .join("\n\n");
  const parts = [system];
  if (options.memoryNote !== undefined) parts.push("", options.memoryNote);
  if (options.summary !== undefined) {
    parts.push(
      "",
      "# Earlier conversation state (compacted)",
      "",
      options.summary,
    );
  }
  const chat = Chat.empty();
  chat.append("system", parts.join("\n").trim());
  const tail = messages.slice(options.splitIndex ?? systemCount);
  if (
    tail.length > 0 &&
    !tail.some((message) => message.getRole() === "user")
  ) {
    chat.append(
      "user",
      "[Earlier messages were compacted into the system state above.] Continue from that state.",
    );
  }
  for (const message of tail) chat.append(message);
  return chat;
}
