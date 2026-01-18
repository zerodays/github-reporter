import { writeLatest, type IndexItem, type JobRegistryItem } from "./manifest.js";
import { buildJobsRegistryKey } from "./utils.js";
import type { StorageClient } from "./storage.js";

export type JobsRegistry = {
  owner: string;
  ownerType: "user" | "org";
  updatedAt: string;
  jobs: JobRegistryItem[];
};

export type IndexFile = {
  owner: string;
  ownerType: "user" | "org";
  jobId: string;
  period: string;
  items: IndexItem[];
};

const periodKeyPattern = /\/(\d{4}-\d{2})\.json$/;

export async function loadJobsRegistry(args: {
  storage: StorageClient;
  prefix: string;
  owner: string;
  ownerType: "user" | "org";
}) {
  const key = buildJobsRegistryKey(args.prefix, args.ownerType, args.owner);
  const text = await args.storage.get(key);
  if (!text) return null;
  return JSON.parse(text) as JobsRegistry;
}

export async function loadIndexFile(storage: StorageClient, key: string) {
  const text = await storage.get(key);
  if (!text) return null;
  return JSON.parse(text) as IndexFile;
}

export async function writeIndexFile(storage: StorageClient, key: string, file: IndexFile) {
  const body = JSON.stringify(file, null, 2);
  return storage.put(key, body, "application/json");
}

export async function listIndexPeriods(storage: StorageClient, indexBase: string) {
  const keys = await storage.list(indexBase);
  const periods = new Set<string>();
  for (const key of keys) {
    const match = key.match(periodKeyPattern);
    if (match) periods.add(match[1]);
  }
  return Array.from(periods).sort();
}

export async function loadLatest(storage: StorageClient, indexBase: string) {
  const text = await storage.get(`${indexBase}/latest.json`);
  if (!text) return null;
  const parsed = JSON.parse(text) as { latest?: IndexItem };
  return parsed.latest ?? null;
}

export async function removeIndexItemBySlot(args: {
  storage: StorageClient;
  indexKey: string;
  slotKey: string;
}) {
  const file = await loadIndexFile(args.storage, args.indexKey);
  if (!file) {
    return { removed: null, remaining: 0 };
  }
  const removed = file.items.find((item) => item.slotKey === args.slotKey) ?? null;
  if (!removed) {
    return { removed: null, remaining: file.items.length };
  }
  const nextItems = file.items.filter((item) => item.slotKey !== args.slotKey);
  if (nextItems.length === 0) {
    await args.storage.delete(args.indexKey);
  } else {
    const nextFile: IndexFile = { ...file, items: nextItems };
    await writeIndexFile(args.storage, args.indexKey, nextFile);
  }
  return { removed, remaining: nextItems.length };
}

export async function recomputeLatest(args: {
  storage: StorageClient;
  indexBase: string;
}) {
  const periods = await listIndexPeriods(args.storage, args.indexBase);
  const items: IndexItem[] = [];
  for (const period of periods) {
    const file = await loadIndexFile(args.storage, `${args.indexBase}/${period}.json`);
    if (!file) continue;
    items.push(...(file.items ?? []));
  }

  if (items.length === 0) {
    await args.storage.delete(`${args.indexBase}/latest.json`);
    return null;
  }

  const latest = items.reduce((current, item) => {
    if (!current) return item;
    return item.slotKey > current.slotKey ? item : current;
  }, items[0]);

  await writeLatest(
    args.storage,
    `${args.indexBase}/latest.json`,
    latest.owner,
    latest.ownerType,
    latest,
    latest.jobId
  );

  return latest;
}
