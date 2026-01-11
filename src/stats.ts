import { Octokit } from "@octokit/rest";
import type { RepoActivity, RateLimitInfo } from "./types.js";
import type { JobConfig } from "./jobs.js";
import type { AppConfig } from "./config.js";
import { updateRateLimit } from "./github-rate-limit.js";

export type StatsAuthor = {
  login: string;
  commits: number;
  additions: number;
  deletions: number;
  prsAuthored: number;
  prsMerged: number;
  issuesClosed: number;
  activityByHour: number[];
};

export type StatsPayload = {
  owner: string;
  ownerType: "user" | "org";
  window: { start: string; end: string; days: number; hours?: number };
  generatedAt: string;
  totals: {
    commits: number;
    additions: number;
    deletions: number;
    prsAuthored: number;
    prsMerged: number;
    issuesClosed: number;
  };
  authors: StatsAuthor[];
};

export async function collectHourlyStats(args: {
  config: AppConfig;
  job: JobConfig;
  repos: RepoActivity[];
  window: { start: string; end: string; days: number; hours?: number };
  rateLimit: RateLimitInfo;
  timeZone?: string;
}): Promise<StatsPayload> {
  const octokit = new Octokit({ auth: args.config.github.token });
  const authors = new Map<string, StatsAuthor>();
  const aliases = args.job.scope?.authorAliases ?? {};

  for (const repo of args.repos) {
    for (const commit of repo.commits) {
      const response = await octokit.repos.getCommit({
        owner: args.config.github.owner,
        repo: repo.repo.name,
        ref: commit.sha
      });
      updateRateLimit(args.rateLimit, response.headers as Record<string, string>);
      const login = resolveLogin(
        response.data.author?.login ?? response.data.commit?.author?.name ?? "unknown",
        aliases
      );
      const entry = ensureAuthor(authors, login);
      entry.commits += 1;
      entry.additions += response.data.stats?.additions ?? 0;
      entry.deletions += response.data.stats?.deletions ?? 0;
      const commitDate = response.data.commit?.author?.date;
      if (commitDate) {
        const hour = getHourOfDay(new Date(commitDate), args.timeZone);
        entry.activityByHour[hour] += 1;
      }
    }

    const pulls = await listPullsForRepo({
      octokit,
      owner: args.config.github.owner,
      repo: repo.repo.name,
      window: args.window,
      perPage: args.config.github.perPage,
      maxPages: args.config.github.maxPages,
      maxItems: args.config.context.maxPullRequestsPerRepo,
      rateLimit: args.rateLimit
    });
    for (const pr of pulls) {
      const author = resolveLogin(pr.author ?? "unknown", aliases);
      ensureAuthor(authors, author).prsAuthored += 1;
      if (pr.mergedBy) {
        const merger = resolveLogin(pr.mergedBy, aliases);
        ensureAuthor(authors, merger).prsMerged += 1;
      }
    }

    const issues = await listIssuesForRepo({
      octokit,
      owner: args.config.github.owner,
      repo: repo.repo.name,
      window: args.window,
      perPage: args.config.github.perPage,
      maxPages: args.config.github.maxPages,
      maxItems: args.config.context.maxIssuesPerRepo,
      rateLimit: args.rateLimit
    });
    for (const issue of issues) {
      const closer = issue.closedBy ? resolveLogin(issue.closedBy, aliases) : null;
      if (closer) {
        ensureAuthor(authors, closer).issuesClosed += 1;
      }
    }
  }

  const authorsList = Array.from(authors.values()).sort((a, b) =>
    a.login.localeCompare(b.login)
  );
  const totals = authorsList.reduce(
    (acc, author) => ({
      commits: acc.commits + author.commits,
      additions: acc.additions + author.additions,
      deletions: acc.deletions + author.deletions,
      prsAuthored: acc.prsAuthored + author.prsAuthored,
      prsMerged: acc.prsMerged + author.prsMerged,
      issuesClosed: acc.issuesClosed + author.issuesClosed
    }),
    {
      commits: 0,
      additions: 0,
      deletions: 0,
      prsAuthored: 0,
      prsMerged: 0,
      issuesClosed: 0
    }
  );

  return {
    owner: args.config.github.owner,
    ownerType: args.config.github.ownerType,
    window: args.window,
    generatedAt: new Date().toISOString(),
    totals,
    authors: authorsList
  };
}

function ensureAuthor(map: Map<string, StatsAuthor>, login: string) {
  const key = login.toLowerCase();
  const existing = map.get(key);
  if (existing) return existing;
  const next: StatsAuthor = {
    login,
    commits: 0,
    additions: 0,
    deletions: 0,
    prsAuthored: 0,
    prsMerged: 0,
    issuesClosed: 0,
    activityByHour: Array.from({ length: 24 }, () => 0)
  };
  map.set(key, next);
  return next;
}

function resolveLogin(value: string, aliases: Record<string, string>) {
  const trimmed = value.trim();
  const mapped = aliases[trimmed] ?? trimmed;
  return mapped;
}

function getHourOfDay(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? "UTC",
    hour: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  return Number.parseInt(hour, 10);
}

async function listPullsForRepo(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  window: { start: string; end: string };
  perPage: number;
  maxPages: number;
  maxItems: number;
  rateLimit: RateLimitInfo;
}) {
  const items: { author: string | null; mergedBy: string | null }[] = [];
  const iterator = args.octokit.paginate.iterator(args.octokit.pulls.list, {
    owner: args.owner,
    repo: args.repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: args.perPage
  });
  let page = 0;
  for await (const response of iterator) {
    updateRateLimit(args.rateLimit, response.headers as Record<string, string>);
    page += 1;
    const data = response.data ?? [];
    for (const pr of data) {
      const updatedAt = pr.updated_at ? new Date(pr.updated_at) : null;
      if (updatedAt && updatedAt < new Date(args.window.start)) {
        break;
      }
      if (!isWithinWindow(pr, args.window.start, args.window.end)) continue;
      const mergedBy = pr.merged_at
        ? await fetchMergedBy(args.octokit, args.owner, args.repo, pr.number, args.rateLimit)
        : null;
      items.push({ author: pr.user?.login ?? null, mergedBy });
      if (items.length >= args.maxItems) break;
    }
    if (items.length >= args.maxItems || page >= args.maxPages) break;
  }
  return items;
}

async function fetchMergedBy(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  rateLimit: RateLimitInfo
) {
  const details = await octokit.pulls.get({
    owner,
    repo,
    pull_number: number
  });
  updateRateLimit(rateLimit, details.headers as Record<string, string>);
  return details.data.merged_by?.login ?? null;
}

async function listIssuesForRepo(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  window: { start: string; end: string };
  perPage: number;
  maxPages: number;
  maxItems: number;
  rateLimit: RateLimitInfo;
}) {
  const items: { closedBy: string | null }[] = [];
  const iterator = args.octokit.paginate.iterator(args.octokit.issues.listForRepo, {
    owner: args.owner,
    repo: args.repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: args.perPage
  });
  let page = 0;
  for await (const response of iterator) {
    updateRateLimit(args.rateLimit, response.headers as Record<string, string>);
    page += 1;
    const data = response.data ?? [];
    for (const issue of data) {
      if (issue.pull_request) continue;
      const updatedAt = issue.updated_at ? new Date(issue.updated_at) : null;
      if (updatedAt && updatedAt < new Date(args.window.start)) {
        break;
      }
      if (!issue.closed_at) continue;
      const closedAt = new Date(issue.closed_at);
      if (closedAt < new Date(args.window.start) || closedAt > new Date(args.window.end)) {
        continue;
      }
      items.push({ closedBy: issue.closed_by?.login ?? null });
      if (items.length >= args.maxItems) break;
    }
    if (items.length >= args.maxItems || page >= args.maxPages) break;
  }
  return items;
}

function isWithinWindow(
  pr: {
    created_at: string;
    closed_at: string | null;
    merged_at: string | null;
  },
  start: string,
  end: string
) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const createdAt = new Date(pr.created_at);
  if (createdAt >= startDate && createdAt <= endDate) return true;
  if (pr.merged_at) {
    const mergedAt = new Date(pr.merged_at);
    if (mergedAt >= startDate && mergedAt <= endDate) return true;
  }
  if (pr.closed_at) {
    const closedAt = new Date(pr.closed_at);
    if (closedAt >= startDate && closedAt <= endDate) return true;
  }
  return false;
}
