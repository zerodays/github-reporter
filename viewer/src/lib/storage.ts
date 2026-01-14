import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { env } from "./env";

const config = {
  bucket: env.R2_BUCKET,
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  forcePathStyle: env.R2_FORCE_PATH_STYLE === "true",
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY
};

let client: S3Client | null = null;

export function getStorageClient() {
  if (!client) {
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }
  return client;
}

export async function getObjectText(key: string) {
  if (!config.bucket) {
    throw new Error("Missing R2_BUCKET environment variable.");
  }
  try {
    const response = await getStorageClient().send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key })
    );
    return streamToString(response.Body as Readable | undefined);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

async function streamToString(stream?: Readable) {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
