import { fetchActivity } from "../github.js";
import { generateReport, basePrompt } from "../generator.js";
import { withRetry } from "../retry.js";
import { enrichReposWithContext } from "../context/index.js";
import { sendWebhook } from "../webhook.js";
import {
  buildFailedManifest,
  buildManifest,
  updateIndex,
  writeLatest,
  writeManifest,
  writeSummary,
  type IndexItem
} from "../manifest.js";
import {
  applyAuthorFilters,
  applyCommitBudget,
  applyContextAuthorFilters,
  applyRedactions,
  buildEmptyReport,
  buildIndexBaseKey,
  buildReportBaseKey,
  formatMonthKey,
  getWindowSize,
  summarizeActivity,
  withDuration
} from "../utils.js";
import { formatTimestamp, type logger as LoggerType } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { JobConfig } from "../jobs.js";
import type { StorageClient } from "../storage.js";
import type { ReportInput, WebhookPayload } from "../types.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function runPipelineWindow(
  slot: {
    slotKey: string;
    slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
    scheduledAt: string;
    window: { start: string; end: string };
  },
  job: JobConfig,
  config: AppConfig,
  runLogger: ReturnType<typeof LoggerType.withContext>,
  storage: StorageClient
) {
  const { window, slotKey, slotType, scheduledAt } = slot;
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const owner = job.scope.owner;
  const ownerType = job.scope.ownerType;
  const allowlist = job.scope.allowlist ?? [];
  const blocklist = job.scope.blocklist ?? [];
  const includePrivate = job.scope.includePrivate ?? config.github.includePrivate;

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

  const runStart = Date.now();

  try {
    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return;
      }
    }

    // 1. Fetch Repository Activity
    const fetchStart = Date.now();
    runLogger.info("github.fetch.start", {
      allowlistCount: allowlist.length,
      blocklistCount: blocklist.length,
      includePrivate,
      window: {
        start: formatTimestamp(windowStart, config.logging.timeZone),
        end: formatTimestamp(windowEnd, config.logging.timeZone)
      }
    });

    const { repos, rateLimit } = await withRetry(
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
          window
        ),
      {
        retries: config.network.retryCount,
        backoffMs: config.network.retryBackoffMs
      }
    );

    // 2. Apply Filters & Budgets
    const cappedRepos = job.maxRepos ? repos.slice(0, job.maxRepos) : repos;
    const normalizedRepos = cappedRepos.map((repo) => ({
      ...repo,
      commits: job.maxCommitsPerRepo
        ? repo.commits.slice(0, job.maxCommitsPerRepo)
        : repo.commits
    }));
    const trimmedByBudget = applyCommitBudget(normalizedRepos, job.maxTotalCommits);
    const authorFiltered = applyAuthorFilters(trimmedByBudget, job);

    const inactiveRepoCount = authorFiltered.filter((repo) => repo.commits.length === 0).length;
    const activeRepos = authorFiltered.filter((repo) => repo.commits.length > 0);
    const reposForReport = job.includeInactiveRepos ? authorFiltered : activeRepos;

    runLogger.info("github.fetch.done", {
      repoCount: authorFiltered.length,
      activeRepoCount: activeRepos.length,
      inactiveRepoCount,
      ...withDuration(fetchStart, config.logging.includeTimings)
    });

    // 3. Enrich with Context
    const providerResults = await enrichReposWithContext({
      repos: reposForReport,
      window,
      config,
      rateLimit,
      logger: runLogger,
      providerAllowlist: job.contextProviders,
      dataProfile: job.dataProfile
    });
    runLogger.info("context.providers", { results: providerResults });

    const afterContext = applyContextAuthorFilters(reposForReport, job);
    const redacted = applyRedactions(afterContext, job.redactPaths);

    const activityStats = summarizeActivity(redacted);
    const isEmpty = activityStats.commits === 0 && activityStats.prs === 0 && activityStats.issues === 0;

    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return;
    }

    // 4. Generate Report
    let output;
    let llmMetadata: { model: string; inputTokens?: number; outputTokens?: number } | undefined;

    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      const outputFormat = job.outputFormat ?? config.output.format;
      const extension = outputFormat === "json" ? "json" : "md";
      const outputKey = `${reportBaseKey}/output.${extension}`;
      const contentType = outputFormat === "json" ? "application/json" : "text/markdown; charset=utf-8";

      let reportText = "";

      if (isEmpty && job.onEmpty !== "manifest-only") {
        reportText = buildEmptyReport(outputFormat, job.id);
      } else {
        const generateStart = Date.now();
        runLogger.info("report.generate.start", {
          model: config.llm.model,
          format: outputFormat
        });

        // Resolve prompt
        let promptTemplate = job.prompt ?? basePrompt;
        if (job.promptFile) {
          try {
            const absolutePath = path.resolve(process.cwd(), job.promptFile);
            promptTemplate = await fs.readFile(absolutePath, "utf-8");
          } catch (err) {
            runLogger.warn("report.prompt_file.failed", { path: job.promptFile, error: String(err) });
          }
        }

        const input: ReportInput = {
          owner,
          ownerType,
          window,
          repos: redacted,
          inactiveRepoCount: job.includeInactiveRepos ? undefined : inactiveRepoCount
        };

        const report = await withRetry(
          () =>
            generateReport(input, {
              apiKey: config.llm.apiKey,
              model: config.llm.model,
              promptTemplate,
              outputFormat,
              outputSchemaJson: config.output.schemaJson,
              maxTokensHint: job.maxTokensHint
            }),
          {
            retries: config.network.retryCount,
            backoffMs: config.network.retryBackoffMs
          }
        );
        reportText = report.text;
        llmMetadata = report.usage ? {
          model: config.llm.model,
          inputTokens: report.usage.inputTokens,
          outputTokens: report.usage.outputTokens,
        } : undefined;

        runLogger.info("report.generate.done", {
          format: report.format,
          length: report.text.length,
          ...withDuration(generateStart, config.logging.includeTimings)
        });
      }

      // 5. Store Output
      const stored = await storage.put(outputKey, reportText, contentType);
      output = { format: outputFormat, stored };

      // 6. Webhook
      const payload: WebhookPayload = {
        owner,
        ownerType,
        jobId: job.id,
        jobName: job.name,
        window,
        artifact: stored,
        format: outputFormat,
        createdAt: new Date().toISOString()
      };
      
      const webhookConfig = job.webhook ?? config.webhook;
      if (webhookConfig.url || (webhookConfig.token && webhookConfig.channel)) {
        runLogger.info("webhook.send.start");
        await withRetry(() => sendWebhook(webhookConfig, payload, reportText), {
          retries: config.network.retryCount,
          backoffMs: config.network.retryBackoffMs
        });
      }
    }

    // 7. Manifest & Indexing
    const dataProfile = job.dataProfile ?? "standard";
    const manifest = buildManifest({
      owner,
      ownerType,
      window: { ...window, days: windowDays, hours: windowHours },
      timezone: config.logging.timeZone,
      scheduledAt,
      slotKey,
      slotType,
      repos: redacted,
      output,
      empty: isEmpty,
      job,
      durationMs: Date.now() - runStart,
      dataProfile,
      llm: llmMetadata
    });

    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);
    
    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
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
      manifestKey
    };
    await updateIndex(storage, monthKey, owner, ownerType, periodKey, indexItem, job.id);

    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(storage, latestKey, owner, ownerType, indexItem, job.id);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runLogger.error("run.failed", { error: errorMessage });
    
    const failedManifest = buildFailedManifest({
      owner,
      ownerType,
      window: { ...window, days: windowDays, hours: windowHours },
      timezone: config.logging.timeZone,
      scheduledAt,
      slotKey,
      slotType,
      job,
      error: errorMessage,
      durationMs: Date.now() - runStart
    });
    
    await writeManifest(storage, manifestKey, failedManifest);
    await writeSummary(storage, summaryKey, failedManifest, manifestKey);
    
    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
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
      manifestKey
    };
    await updateIndex(storage, monthKey, owner, ownerType, periodKey, indexItem, job.id);
    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(storage, latestKey, owner, ownerType, indexItem, job.id);
  }
}
