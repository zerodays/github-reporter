import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, dirname } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

export type StorageConfig = {
  type: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type StoredArtifact = {
  key: string;
  uri: string;
  size: number;
};

export type StorageClient = {
  put: (key: string, body: string, contentType?: string) => Promise<StoredArtifact>;
  get: (key: string) => Promise<string | null>;
  exists: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<string[]>;
};

export function describeStorage(config: StorageConfig) {
  return {
    type: config.type,
    bucket: config.bucket ?? null,
    region: config.region ?? null,
    endpoint: config.endpoint ?? null,
    forcePathStyle: config.forcePathStyle ?? false
  };
}

export function createStorageClient(config: StorageConfig): StorageClient {
  if (config.type === "local") {
    return createLocalClient();
  }
  if (config.type === "s3") {
    return createS3Client(config);
  }
  throw new Error(`Storage type not implemented: ${config.type}`);
}

export async function validateStorage(config: StorageConfig) {
  if (config.type === "local") {
    const basePath = join(process.cwd(), "out");
    await mkdir(basePath, { recursive: true });
    return;
  }
  if (config.type === "s3") {
    if (!config.bucket) {
      throw new Error("Storage validation failed: missing bucket name.");
    }
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.accessKeyId
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey ?? ""
          }
        : undefined
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const hint =
        status === 403
          ? "Check access keys, token scope, and bucket permissions."
          : status === 404
          ? "Bucket not found; check bucket name and endpoint."
          : "Check endpoint and credentials.";
      throw new Error(`Storage validation failed (${status ?? "unknown"}): ${hint}`);
    }
    return;
  }
  throw new Error(`Storage validation failed: unsupported type ${config.type}`);
}

function createLocalClient(): StorageClient {
  const basePath = join(process.cwd(), "out");
  return {
    async put(key, body) {
      const filePath = join(basePath, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, body, "utf8");
      return {
        key,
        uri: filePath,
        size: Buffer.byteLength(body, "utf8")
      };
    },
    async get(key) {
      const filePath = join(basePath, key);
      try {
        return await readFile(filePath, "utf8");
      } catch {
        return null;
      }
    },
    async exists(key) {
      const filePath = join(basePath, key);
      try {
        await access(filePath, fsConstants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async list(prefix) {
      const dirPath = join(basePath, prefix);
      try {
        const entries = await readDirRecursive(dirPath);
        return entries.map((entry) => join(prefix, entry));
      } catch {
        return [];
      }
    }
  };
}

function createS3Client(config: StorageConfig): StorageClient {
  if (!config.bucket) {
    throw new Error("Missing storage.bucket for S3.");
  }
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.accessKeyId
      ? {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey ?? ""
        }
      : undefined
  });

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType ?? "text/plain; charset=utf-8"
        })
      );
      return {
        key,
        uri: `s3://${config.bucket}/${key}`,
        size: Buffer.byteLength(body, "utf8")
      };
    },
    async get(key) {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key })
        );
        const body = await streamToString(response.Body as Readable | undefined);
        return body;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (status === 404) return null;
        return null;
      }
    },
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key })
        );
        return true;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (status === 404) return false;
        return false;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken
          })
        );
        const contents = response.Contents ?? [];
        for (const item of contents) {
          if (item.Key) keys.push(item.Key);
        }
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
      return keys;
    }
  };
}

async function streamToString(stream?: Readable) {
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readDirRecursive(dirPath: string) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await readDirRecursive(fullPath);
      files.push(...sub.map((item) => join(entry.name, item)));
    } else {
      files.push(entry.name);
    }
  }
  return files;
}
