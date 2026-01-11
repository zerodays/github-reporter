import { createHmac } from "node:crypto";
import type { WebhookPayload } from "./types.js";
import { logger } from "./logger.js";

export type WebhookConfig = {
  url?: string;
  secret?: string;
};

export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload
): Promise<void> {
  if (!config.url) return;

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (config.secret) {
    headers["x-signature"] = signPayload(config.secret, body);
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn("webhook.send.failed", {
      status: response.status,
      body: text
    });
    throw new Error(`Webhook failed: ${response.status} ${text}`);
  }
}

function signPayload(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
