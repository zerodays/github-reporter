import type { RateLimitInfo } from "./types.js";

export function updateRateLimit(
  target: RateLimitInfo,
  headers: Record<string, string | number | undefined>
) {
  const remaining = parseHeaderNumber(headers["x-ratelimit-remaining"]);
  const limit = parseHeaderNumber(headers["x-ratelimit-limit"]);
  const reset = parseHeaderNumber(headers["x-ratelimit-reset"]);

  if (remaining !== undefined) {
    target.remaining =
      target.remaining === undefined
        ? remaining
        : Math.min(target.remaining, remaining);
  }
  if (limit !== undefined) {
    target.limit = target.limit ?? limit;
  }
  if (reset !== undefined) {
    target.reset = reset;
  }
}

function parseHeaderNumber(value: string | number | undefined) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
