import type { RepoActivity, ReportMetrics, ReportMetricsTotals } from "./types.js";
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
  status: "success" | "failed";
  error?: string;
  owner: string;
  ownerType: "user" | "org";
  scheduledAt: string;
  slotKey: string;
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  window: {
    start: string;
    end: string;
    days: number;
    hours?: number;
  };
  timezone?: string;
  empty?: boolean;

  // Observability fields
  generatedAt: string;
  durationMs: number;
  dataProfile: "minimal" | "standard" | "full";

  // LLM metadata (for pipeline/aggregate modes)
  llm?: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
  };

  // Aggregation source (for aggregate mode)
  source?: {
    jobId: string;
    itemCount: number;
  };

  // Single output (not templates[])
  output?: {
    format: "markdown" | "json";
    key: string;
    uri: string;
    size: number;
  };

  // Summary stats for calendar badges
  stats: {
    repos: number;
    commits: number;
    prs: number;
    issues: number;
  };
  metrics?: ReportMetrics;
  repos: {
    name: string;
    commits: number;
    prs: number;
    issues: number;
  }[];
};

export type SummaryItem = {
  owner: string;
  ownerType: "user" | "org";
  jobId: string;
  slotKey: string;
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  scheduledAt: string;
  window: {
    start: string;
    end: string;
    days: number;
    hours?: number;
  };
  status: "success" | "failed";
  empty: boolean;
  outputSize: number;
  manifestKey: string;
  metrics?: ReportMetricsTotals;
  durationMs?: number;
  llm?: ReportManifest["llm"];
};

export type IndexItem = SummaryItem;

export type JobRegistryItem = {
  id: string;
  name: string;
  description?: string;
  mode: "pipeline" | "aggregate" | "stats";
  schedule: {
    type: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    minute?: number;
    hour?: number;
    weekday?: number;
    dayOfMonth?: number;
    month?: number;
  };
  outputFormat: "markdown" | "json";
  outputPrefix?: string;
  version?: string;
  updatedAt: string;

  // Execution stats
  totalRuns: number;
  lastRunAt?: string;
  lastStatus?: "success" | "failed";
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
  jobId: string
) {
  const existing = await storage.get(key);
  const parsed = existing
    ? JSON.parse(existing)
    : { owner, ownerType, jobId, period, items: [] };
  const items: IndexItem[] = parsed.items ?? [];
  const already = items.find((entry) => entry.manifestKey === item.manifestKey);
  if (!already) {
    items.push(item);
    items.sort((a, b) => a.window.start.localeCompare(b.window.start));
  }
  const body = JSON.stringify(
    { owner, ownerType, jobId, period, items },
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
  jobId: string
) {
  const body = JSON.stringify(
    { owner, ownerType, jobId, latest: item },
    null,
    2
  );
  return storage.put(key, body, "application/json");
}

export function buildManifest(args: {
  owner: string;
  ownerType: "user" | "org";
  window: { start: string; end: string; days: number; hours?: number };
  timezone: string | undefined;
  scheduledAt: string;
  slotKey: string;
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  repos: RepoActivity[];
  output?: { format: "markdown" | "json"; stored: StoredArtifact };
  empty: boolean;
  job: JobConfig;
  durationMs: number;
  dataProfile: "minimal" | "standard" | "full";
  llm?: ReportManifest["llm"];
  source?: ReportManifest["source"];
  metrics?: ReportManifest["metrics"];
}): ReportManifest {
  const reposSummary = args.repos.map((repo) => ({
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

  return {
    schemaVersion: 1,
    job: {
      id: args.job.id,
      name: args.job.name,
      description: args.job.description,
      mode: args.job.mode,
      version: args.job.version
    },
    status: "success",
    owner: args.owner,
    ownerType: args.ownerType,
    scheduledAt: args.scheduledAt,
    slotKey: args.slotKey,
    slotType: args.slotType,
    window: args.window,
    timezone: args.timezone,
    empty: args.empty,
    generatedAt: new Date().toISOString(),
    durationMs: args.durationMs,
    dataProfile: args.dataProfile,
    llm: args.llm,
    source: args.source,
    output: args.output ? {
      format: args.output.format,
      key: args.output.stored.key,
      uri: args.output.stored.uri,
      size: args.output.stored.size
    } : undefined,
    repos: reposSummary,
    stats,
    metrics: args.metrics
  };
}

export function buildFailedManifest(args: {
  owner: string;
  ownerType: "user" | "org";
  window: { start: string; end: string; days: number; hours?: number };
  timezone: string | undefined;
  scheduledAt: string;
  slotKey: string;
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  job: JobConfig;
  error: string;
  durationMs: number;
}): ReportManifest {
  return {
    schemaVersion: 1,
    job: {
      id: args.job.id,
      name: args.job.name,
      description: args.job.description,
      mode: args.job.mode,
      version: args.job.version
    },
    status: "failed",
    error: args.error,
    owner: args.owner,
    ownerType: args.ownerType,
    scheduledAt: args.scheduledAt,
    slotKey: args.slotKey,
    slotType: args.slotType,
    window: args.window,
    timezone: args.timezone,
    empty: true,
    generatedAt: new Date().toISOString(),
    durationMs: args.durationMs,
    dataProfile: args.job.dataProfile ?? "standard",
    output: undefined,
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
      slotKey: manifest.slotKey,
      slotType: manifest.slotType,
      scheduledAt: manifest.scheduledAt,
      window: manifest.window,
      status: manifest.status,
      empty: manifest.empty ?? false,
      outputSize: manifest.output?.size ?? 0,
      manifestKey,
      metrics: manifest.metrics?.totals,
      durationMs: manifest.durationMs,
      llm: manifest.llm
    } as SummaryItem,
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
  job: JobConfig,
  lastStatus?: "success" | "failed"
) {
  const existing = await storage.get(key);
  const parsed = existing
    ? JSON.parse(existing)
    : { owner, ownerType, jobs: [], updatedAt: new Date().toISOString() };
  const jobs: JobRegistryItem[] = parsed.jobs ?? [];
  const now = new Date().toISOString();
  
  const existingItem = jobs.find((entry) => entry.id === job.id);
  const totalRuns = (existingItem?.totalRuns ?? 0) + 1;

  const next: JobRegistryItem = {
    id: job.id,
    name: job.name,
    description: job.description,
    mode: job.mode,
    schedule: job.schedule!,
    outputFormat: job.outputFormat,
    outputPrefix: job.outputPrefix,
    version: job.version,
    updatedAt: now,
    totalRuns,
    lastRunAt: now,
    lastStatus: lastStatus
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
