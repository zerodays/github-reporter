export type SlotType = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export type SlotSchedule = {
  type: SlotType;
  minute?: number;
  hour?: number;
  weekday?: number;
  dayOfMonth?: number;
  month?: number;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

type SlotWindow = {
  slotKey: string;
  slotType: SlotType;
  scheduledAt: string;
  window: { start: string; end: string };
};


export function listSlots(args: {
  now: Date;
  schedule: SlotSchedule;
  timeZone: string;
  backfillSlots: number;
}): SlotWindow[] {
  const totalSlots = Math.max(1, args.backfillSlots || 0);
  const slots: SlotWindow[] = [];
  let cursor = resolveSlotEndParts(args.now, args.schedule, args.timeZone);
  for (let i = 0; i < totalSlots; i += 1) {
    const slot = buildSlotWindow(cursor, args.schedule, args.timeZone);
    slots.push(slot);
    cursor = shiftSlotEnd(cursor, args.schedule, -1);
  }
  return slots;
}

export function resolveSlotKey(args: {
  now: Date;
  schedule: SlotSchedule;
  timeZone: string;
}): string {
  const parts = resolveSlotEndParts(args.now, args.schedule, args.timeZone);
  const scheduledAt = zonedTimeToUtc(parts, args.timeZone);
  return formatSlotKey(scheduledAt);
}

export function buildSlotWindow(
  slotEnd: ZonedParts,
  schedule: SlotSchedule,
  timeZone: string
): SlotWindow {
  const slotStart = shiftSlotEnd(slotEnd, schedule, -1);
  const endUtc = zonedTimeToUtc(slotEnd, timeZone);
  const startUtc = zonedTimeToUtc(slotStart, timeZone);
  return {
    slotKey: formatSlotKey(endUtc),
    slotType: schedule.type,
    scheduledAt: endUtc.toISOString(),
    window: {
      start: startUtc.toISOString(),
      end: endUtc.toISOString()
    }
  };
}

export function resolveSlotEndParts(
  now: Date,
  schedule: SlotSchedule,
  timeZone: string
): ZonedParts {
  const parts = getZonedParts(now, timeZone);
  const minute = schedule.minute ?? 0;
  const hour = schedule.hour ?? 0;

  if (schedule.type === "hourly") {
    const slotParts = { ...parts, minute };
    if (parts.minute < minute) {
      return shiftLocalHours(slotParts, -1);
    }
    return slotParts;
  }

  if (schedule.type === "daily") {
    const slotParts = { ...parts, hour, minute };
    if (
      parts.hour < hour ||
      (parts.hour === hour && parts.minute < minute)
    ) {
      return shiftLocalDays(slotParts, -1);
    }
    return slotParts;
  }

  if (schedule.type === "weekly") {
    const weekday = schedule.weekday ?? 0;
    const slotParts = { ...parts, hour, minute };
    let delta = parts.weekday - weekday;
    if (delta < 0) delta += 7;
    if (
      delta === 0 &&
      (parts.hour < hour || (parts.hour === hour && parts.minute < minute))
    ) {
      delta = 7;
    }
    return shiftLocalDays(slotParts, -delta);
  }

  if (schedule.type === "monthly") {
    const dayOfMonth = schedule.dayOfMonth ?? 1;
    const slotParts = { ...parts, day: dayOfMonth, hour, minute };
    if (
      parts.day < dayOfMonth ||
      (parts.day === dayOfMonth &&
        (parts.hour < hour || (parts.hour === hour && parts.minute < minute)))
    ) {
      return shiftLocalMonths(slotParts, -1);
    }
    return slotParts;
  }

  const month = schedule.month ?? 1;
  const dayOfMonth = schedule.dayOfMonth ?? 1;
  const slotParts = { ...parts, month, day: dayOfMonth, hour, minute };
  if (
    parts.month < month ||
    (parts.month === month &&
      (parts.day < dayOfMonth ||
        (parts.day === dayOfMonth &&
          (parts.hour < hour || (parts.hour === hour && parts.minute < minute)))))
  ) {
    return shiftLocalYears(slotParts, -1);
  }
  return slotParts;
}

export function formatSlotKey(dateUtc: Date) {
  const iso = dateUtc.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16).replace(":", "-");
  return `${date}T${time}Z`;
}

function shiftSlotEnd(
  parts: ZonedParts,
  schedule: SlotSchedule,
  delta: number
) {
  switch (schedule.type) {
    case "hourly":
      return shiftLocalHours(parts, delta);
    case "daily":
      return shiftLocalDays(parts, delta);
    case "weekly":
      return shiftLocalDays(parts, delta * 7);
    case "monthly":
      return shiftLocalMonths(parts, delta);
    case "yearly":
      return shiftLocalYears(parts, delta);
  }
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
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
    weekday: string;
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekdayToNumber(map.weekday)
  };
}

function zonedTimeToUtc(parts: ZonedParts, timeZone: string) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
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

function shiftLocalDays(parts: ZonedParts, deltaDays: number): ZonedParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function shiftLocalMonths(parts: ZonedParts, deltaMonths: number): ZonedParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCMonth(date.getUTCMonth() + deltaMonths);
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function shiftLocalYears(parts: ZonedParts, deltaYears: number): ZonedParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCFullYear(date.getUTCFullYear() + deltaYears);
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function shiftLocalHours(parts: ZonedParts, deltaHours: number): ZonedParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  date.setUTCHours(date.getUTCHours() + deltaHours);
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

function weekdayToNumber(value: string) {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return Math.max(0, days.indexOf(value.toLowerCase()));
}
