import type { RepoActivity } from "./types.js";
import type { StoredArtifact, StorageClient } from "./storage.js";
import type { JobConfig } from "./jobs.js";

export type ManifestTemplate = {
  id: string;
  format: string;
  key: string;
  uri: string;
  size: number;
};

export type ReportManifest = {
  schemaVersion: number;
  job: {
    id: string;
    name: string;
    description?: string;
    mode: "pipeline" | "aggregate" | "stats";
    version?: string;
  };
  status?: "success" | "failed";
  error?: string;
  owner: string;
  ownerType: "user" | "org";
  window: {
    start: string;
    end: string;
    days: number;
    hours?: number;
  };
  timezone?: string;
  empty?: boolean;
  templates: ManifestTemplate[];
  repos: { name: string; commits: number; prs: number; issues: number }[];
  stats: { repos: number; commits: number; prs: number; issues: number };
};

export type IndexItem = {
  start: string;
  end: string;
  days: number;
  hours?: number;
  manifestKey: string;
};

export type JobRegistryItem = {
  id: string;
  name: string;
  description?: string;
  mode: "pipeline" | "aggregate" | "stats";
  windowDays: number;
  windowHours?: number;
  templates: string[];
  outputFormat?: "markdown" | "json";
  outputPrefix?: string;
  version?: string;
  updatedAt: string;
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
  item: IndexItem,
  job: JobConfig
) {
  const existing = await storage.get(key);
  const parsed = existing
    ? JSON.parse(existing)
    : { owner, ownerType, jobId: job.id, period, items: [] };
  const items: IndexItem[] = parsed.items ?? [];
  const already = items.find((entry) => entry.manifestKey === item.manifestKey);
  if (!already) {
    items.push(item);
    items.sort((a, b) => a.start.localeCompare(b.start));
  }
  const body = JSON.stringify(
    { owner, ownerType, jobId: job.id, period, items },
    null,
    2
  );
  return storage.put(key, body, "application/json");
}

export async function writeLatest(
  storage: StorageClient,
  key: string,
  owner: string,
  ownerType: "user" | "org",
  item: IndexItem,
  job: JobConfig
) {
  const body = JSON.stringify(
    { owner, ownerType, jobId: job.id, latest: item },
    null,
    2
  );
  return storage.put(key, body, "application/json");
}

export function buildManifest(
  owner: string,
  ownerType: "user" | "org",
  window: { start: string; end: string; days: number; hours?: number },
  timezone: string | undefined,
  repos: RepoActivity[],
  artifacts: { id: string; format: string; stored: StoredArtifact }[],
  empty: boolean,
  job: JobConfig
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
    schemaVersion: 1,
    job: {
      id: job.id,
      name: job.name,
      description: job.description,
      mode: job.mode,
      version: job.jobVersion
    },
    status: "success",
    owner,
    ownerType,
    window,
    timezone,
    empty,
    templates,
    repos: reposSummary,
    stats
  };
}

export function buildFailedManifest(args: {
  owner: string;
  ownerType: "user" | "org";
  window: { start: string; end: string; days: number; hours?: number };
  timezone: string | undefined;
  job: JobConfig;
  error: string;
}): ReportManifest {
  return {
    schemaVersion: 1,
    job: {
      id: args.job.id,
      name: args.job.name,
      description: args.job.description,
      mode: args.job.mode,
      version: args.job.jobVersion
    },
    status: "failed",
    error: args.error,
    owner: args.owner,
    ownerType: args.ownerType,
    window: args.window,
    timezone: args.timezone,
    empty: true,
    templates: [],
    repos: [],
    stats: { repos: 0, commits: 0, prs: 0, issues: 0 }
  };
}

export async function writeSummary(
  storage: StorageClient,
  key: string,
  manifest: ReportManifest,
  manifestKey: string
) {
  const body = JSON.stringify(
    {
      owner: manifest.owner,
      ownerType: manifest.ownerType,
      jobId: manifest.job.id,
      window: manifest.window,
      status: manifest.status ?? "success",
      empty: manifest.empty ?? false,
      templates: manifest.templates.map((template) => template.id),
      bytes: manifest.templates.reduce((sum, t) => sum + t.size, 0),
      manifestKey
    },
    null,
    2
  );
  return storage.put(key, body, "application/json");
}

export async function writeJobsRegistry(
  storage: StorageClient,
  key: string,
  owner: string,
  ownerType: "user" | "org",
  job: JobConfig
) {
  const existing = await storage.get(key);
  const parsed = existing
    ? JSON.parse(existing)
    : { owner, ownerType, jobs: [], updatedAt: new Date().toISOString() };
  const jobs: JobRegistryItem[] = parsed.jobs ?? [];
  const now = new Date().toISOString();
  const windowDays = job.windowHours
    ? job.windowHours / 24
    : job.windowDays ?? 1;
  const next: JobRegistryItem = {
    id: job.id,
    name: job.name,
    description: job.description,
    mode: job.mode,
    windowDays,
    windowHours: job.windowHours,
    templates: job.templates,
    outputFormat: job.outputFormat,
    outputPrefix: job.outputPrefix,
    version: job.jobVersion,
    updatedAt: now
  };
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index >= 0) {
    jobs[index] = next;
  } else {
    jobs.push(next);
  }
  const body = JSON.stringify({ owner, ownerType, jobs, updatedAt: now }, null, 2);
  return storage.put(key, body, "application/json");
}
