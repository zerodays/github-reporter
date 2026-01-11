import type { RepoActivity } from "./types.js";
import type { StoredArtifact, StorageClient } from "./storage.js";

export type ManifestTemplate = {
  id: string;
  format: string;
  key: string;
  uri: string;
  size: number;
};

export type ReportManifest = {
  owner: string;
  ownerType: "user" | "org";
  window: {
    start: string;
    end: string;
    days: number;
  };
  timezone?: string;
  templates: ManifestTemplate[];
  repos: { name: string; commits: number; prs: number; issues: number }[];
  stats: { repos: number; commits: number; prs: number; issues: number };
};

export type IndexItem = {
  start: string;
  end: string;
  days: number;
  manifestKey: string;
};

export async function writeManifest(
  storage: StorageClient,
  key: string,
  manifest: ReportManifest
) {
  const body = JSON.stringify(manifest, null, 2);
  return storage.put(key, body, "application/json");
}

export async function updateIndex(
  storage: StorageClient,
  key: string,
  owner: string,
  ownerType: "user" | "org",
  period: string,
  item: IndexItem
) {
  const existing = await storage.get(key);
  const parsed = existing
    ? JSON.parse(existing)
    : { owner, ownerType, period, items: [] };
  const items: IndexItem[] = parsed.items ?? [];
  const already = items.find((entry) => entry.manifestKey === item.manifestKey);
  if (!already) {
    items.push(item);
    items.sort((a, b) => a.start.localeCompare(b.start));
  }
  const body = JSON.stringify({ owner, ownerType, period, items }, null, 2);
  return storage.put(key, body, "application/json");
}

export async function writeLatest(
  storage: StorageClient,
  key: string,
  owner: string,
  ownerType: "user" | "org",
  item: IndexItem
) {
  const body = JSON.stringify({ owner, ownerType, latest: item }, null, 2);
  return storage.put(key, body, "application/json");
}

export function buildManifest(
  owner: string,
  ownerType: "user" | "org",
  window: { start: string; end: string; days: number },
  timezone: string | undefined,
  repos: RepoActivity[],
  artifacts: { id: string; format: string; stored: StoredArtifact }[]
): ReportManifest {
  const reposSummary = repos.map((repo) => ({
    name: repo.repo.name,
    commits: repo.commits.length,
    prs: repo.context?.pullRequests?.length ?? 0,
    issues: repo.context?.issues?.length ?? 0
  }));

  const stats = reposSummary.reduce(
    (acc, repo) => ({
      repos: acc.repos + 1,
      commits: acc.commits + repo.commits,
      prs: acc.prs + repo.prs,
      issues: acc.issues + repo.issues
    }),
    { repos: 0, commits: 0, prs: 0, issues: 0 }
  );

  const templates: ManifestTemplate[] = artifacts.map((artifact) => ({
    id: artifact.id,
    format: artifact.format,
    key: artifact.stored.key,
    uri: artifact.stored.uri,
    size: artifact.stored.size
  }));

  return {
    owner,
    ownerType,
    window,
    timezone,
    templates,
    repos: reposSummary,
    stats
  };
}
