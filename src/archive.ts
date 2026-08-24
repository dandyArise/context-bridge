import type { ChatMessage } from "@lmstudio/sdk";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { renderTranscript } from "./compaction";

export interface CompactionRecord {
  splitIndex: number;
  prefixHash: string;
  summary: string;
  compactedAt: string;
}

type StateFile = Record<string, CompactionRecord>;
const memoryState = new Map<string, CompactionRecord>();
const stateLocks = new Map<string, Promise<void>>();

function statePath(vaultPath: string): string {
  return path.join(vaultPath, ".context-bridge-state.json");
}

async function loadState(vaultPath: string): Promise<StateFile> {
  try {
    return JSON.parse(
      await fs.readFile(statePath(vaultPath), "utf8"),
    ) as StateFile;
  } catch {
    return {};
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function loadRecord(
  vaultPath: string,
  key: string,
): Promise<CompactionRecord | undefined> {
  return vaultPath === ""
    ? memoryState.get(key)
    : (await loadState(vaultPath))[key];
}

export async function saveRecord(
  vaultPath: string,
  key: string,
  record: CompactionRecord,
): Promise<void> {
  if (vaultPath === "") {
    memoryState.set(key, record);
    return;
  }
  const file = statePath(vaultPath);
  const previous = stateLocks.get(file) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      const state = await loadState(vaultPath);
      state[key] = record;
      await atomicWrite(file, JSON.stringify(state, null, 2));
    })
    .finally(() => {
      if (stateLocks.get(file) === next) stateLocks.delete(file);
    });
  stateLocks.set(file, next);
  await next;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function archive(
  vaultPath: string,
  folder: string,
  summary: string,
  messages: ChatMessage[],
): Promise<string> {
  const now = new Date();
  const directory = path.join(vaultPath, folder);
  await fs.mkdir(directory, { recursive: true });
  const transcript = path.join(directory, `transcript-${stamp(now)}.md`);
  const state = path.join(directory, "state.md");
  await atomicWrite(
    transcript,
    `# Compacted transcript\n\nCreated: ${now.toISOString()}\n\n${renderTranscript(messages)}\n`,
  );
  await atomicWrite(
    state,
    `# Consolidated state\n\nUpdated: ${now.toISOString()}\n\n${summary}\n`,
  );
  return state;
}
