import type { JobConfig } from "./jobs.js";
import type { StorageClient } from "./storage.js";
import type { IndexItem } from "./manifest.js";

export type ScheduleDecision = {
  due: boolean;
  slotKey: string;
  lastSlotKey?: string;
  nextSlotKey: string;
};

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: number;
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

  const { slotKey, nextSlotKey } = resolveCurrentSlot(
    args.now,
    args.job,
    args.timeZone
  );
  const last = await loadLatestItem(
    args.storage,
    args.prefix,
    args.ownerType,
    args.owner,
    args.job.id
  );
  const lastSlotKey = last
    ? resolveSlotForDate(new Date(last.start), args.job, args.timeZone)
    : undefined;
  const due = !lastSlotKey || lastSlotKey < slotKey;

  return { due, slotKey, lastSlotKey, nextSlotKey };
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

function resolveCurrentSlot(
  now: Date,
  job: JobConfig,
  timeZone?: string
) {
  const schedule = job.schedule;
  if (!schedule) {
    return { slotKey: "unscheduled", nextSlotKey: "unscheduled" };
  }
  const parts = getZonedParts(now, timeZone);
  const minute = schedule.minute ?? 0;
  const hour = schedule.hour ?? 0;

  if (schedule.type === "hourly") {
    const slotParts = { ...parts };
    if (Number(parts.minute) < minute) {
      const shifted = shiftDate(parts, -1);
      slotParts.year = shifted.year;
      slotParts.month = shifted.month;
      slotParts.day = shifted.day;
      slotParts.hour = shifted.hour;
    }
    slotParts.minute = pad(minute);
    slotParts.hour = pad(Number(slotParts.hour));
    const slotKey = formatSlotKey(slotParts);
    const nextSlot = addHours(slotParts, 1);
    const nextSlotKey = formatSlotKey(nextSlot);
    return { slotKey, nextSlotKey };
  }

  if (schedule.type === "daily") {
    const slotParts = { ...parts, hour: pad(hour), minute: pad(minute) };
    const nowHour = Number(parts.hour);
    const nowMinute = Number(parts.minute);
    if (nowHour < hour || (nowHour === hour && nowMinute < minute)) {
      const shifted = shiftDate(parts, -1);
      slotParts.year = shifted.year;
      slotParts.month = shifted.month;
      slotParts.day = shifted.day;
    }
    const slotKey = formatSlotKey(slotParts);
    const nextSlot = addDays(slotParts, 1);
    const nextSlotKey = formatSlotKey(nextSlot);
    return { slotKey, nextSlotKey };
  }

  const weekday = schedule.weekday ?? 0;
  const slotParts = { ...parts, hour: pad(hour), minute: pad(minute) };
  let delta = parts.weekday - weekday;
  if (delta < 0) delta += 7;
  const nowHour = Number(parts.hour);
  const nowMinute = Number(parts.minute);
  if (delta === 0 && (nowHour < hour || (nowHour === hour && nowMinute < minute))) {
    delta = 7;
  }
  const shifted = shiftDate(parts, -delta);
  slotParts.year = shifted.year;
  slotParts.month = shifted.month;
  slotParts.day = shifted.day;
  const slotKey = formatSlotKey(slotParts);
  const nextSlot = addDays(slotParts, 7);
  const nextSlotKey = formatSlotKey(nextSlot);
  return { slotKey, nextSlotKey };
}

function resolveSlotForDate(date: Date, job: JobConfig, timeZone?: string) {
  const schedule = job.schedule;
  if (!schedule) return "unscheduled";
  const parts = getZonedParts(date, timeZone);
  const minute = schedule.minute ?? 0;
  const hour = schedule.hour ?? 0;
  const slotParts = { ...parts, hour: pad(hour), minute: pad(minute) };
  return formatSlotKey(slotParts);
}

function getZonedParts(date: Date, timeZone?: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    weekday: string;
  };
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    weekday: weekdayToNumber(map.weekday)
  };
}

function weekdayToNumber(value: string) {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return Math.max(0, days.indexOf(value.toLowerCase()));
}

function formatSlotKey(parts: ZonedParts) {
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}`;
}

function shiftDate(parts: ZonedParts, deltaDays: number) {
  const base = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  ));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const shifted = getZonedParts(base, "UTC");
  return {
    ...parts,
    year: shifted.year,
    month: shifted.month,
    day: shifted.day,
    hour: parts.hour,
    minute: parts.minute,
    weekday: shifted.weekday
  };
}

function addHours(parts: ZonedParts, hours: number) {
  const base = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  ));
  base.setUTCHours(base.getUTCHours() + hours);
  const next = getZonedParts(base, "UTC");
  return {
    ...parts,
    year: next.year,
    month: next.month,
    day: next.day,
    hour: next.hour,
    minute: next.minute,
    weekday: next.weekday
  };
}

function addDays(parts: ZonedParts, days: number) {
  return shiftDate(parts, days);
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}
