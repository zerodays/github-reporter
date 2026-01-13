import type { JobConfig } from "./jobs.js";
import type { StorageClient } from "./storage.js";
import type { IndexItem } from "./manifest.js";
import { resolveSlotKey } from "./slots.js";

export type ScheduleDecision = {
  due: boolean;
  slotKey: string;
  lastSlotKey?: string;
  nextSlotKey: string;
};

export async function getScheduleDecision(args: {
  job: JobConfig;
  now: Date;
  timeZone?: string;
  storage: StorageClient;
  owner: string;
  ownerType: "user" | "org";
  prefix: string;
}) {
  if (!args.job.schedule) {
    return {
      due: true,
      slotKey: "unscheduled",
      nextSlotKey: "unscheduled"
    };
  }

  const slotKey = resolveSlotKey({
    now: args.now,
    schedule: args.job.schedule,
    timeZone: args.timeZone ?? "UTC"
  });
  const last = await loadLatestItem(
    args.storage,
    args.prefix,
    args.ownerType,
    args.owner,
    args.job.id
  );
  const lastSlotKey = last?.slotKey;
  const due = !lastSlotKey || lastSlotKey < slotKey;

  return { due, slotKey, lastSlotKey, nextSlotKey: slotKey };
}

async function loadLatestItem(
  storage: StorageClient,
  prefix: string,
  ownerType: "user" | "org",
  owner: string,
  jobId: string
) {
  const key = `${prefix}/_index/${ownerType}/${owner}/${jobId}/latest.json`;
  const text = await storage.get(key);
  if (!text) return null;
  const parsed = JSON.parse(text) as { latest?: IndexItem };
  return parsed.latest ?? null;
}
