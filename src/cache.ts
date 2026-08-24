import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface SummaryCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

interface CacheEntry {
  summary: string;
  lastUsed: string;
}

type CacheFile = Record<string, CacheEntry>;

const MAX_CACHE_ENTRIES = 512;
const memoryEntries = new Map<string, CacheEntry>();
const writeChains = new Map<string, Promise<void>>();

function prune(entries: CacheFile): CacheFile {
  const ordered = Object.entries(entries).sort(([, a], [, b]) =>
    b.lastUsed.localeCompare(a.lastUsed),
  );
  return Object.fromEntries(ordered.slice(0, MAX_CACHE_ENTRIES));
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}

function serialize(
  file: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = writeChains.get(file) ?? Promise.resolve();
  const next = previous.then(operation, operation).finally(() => {
    if (writeChains.get(file) === next) writeChains.delete(file);
  });
  writeChains.set(file, next);
  return next;
}

export function createMemoryCache(): SummaryCache {
  return {
    get(key) {
      const entry = memoryEntries.get(key);
      if (entry !== undefined) entry.lastUsed = new Date().toISOString();
      return Promise.resolve(entry?.summary);
    },
    set(key, value) {
      memoryEntries.set(key, {
        summary: value,
        lastUsed: new Date().toISOString(),
      });
      if (memoryEntries.size > MAX_CACHE_ENTRIES) {
        const oldest = [...memoryEntries.entries()].sort(([, a], [, b]) =>
          a.lastUsed.localeCompare(b.lastUsed),
        )[0]?.[0];
        if (oldest !== undefined) memoryEntries.delete(oldest);
      }
      return Promise.resolve();
    },
  };
}

export function createFileCache(vaultPath: string): SummaryCache {
  const file = path.join(vaultPath, ".context-bridge-chunks.json");
  let loaded: CacheFile | undefined;
  const load = async (): Promise<CacheFile> => {
    if (loaded !== undefined) return loaded;
    try {
      loaded = JSON.parse(await fs.readFile(file, "utf8")) as CacheFile;
    } catch {
      loaded = {};
    }
    return loaded;
  };
  return {
    async get(key) {
      const entry = (await load())[key];
      if (entry !== undefined) entry.lastUsed = new Date().toISOString();
      return entry?.summary;
    },
    async set(key, value) {
      await serialize(file, async () => {
        const entries = await load();
        entries[key] = { summary: value, lastUsed: new Date().toISOString() };
        loaded = prune(entries);
        await atomicWrite(file, JSON.stringify(loaded, null, 2));
      });
    },
  };
}

const sharedMemoryCache = createMemoryCache();

export function createCache(vaultPath: string): SummaryCache {
  return vaultPath.trim() === ""
    ? sharedMemoryCache
    : createFileCache(vaultPath);
}
