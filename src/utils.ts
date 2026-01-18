import type { JobConfig } from "./jobs.js";
import type { RepoActivity, ReportInput } from "./types.js";
import type { IndexItem } from "./manifest.js";
import type { StorageClient } from "./storage.js";

export function getWindowSize(
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly",
  startIso: string,
  endIso: string
) {
  if (slotType === "hourly") {
    return { days: 0, hours: 1 };
  }
  if (slotType === "daily") {
    return { days: 1 };
  }
  if (slotType === "weekly") {
    return { days: 7 };
  }
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  return { days };
}

export function buildReportBaseKey(
  prefix: string,
  ownerType: string,
  owner: string,
  jobId: string,
  slotKey: string
) {
  // NEW: redundant /jobs/ segment removed
  return `${prefix}/${ownerType}/${owner}/${jobId}/${slotKey}`;
}

export function buildIndexBaseKey(
  prefix: string,
  ownerType: string,
  owner: string,
  jobId: string
) {
  return `${prefix}/_index/${ownerType}/${owner}/${jobId}`;
}

export function buildJobsRegistryKey(
  prefix: string,
  ownerType: string,
  owner: string
) {
  return `${prefix}/_index/${ownerType}/${owner}/jobs.json`;
}

export function applyCommitBudget(
  repos: RepoActivity[],
  maxTotalCommits?: number
) {
  if (!maxTotalCommits) return repos;
  let remaining = maxTotalCommits;
  return repos.map((repo) => {
    if (remaining <= 0) {
      return { ...repo, commits: [] };
    }
    const slice = repo.commits.slice(0, remaining);
    remaining -= slice.length;
    return { ...repo, commits: slice };
  });
}

export function applyAuthorFilters(repos: RepoActivity[], job: JobConfig) {
  const include = normalizeAuthors(job.scope?.authors, job.scope?.authorAliases);
  const exclude = normalizeAuthors(
    job.scope?.excludeAuthors,
    job.scope?.authorAliases
  );
  if (include.size === 0 && exclude.size === 0) return repos;
  return repos.map((repo) => ({
    ...repo,
    commits: repo.commits.filter((commit) => {
      const author = normalizeAuthor(commit.author, job.scope?.authorAliases);
      if (exclude.has(author)) return false;
      if (include.size === 0) return true;
      return include.has(author);
    })
  }));
}

export function applyContextAuthorFilters(repos: RepoActivity[], job: JobConfig) {
  const include = normalizeAuthors(job.scope?.authors, job.scope?.authorAliases);
  const exclude = normalizeAuthors(
    job.scope?.excludeAuthors,
    job.scope?.authorAliases
  );
  if (include.size === 0 && exclude.size === 0) return repos;
  return repos.map((repo) => {
    if (!repo.context) return repo;
    const pullRequests = repo.context.pullRequests?.filter((pr) => {
      const author = normalizeAuthor(pr.author, job.scope?.authorAliases);
      if (exclude.has(author)) return false;
      if (include.size === 0) return true;
      return include.has(author);
    });
    const issues = repo.context.issues?.filter((issue) => {
      const author = normalizeAuthor(issue.author, job.scope?.authorAliases);
      if (exclude.has(author)) return false;
      if (include.size === 0) return true;
      return include.has(author);
    });
    return {
      ...repo,
      context: {
        ...repo.context,
        pullRequests,
        issues
      }
    };
  });
}

export function applyRedactions(repos: RepoActivity[], redactPaths?: string[]) {
  if (!redactPaths || redactPaths.length === 0) return repos;
  return repos.map((repo) => {
    if (!repo.context) return repo;
    const diffSummary = repo.context.diffSummary?.map((commit) => ({
      ...commit,
      files: commit.files.filter((file) => !matchesAny(file.path, redactPaths))
    }));
    const diffSnippets = repo.context.diffSnippets?.map((commit) => ({
      ...commit,
      files: commit.files.filter((file) => !matchesAny(file.path, redactPaths))
    }));
    return {
      ...repo,
      context: {
        ...repo.context,
        diffSummary,
        diffSnippets
      }
    };
  });
}

export function matchesAny(path: string, patterns: string[]) {
  return patterns.some((pattern) => path.includes(pattern));
}

export function normalizeAuthors(
  authors: string[] | undefined,
  aliases?: Record<string, string>
) {
  const set = new Set<string>();
  for (const author of authors ?? []) {
    set.add(normalizeAuthor(author, aliases));
  }
  return set;
}

export function normalizeAuthor(
  author: string | null | undefined,
  aliases?: Record<string, string>
) {
  if (!author) return "";
  const trimmed = author.trim();
  const mapped = aliases?.[trimmed] ?? trimmed;
  return mapped.toLowerCase();
}

export function summarizeActivity(repos: ReportInput["repos"]) {
  return repos.reduce(
    (acc, repo) => ({
      commits: acc.commits + repo.commits.length,
      prs: acc.prs + (repo.context?.pullRequests?.length ?? 0),
      issues: acc.issues + (repo.context?.issues?.length ?? 0)
    }),
    { commits: 0, prs: 0, issues: 0 }
  );
}

export function buildEmptyReport(format: "markdown" | "json", templateId: string) {
  if (format === "json") {
    return JSON.stringify({ empty: true, template: templateId }, null, 2);
  }
  return `# No activity\n\nNo activity recorded for this window.`;
}

export function countLines(text: string) {
  if (!text) return 0;
  return text.split("\n").length;
}

export function truncateTextBytes(value: string | undefined, maxBytes: number) {
  if (!value) return undefined;
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf8")}...[truncated]`;
}

export function truncateBytes(value: string, maxBytes: number) {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function formatMonthKey(value: Date, timeZone?: string) {
  if (!timeZone) return value.toISOString().slice(0, 7);
  const parts = formatDateParts(value, timeZone);
  return `${parts.year}-${parts.month}`;
}

export function formatDateOnly(value: Date, timeZone?: string) {
  if (!timeZone) return value.toISOString().slice(0, 10);
  const parts = formatDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateWithWeekday(value: Date | string, timeZone?: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long"
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as { year: string; month: string; day: string; weekday: string };
  return `${map.weekday}, ${map.year}-${map.month}-${map.day}`;
}

function formatDateParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(value);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as { year: string; month: string; day: string };
  return map;
}

export function withDuration(startMs: number, includeTimings?: boolean) {
  if (!includeTimings) return {};
  return { durationMs: Date.now() - startMs };
}
export function overlapsWindow(item: IndexItem, window: { start: string; end: string }) {
  const start = new Date(item.window.start).getTime();
  const end = new Date(item.window.end).getTime();
  const windowStart = new Date(window.start).getTime();
  const windowEnd = new Date(window.end).getTime();
  return start < windowEnd && end > windowStart;
}

export function listMonthKeys(startIso: string, endIso: string, timeZone?: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months = new Set<string>();
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    months.add(formatMonthKey(cursor, timeZone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Array.from(months).sort();
}

export async function loadIndexItemsForRange(
  storage: StorageClient,
  indexBase: string,
  window: { start: string; end: string },
  timeZone?: string
) {
  const months = listMonthKeys(window.start, window.end, timeZone);
  const items: IndexItem[] = [];
  for (const month of months) {
    const text = await storage.get(`${indexBase}/${month}.json`);
    if (!text) continue;
    const parsed = JSON.parse(text) as { items?: IndexItem[] };
    for (const item of parsed.items ?? []) {
      if (overlapsWindow(item, window)) {
        items.push(item);
      }
    }
  }
  items.sort((a, b) => a.window.start.localeCompare(b.window.start));
  return items;
}
