import { Chat, type ChatMessage } from "@lmstudio/sdk";
import { createHash } from "node:crypto";
import type { SummaryCache } from "./cache";
import { stripInternalSeparators } from "./internalSeparator";
import { isLocalLLM, type TokenSource } from "./tokenBudget";

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
      const text = stripInternalSeparators(message.getText()).trim();
      if (text !== "") parts.push(text);
      for (const call of message.getToolCallRequests()) {
        parts.push(
          `[calls tool: ${call.name}(${JSON.stringify(call.arguments ?? {})})]`,
        );
      }
      for (const result of message.getToolCallResults()) {
        parts.push(
          `[tool result: ${stripInternalSeparators(String(result.content))}]`,
        );
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
  maxTokens: number,
): Promise<string> {
  const result = await source.respond(
    Chat.from([{ role: "user", content: prompt }]),
    { signal, maxTokens },
  );
  return stripInternalSeparators(result.content).trim();
}

function splitAtReadableBoundary(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const minimum = Math.max(1, Math.floor(limit / 2));
  for (let index = limit; index >= minimum; index--) {
    if (/\s/u.test(text[index - 1] ?? "")) return index;
  }
  return limit;
}

function splitOversizedTranscript(
  transcript: string,
  estimatedTokens: number,
  budget: number,
): string[] {
  if (estimatedTokens <= budget) return [transcript];
  const charsPerChunk = Math.max(
    1,
    Math.floor((transcript.length * budget * 0.8) / estimatedTokens),
  );
  const parts: string[] = [];
  let remaining = transcript;
  while (remaining.length > charsPerChunk) {
    const cut = splitAtReadableBoundary(remaining, charsPerChunk);
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.trim() !== "") parts.push(remaining.trim());
  return parts;
}

async function chunkTranscripts(
  messages: ChatMessage[],
  budget: number,
  countTokens: (message: ChatMessage) => Promise<number>,
): Promise<string[]> {
  const chunks: string[] = [];
  let current: string[] = [];
  let used = 0;
  for (const message of messages) {
    const rendered = renderTranscript([message]);
    const size = Math.max(1, await countTokens(message));
    const parts = splitOversizedTranscript(rendered, size, budget);
    for (const part of parts) {
      const partSize = Math.max(
        1,
        Math.min(
          budget,
          Math.ceil((size * part.length) / Math.max(1, rendered.length)),
        ),
      );
      if (current.length > 0 && used + partSize > budget) {
        chunks.push(current.join("\n\n"));
        current = [];
        used = 0;
      }
      current.push(part);
      used += partSize;
    }
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

function summaryBudgets(
  rawContextTokens: number,
  configuredChunkTokens: number,
) {
  if (!Number.isFinite(rawContextTokens) || rawContextTokens < 1024) {
    throw new Error(
      `The summarizer context (${rawContextTokens}) is too small; at least 1024 tokens are required.`,
    );
  }
  const maxOutputTokens = Math.max(
    128,
    Math.min(768, Math.floor(rawContextTokens / 8)),
  );
  return {
    chunkTokens: Math.max(
      128,
      Math.min(configuredChunkTokens, Math.floor(rawContextTokens * 0.4)),
    ),
    maxOutputTokens,
    maxPromptTokens:
      rawContextTokens -
      maxOutputTokens -
      Math.max(64, Math.floor(rawContextTokens * 0.05)),
  };
}

async function countPromptTokens(
  source: TokenSource,
  prompt: string,
  countTokens: (message: ChatMessage) => Promise<number>,
): Promise<number> {
  const chat = Chat.from([{ role: "user", content: prompt }]);
  if (isLocalLLM(source)) {
    return source.countTokens(await source.applyPromptTemplate(chat));
  }
  return Math.max(1, await countTokens(chat.at(0)));
}

async function fitTranscriptToPrompt(
  transcript: string,
  buildPrompt: (text: string) => string,
  maxPromptTokens: number,
  countPrompt: (prompt: string) => Promise<number>,
): Promise<string[]> {
  if ((await countPrompt(buildPrompt(transcript))) <= maxPromptTokens) {
    return [transcript];
  }
  if (transcript.length < 2) {
    throw new Error(
      "The summarization instructions do not fit in the active model context.",
    );
  }
  const cut = splitAtReadableBoundary(
    transcript,
    Math.floor(transcript.length / 2),
  );
  const left = transcript.slice(0, cut).trim();
  const right = transcript.slice(cut).trim();
  if (left === "" || right === "") {
    throw new Error(
      "The summarization prompt could not be split to fit the active model context.",
    );
  }
  return [
    ...(await fitTranscriptToPrompt(
      left,
      buildPrompt,
      maxPromptTokens,
      countPrompt,
    )),
    ...(await fitTranscriptToPrompt(
      right,
      buildPrompt,
      maxPromptTokens,
      countPrompt,
    )),
  ];
}

async function fitSummaryTranscripts(
  source: TokenSource,
  transcripts: string[],
  maxPromptTokens: number,
  countTokens: (message: ChatMessage) => Promise<number>,
): Promise<string[]> {
  const fitted: string[] = [];
  const countPrompt = (prompt: string) =>
    countPromptTokens(source, prompt, countTokens);
  for (const transcript of transcripts) {
    fitted.push(
      ...(await fitTranscriptToPrompt(
        transcript,
        summaryPrompt,
        maxPromptTokens,
        countPrompt,
      )),
    );
  }
  return fitted;
}

async function groupMergeParts(
  parts: string[],
  maxPromptTokens: number,
  countPrompt: (prompt: string) => Promise<number>,
): Promise<string[][]> {
  const groups: string[][] = [];
  let group: string[] = [];
  for (const part of parts) {
    const candidate = [...group, part];
    if (
      group.length > 0 &&
      (await countPrompt(mergePrompt(candidate))) > maxPromptTokens
    ) {
      groups.push(group);
      group = [part];
    } else {
      group = candidate;
    }
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

async function mergeSummaries(
  source: TokenSource,
  partials: string[],
  options: {
    signal: AbortSignal;
    maxPromptTokens: number;
    maxOutputTokens: number;
    countTokens: (message: ChatMessage) => Promise<number>;
    onProgress?: (text: string) => void;
  },
): Promise<string> {
  let current = partials;
  let round = 1;
  const countPrompt = (prompt: string) =>
    countPromptTokens(source, prompt, options.countTokens);
  while (current.length > 1) {
    const groups = await groupMergeParts(
      current,
      options.maxPromptTokens,
      countPrompt,
    );

    // The output cap is chosen so two generated summaries fit in one merge.
    // Pair explicitly if unusual tokenizer estimates would otherwise stall.
    if (groups.length === current.length) {
      groups.length = 0;
      for (let index = 0; index < current.length; index += 2) {
        const pair = current.slice(index, index + 2);
        if (
          pair.length > 1 &&
          (await countPrompt(mergePrompt(pair))) > options.maxPromptTokens
        ) {
          throw new Error(
            "Generated partial summaries do not fit in the active model context for merging.",
          );
        }
        groups.push(pair);
      }
    }

    const next: string[] = [];
    for (let index = 0; index < groups.length; index++) {
      const parts = groups[index] ?? [];
      if (parts.length === 1) {
        next.push(parts[0] ?? "");
        continue;
      }
      options.onProgress?.(
        `Compacting context… (merge ${round}, part ${index + 1}/${groups.length})`,
      );
      next.push(
        await respond(
          source,
          mergePrompt(parts),
          options.signal,
          options.maxOutputTokens,
        ),
      );
    }
    current = next;
    round++;
  }
  return current[0] ?? "";
}

export async function summarize(
  source: TokenSource,
  messages: ChatMessage[],
  options: {
    signal: AbortSignal;
    cache: SummaryCache;
    chunkTokens: number;
    rawContextTokens: number;
    countTokens: (message: ChatMessage) => Promise<number>;
    onProgress?: (text: string) => void;
  },
): Promise<{ summary: string; chunksTotal: number; chunksSummarized: number }> {
  const budgets = summaryBudgets(options.rawContextTokens, options.chunkTokens);
  const initialChunks = await chunkTranscripts(
    messages,
    budgets.chunkTokens,
    options.countTokens,
  );
  const chunks = await fitSummaryTranscripts(
    source,
    initialChunks,
    budgets.maxPromptTokens,
    options.countTokens,
  );
  const partials: string[] = [];
  let generated = 0;
  for (let index = 0; index < chunks.length; index++) {
    const transcript = chunks[index] ?? "";
    const key = hashOf(transcript);
    const cached = await options.cache.get(key);
    if (cached !== undefined) {
      const sanitized = stripInternalSeparators(cached);
      if (sanitized !== cached) await options.cache.set(key, sanitized);
      partials.push(sanitized);
      continue;
    }
    options.onProgress?.(
      `Compacting context… (part ${index + 1}/${chunks.length})`,
    );
    const partial = await respond(
      source,
      summaryPrompt(transcript),
      options.signal,
      budgets.maxOutputTokens,
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
      : await mergeSummaries(source, partials, {
          signal: options.signal,
          maxPromptTokens: budgets.maxPromptTokens,
          maxOutputTokens: budgets.maxOutputTokens,
          countTokens: options.countTokens,
          ...(options.onProgress === undefined
            ? {}
            : { onProgress: options.onProgress }),
        });
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
      stripInternalSeparators(options.summary),
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
