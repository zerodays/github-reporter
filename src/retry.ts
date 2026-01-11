import { setTimeout as delay } from "node:timers/promises";

export type RetryConfig = {
  retries: number;
  backoffMs: number;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= config.retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === config.retries) break;
      const wait = config.backoffMs * Math.pow(2, attempt);
      await delay(wait);
      attempt += 1;
    }
  }

  throw lastError;
}
