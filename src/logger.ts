export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerConfig = {
  level: LogLevel;
  includeTimings: boolean;
  format: "json" | "pretty";
  color: boolean;
  timeZone?: string;
  baseContext?: Record<string, unknown>;
};

type LogEntry = {
  level: LogLevel;
  msg: string;
  ts: string;
  data?: Record<string, unknown>;
};

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let config: LoggerConfig = {
  level: "info",
  includeTimings: false,
  format: "json",
  color: false,
  timeZone: undefined,
  baseContext: {}
};

export function setLoggerConfig(next: Partial<LoggerConfig>) {
  config = { ...config, ...next };
}

export function getLoggerConfig(): LoggerConfig {
  return config;
}

export function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (levelWeight[level] < levelWeight[config.level]) {
    return;
  }
  const entry: LogEntry = {
    level,
    msg,
    ts: formatTimestamp(new Date(), config.timeZone),
    data: mergeContext(config.baseContext, data)
  };

  const line = formatLine(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  withContext: (context: Record<string, unknown>) => {
    return {
      debug: (msg: string, data?: Record<string, unknown>) =>
        log("debug", msg, mergeContext(context, data)),
      info: (msg: string, data?: Record<string, unknown>) =>
        log("info", msg, mergeContext(context, data)),
      warn: (msg: string, data?: Record<string, unknown>) =>
        log("warn", msg, mergeContext(context, data)),
      error: (msg: string, data?: Record<string, unknown>) =>
        log("error", msg, mergeContext(context, data))
    };
  }
};

export type ContextLogger = ReturnType<typeof logger.withContext>;

function mergeContext(
  base?: Record<string, unknown>,
  extra?: Record<string, unknown>
) {
  if (!base && !extra) return undefined;
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, ...extra };
}

function formatLine(entry: LogEntry) {
  if (config.format === "pretty") {
    return formatPretty(entry);
  }
  return JSON.stringify(entry);
}

function formatPretty(entry: LogEntry) {
  const level = config.color ? colorLevel(entry.level) : entry.level;
  const msg = config.color ? colorMsg(entry.msg) : entry.msg;
  const header = `[${entry.ts}] ${level} ${msg}`;
  if (!entry.data || Object.keys(entry.data).length === 0) {
    return header;
  }
  const dataJson = JSON.stringify(entry.data, null, 2);
  return `${header}\n${dataJson}`;
}

const colors = {
  reset: "\u001b[0m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m"
};

function colorLevel(level: LogLevel) {
  switch (level) {
    case "debug":
      return `${colors.magenta}${level}${colors.reset}`;
    case "info":
      return `${colors.green}${level}${colors.reset}`;
    case "warn":
      return `${colors.yellow}${level}${colors.reset}`;
    case "error":
      return `${colors.red}${level}${colors.reset}`;
    default:
      return level;
  }
}

function colorMsg(msg: string) {
  return `${colors.blue}${msg}${colors.reset}`;
}

export function formatTimestamp(date: Date, timeZone?: string) {
  if (!timeZone) {
    return date.toISOString();
  }
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${ms} ${timeZone}`;
}
