import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { StoredArtifact } from "./types.js";

export type StorageConfig = {
  type: string;
  uri?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix: string;
};

export async function writeArtifact(
  config: StorageConfig,
  key: string,
  body: string
): Promise<StoredArtifact> {
  if (config.type === "local") {
    const basePath = join(process.cwd(), "out", config.prefix);
    await mkdir(basePath, { recursive: true });
    const filePath = join(basePath, key);
    await writeFile(filePath, body, "utf8");
    return {
      key,
      uri: filePath,
      size: Buffer.byteLength(body, "utf8")
    };
  }

  throw new Error(`Storage type not implemented: ${config.type}`);
}

export async function artifactExists(config: StorageConfig, key: string) {
  if (config.type === "local") {
    const basePath = join(process.cwd(), "out", config.prefix);
    const filePath = join(basePath, key);
    try {
      await access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
