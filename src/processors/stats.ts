import { collectHourlyStats } from "../stats.js";
import { fetchActivity } from "../github.js";
import { withRetry } from "../retry.js";
import {
  buildFailedManifest,
  buildManifest,
  updateIndex,
  writeLatest,
  writeManifest,
  writeSummary
} from "../manifest.js";
import {
  applyAuthorFilters,
  applyCommitBudget,
  buildIndexBaseKey,
  buildReportBaseKey,
  formatMonthKey,
  getWindowSize,
  withDuration
} from "../utils.js";
import { formatTimestamp, type logger as LoggerType } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { JobConfig } from "../jobs.js";
import type { StorageClient } from "../storage.js";
import type { IndexItem } from "../manifest.js";
import type { WindowRunResult } from "../runner/types.js";

export async function runStatsWindow(
  slot: {
    slotKey: string;
    slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    scheduledAt: string;
    window: { start: string; end: string };
  },
  job: JobConfig,
  config: AppConfig,
  runLogger: ReturnType<typeof LoggerType.withContext>,
  storage: StorageClient,
  options?: { recordFailure?: boolean }
): Promise<WindowRunResult> {
  const { window, slotKey, slotType, scheduledAt } = slot;
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const owner = job.scope.owner;
  const ownerType = job.scope.ownerType;
  const allowlist = job.scope.allowlist ?? [];
  const blocklist = job.scope.blocklist ?? [];
  const includePrivate = job.scope.includePrivate ?? config.github.includePrivate;
  const dataProfile = job.dataProfile ?? "minimal";

  const { days: windowDays, hours: windowHours } = getWindowSize(
    slotType,
    window.start,
    window.end
  );
  
  const reportBaseKey = buildReportBaseKey(
    job.outputPrefix ?? config.output.prefix,
    ownerType,
    owner,
    job.id,
    slotKey
  );
  const indexBaseKey = buildIndexBaseKey(
    job.outputPrefix ?? config.output.prefix,
    ownerType,
    owner,
    job.id
  );
  const manifestKey = `${reportBaseKey}/manifest.json`;
  const summaryKey = `${reportBaseKey}/summary.json`;

  const recordFailure = options?.recordFailure ?? true;
  const baseResult = { slotKey, slotType, scheduledAt, window };

  const runStart = Date.now();

  try {
    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return { ...baseResult, status: "skipped", reason: "idempotent" };
      }
    }

    runLogger.info("job.window", {
      slotKey,
      slotType,
      scheduledAt,
      timeZone: config.timeZone ?? "UTC",
      windowUtc: window,
      windowLocal: {
        start: formatTimestamp(windowStart, config.timeZone),
        end: formatTimestamp(windowEnd, config.timeZone)
      },
      dataProfile,
      includeInactiveRepos: job.includeInactiveRepos ?? false
    });

    // 1. Fetch Repository Activity (minimal profile usually)
    const fetchStart = Date.now();
    runLogger.info("github.fetch.start", {
      window: {
        start: formatTimestamp(windowStart, config.timeZone),
        end: formatTimestamp(windowEnd, config.timeZone)
      }
    });

    const { repos, rateLimit, meta } = await withRetry(
      () =>
        fetchActivity(
          {
            token: config.github.token,
            owner,
            ownerType,
            allowlist,
            blocklist,
            includePrivate,
            perPage: config.github.perPage,
            maxPages: config.github.maxPages
          },
          window,
          dataProfile,
          {
            maxRepos: job.maxRepos
          }
        ),
      {
        retries: config.network.retryCount,
        backoffMs: config.network.retryBackoffMs
      }
    );

    // 2. Filter
    const cappedRepos = job.maxRepos ? repos.slice(0, job.maxRepos) : repos;
    const normalizedRepos = cappedRepos.map((repo) => ({
      ...repo,
      commits: job.maxCommitsPerRepo ? repo.commits.slice(0, job.maxCommitsPerRepo) : repo.commits
    }));
    const trimmedByBudget = applyCommitBudget(normalizedRepos, job.maxTotalCommits);
    const authorFiltered = applyAuthorFilters(trimmedByBudget, job);
    const reposForReport = job.includeInactiveRepos ? authorFiltered : authorFiltered.filter(r => r.commits.length > 0);

    runLogger.info("github.fetch.done", {
      totalRepoCount: meta.totalRepos,
      filteredRepoCount: meta.filteredRepos,
      excludedAllowlist: meta.excludedAllowlist,
      excludedBlocklist: meta.excludedBlocklist,
      excludedPrivate: meta.excludedPrivate,
      scannedRepos: meta.scannedRepos,
      stoppedEarly: meta.stoppedEarly,
      repoCount: authorFiltered.length,
      rateLimit,
      ...withDuration(fetchStart, config.logging.includeTimings)
    });

    // 3. Collect Stats
    const statsStart = Date.now();
    const statsPayload = await collectHourlyStats({
      config,
      job,
      repos: reposForReport,
      window: { ...window, days: windowDays, hours: windowHours },
      rateLimit,
      timeZone: config.timeZone
    });
    
    runLogger.info("stats.collect.done", {
      totals: statsPayload.totals,
      ...withDuration(statsStart, config.logging.includeTimings)
    });

    const isEmpty = statsPayload.totals.commits === 0 && 
                    statsPayload.totals.prsAuthored === 0 &&
                    statsPayload.totals.issuesClosed === 0;

    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return { ...baseResult, status: "skipped", reason: "empty" };
    }

    // 4. Store Output
    let output;
    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      const outputKey = `${reportBaseKey}/output.json`;
      const stored = await storage.put(
        outputKey,
        JSON.stringify(statsPayload, null, 2),
        "application/json"
      );
      output = { format: "json" as const, stored };
    }

    // 5. Manifest & Indexing
    const durationMs = Date.now() - runStart;
    const manifest = buildManifest({
      owner,
      ownerType,
      window: { ...window, days: windowDays, hours: windowHours },
      timezone: config.timeZone,
      scheduledAt,
      slotKey,
      slotType,
      repos: reposForReport,
      output,
      empty: isEmpty,
      job,
      durationMs,
      dataProfile
    });

    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);

    const periodKey = formatMonthKey(windowStart, config.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    const indexItem: IndexItem = {
      owner,
      ownerType,
      jobId: job.id,
      slotKey,
      slotType,
      scheduledAt,
      window: { ...window, days: windowDays, hours: windowHours },
      status: "success",
      empty: isEmpty,
      outputSize: manifest.output?.size ?? 0,
      manifestKey,
      durationMs
    };
    await updateIndex(storage, monthKey, owner, ownerType, periodKey, indexItem, job.id);
    await writeLatest(storage, `${indexBaseKey}/latest.json`, owner, ownerType, indexItem, job.id);

    return {
      ...baseResult,
      status: "success",
      durationMs,
      manifestKey,
      outputUri: output?.stored.uri
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runLogger.error("run.failed", { error: errorMessage });

    const durationMs = Date.now() - runStart;
    if (recordFailure) {
      const failedManifest = buildFailedManifest({
        owner,
        ownerType,
        window: { ...window, days: windowDays, hours: windowHours },
        timezone: config.timeZone,
        scheduledAt,
        slotKey,
        slotType,
        job,
        error: errorMessage,
        durationMs
      });
      
      await writeManifest(storage, manifestKey, failedManifest);
      await writeSummary(storage, summaryKey, failedManifest, manifestKey);
   
      const periodKey = formatMonthKey(windowStart, config.timeZone);
      const monthKey = `${indexBaseKey}/${periodKey}.json`;
      const indexItem: IndexItem = {
        owner,
        ownerType,
        jobId: job.id,
        slotKey,
        slotType,
        scheduledAt,
        window: { ...window, days: windowDays, hours: windowHours },
        status: "failed",
        empty: true,
        outputSize: 0,
        manifestKey,
        durationMs
      };
      await updateIndex(storage, monthKey, owner, ownerType, periodKey, indexItem, job.id);
      await writeLatest(storage, `${indexBaseKey}/latest.json`, owner, ownerType, indexItem, job.id);
    }

    return {
      ...baseResult,
      status: "failed",
      error: errorMessage,
      durationMs,
      manifestKey: recordFailure ? manifestKey : undefined
    };
  }
}
