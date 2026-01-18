import type { StorageClient, StoredArtifact } from "./storage.js";

type PendingWrite = {
  body: string;
  contentType?: string;
};

export type BufferedStorage = {
  storage: StorageClient;
  commit: () => Promise<Record<string, StoredArtifact>>;
  discard: () => void;
  pendingKeys: () => string[];
};

export function createBufferedStorage(base: StorageClient): BufferedStorage {
  const writes = new Map<string, PendingWrite>();
  const deletes = new Set<string>();

  const storage: StorageClient = {
    async put(key, body, contentType) {
      writes.set(key, { body, contentType });
      deletes.delete(key);
      return {
        key,
        uri: `buffer://${key}`,
        size: Buffer.byteLength(body, "utf8")
      };
    },
    async get(key) {
      const pending = writes.get(key);
      if (pending) return pending.body;
      if (deletes.has(key)) return null;
      return base.get(key);
    },
    async exists(key) {
      if (writes.has(key)) return true;
      if (deletes.has(key)) return false;
      return base.exists(key);
    },
    async list(prefix) {
      const keys = new Set(await base.list(prefix));
      for (const key of writes.keys()) {
        if (key.startsWith(prefix)) keys.add(key);
      }
      for (const key of deletes) {
        if (key.startsWith(prefix)) keys.delete(key);
      }
      return Array.from(keys).sort();
    },
    async delete(key) {
      writes.delete(key);
      deletes.add(key);
    }
  };

  async function commit() {
    const results: Record<string, StoredArtifact> = {};
    for (const key of deletes) {
      await base.delete(key);
    }
    for (const [key, entry] of writes) {
      results[key] = await base.put(key, entry.body, entry.contentType);
    }
    writes.clear();
    deletes.clear();
    return results;
  }

  function discard() {
    writes.clear();
    deletes.clear();
  }

  function pendingKeys() {
    return Array.from(writes.keys());
  }

  return { storage, commit, discard, pendingKeys };
}
