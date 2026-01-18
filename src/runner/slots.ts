import { buildSlotWindow, resolveSlotEndParts, type SlotSchedule } from "../slots.js";
import type { SlotWindow } from "./types.js";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const zoneSuffixPattern = /([Zz]|[+-]\d{2}:?\d{2})$/;

export function resolveSlotForAt(args: {
  at: string;
  schedule: SlotSchedule;
  timeZone: string;
}): SlotWindow {
  const now = resolveAtForSchedule(args.at, args.schedule, args.timeZone);
  const slotEnd = resolveSlotEndParts(now, args.schedule, args.timeZone);
  return buildSlotWindow(slotEnd, args.schedule, args.timeZone);
}

export function parseAtToDate(value: string, timeZone: string): Date {
  const trimmed = value.trim();
  const hasZone = zoneSuffixPattern.test(trimmed);
  if (hasZone) {
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error(`Invalid --at value: ${value}`);
    }
    return parsed;
  }

  if (isDateOnly(trimmed)) {
    const parts = parseDateParts(trimmed);
    return zonedDateTimeToUtc(
      { ...parts, hour: 0, minute: 0, second: 0 },
      timeZone
    );
  }

  if (dateTimePattern.test(trimmed)) {
    const [datePart, timePart] = trimmed.split(/[T ]/);
    const date = parseDateParts(datePart);
    const time = parseTimeParts(timePart);
    return zonedDateTimeToUtc(
      { ...date, ...time },
      timeZone
    );
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid --at value: ${value}`);
  }
  return parsed;
}

function resolveAtForSchedule(
  value: string,
  schedule: SlotSchedule,
  timeZone: string
) {
  const trimmed = value.trim();
  if (schedule.type === "daily" && isDateOnly(trimmed)) {
    const date = parseDateParts(trimmed);
    const next = shiftLocalDate(date, 1);
    const hour = schedule.hour ?? 0;
    const minute = schedule.minute ?? 0;
    return zonedDateTimeToUtc(
      { ...next, hour, minute, second: 0 },
      timeZone
    );
  }
  return parseAtToDate(trimmed, timeZone);
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return { year, month, day };
}

function parseTimeParts(value: string) {
  const [hour, minute, second] = value.split(":").map((part) => Number(part));
  return { hour, minute, second: second ?? 0 };
}

function isDateOnly(value: string) {
  return dateOnlyPattern.test(value);
}

function shiftLocalDate(
  parts: { year: number; month: number; day: number },
  deltaDays: number
) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string
) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const offset = getOffsetMinutes(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset * 60 * 1000);
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
  };
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - date.getTime()) / 60000;
}
