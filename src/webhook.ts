import { createHmac } from "node:crypto";
import type { WebhookPayload } from "./types.js";
import { logger } from "./logger.js";

export type WebhookConfig = {
  url?: string;
  secret?: string;
  token?: string;
  channel?: string;
};

export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
  content?: string
): Promise<void> {
  const { url, secret, token, channel } = config;

  // 1. Slack Files API (Preferred if token/channel present)
  if (token && channel && content) {
    const filename = `${payload.jobId || "report"}-${payload.window.end}.${payload.format === "json" ? "json" : "md"}`;
    const initialComment = `*${payload.jobName || payload.jobId}* for ${payload.window.start} to ${payload.window.end}\nView online: ${payload.artifact.uri}`;
    
    await sendSlackFile(token, channel, content, filename, initialComment);
    return;
  }

  // 2. Standard Webhook
  if (!url) return;

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (secret) {
    headers["x-signature"] = signPayload(secret, body);
  }

  const response = await fetch(url, {
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

/**
 * Sends a file to Slack using the files.upload (v1) API.
 * While v1 is deprecated in favor of v2, it remains the simplest way to 
 * upload a text snippet via a single fetch call without complex multipart logic.
 */
async function sendSlackFile(
  token: string,
  channel: string,
  content: string,
  filename: string,
  initialComment: string
) {
  const formData = new URLSearchParams();
  formData.append("channels", channel);
  formData.append("content", content);
  formData.append("filename", filename);
  formData.append("initial_comment", initialComment);
  formData.append("filetype", filename.endsWith(".json") ? "json" : "markdown");

  const response = await fetch("https://slack.com/api/files.upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData
  });

  const result = await response.json() as any;
  if (!result.ok) {
    logger.warn("slack.file.upload.failed", { error: result.error });
    throw new Error(`Slack upload failed: ${result.error}`);
  }
}

function signPayload(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
