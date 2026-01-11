import type { RepoActivity, RepoContext } from "../types.js";

export function ensureContext(repo: RepoActivity): RepoContext {
  if (!repo.context) {
    repo.context = {};
  }
  return repo.context;
}

export function truncateText(input: string, maxBytes: number) {
  const buffer = Buffer.from(input, "utf8");
  if (buffer.byteLength <= maxBytes) return input;
  return buffer.subarray(0, maxBytes).toString("utf8");
}
