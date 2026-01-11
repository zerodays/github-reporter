import { loadConfig } from "./config.js";
import { loadJobs, loadSchedulerConfig, type JobConfig } from "./jobs.js";
import { fetchActivity } from "./github.js";
import {
  aggregatePrompt,
  basePrompt,
  generateAggregateReport,
  generateReport
} from "./generator.js";
import { createStorageClient, describeStorage, validateStorage } from "./storage.js";
import { sendWebhook } from "./webhook.js";
import type {
  AggregateInput,
  RepoActivity,
  ReportInput,
  WebhookPayload
} from "./types.js";
import { formatTimestamp, logger, setLoggerConfig } from "./logger.js";
import { withRetry } from "./retry.js";
import { enrichReposWithContext } from "./context/index.js";
import { getTemplateById } from "./templates.js";
import {
  buildFailedManifest,
  buildManifest,
  updateIndex,
  writeJobsRegistry,
  writeLatest,
  writeManifest,
  writeSummary
} from "./manifest.js";
import type { IndexItem, ReportManifest } from "./manifest.js";
import { getScheduleDecision } from "./scheduler.js";
import { collectHourlyStats } from "./stats.js";

async function main() {
  const config = loadConfig();
  setLoggerConfig({
    level: config.logging.level,
    includeTimings: config.logging.includeTimings,
    format: config.logging.format,
    color: config.logging.color,
    timeZone: config.logging.timeZone
  });
  const baseLogger = logger.withContext({
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  const storage = createStorageClient(config.storage);
  baseLogger.info("storage.validate.start", describeStorage(config.storage));
  await validateStorage(config.storage);
  baseLogger.info("storage.validate.done", describeStorage(config.storage));

  const schedulerConfig = loadSchedulerConfig();
  const jobs = loadJobs();
  baseLogger.info("run.start", { jobs: jobs.map((job) => job.id) });

  for (const job of jobs) {
    await runJob(job, config, storage, schedulerConfig);
  }

  baseLogger.info("run.complete", { jobs: jobs.map((job) => job.id) });
}

async function runJob(
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  storage: ReturnType<typeof createStorageClient>,
  schedulerConfig: { runScheduledOnly: boolean }
) {
  const jobOwner = job.scope?.owner ?? config.github.owner;
  const jobOwnerType = job.scope?.ownerType ?? config.github.ownerType;
  const jobLogger = logger.withContext({
    owner: jobOwner,
    ownerType: jobOwnerType,
    jobId: job.id,
    jobName: job.name
  });
  const now = new Date();
  if (schedulerConfig.runScheduledOnly && job.schedule) {
    const decision = await getScheduleDecision({
      job,
      now,
      timeZone: config.logging.timeZone,
      storage,
      owner: jobOwner,
      ownerType: jobOwnerType,
      prefix: config.output.prefix
    });
    if (!decision.due) {
      jobLogger.info("job.skipped", {
        reason: "not_due",
        slotKey: decision.slotKey,
        lastSlotKey: decision.lastSlotKey,
        nextSlotKey: decision.nextSlotKey
      });
      return;
    }
    jobLogger.info("job.due", {
      slotKey: decision.slotKey,
      lastSlotKey: decision.lastSlotKey,
      nextSlotKey: decision.nextSlotKey
    });
  }

  const windows = buildWindows(job, now);
  jobLogger.info("job.start", {
    windowDays: job.windowDays,
    windows: windows.length,
    mode: job.mode
  });

  if (windows.length > 1) {
    jobLogger.info("backfill.start", {
      days: windows.length,
      start: formatTimestamp(new Date(windows[0].start), config.logging.timeZone),
      end: formatTimestamp(
        new Date(windows[windows.length - 1].end),
        config.logging.timeZone
      )
    });
  }

  const jobsKey = buildJobsRegistryKey(config, jobOwnerType, jobOwner);
  await writeJobsRegistry(storage, jobsKey, jobOwner, jobOwnerType, job);

  if (job.mode === "aggregate") {
    for (const window of windows) {
      await runAggregateWindow(window, job, config, jobLogger, storage);
    }
    jobLogger.info("job.complete", { windows: windows.length });
    return;
  }

  if (job.mode === "stats") {
    for (const window of windows) {
      await runStatsWindow(window, job, config, jobLogger, storage);
    }
    jobLogger.info("job.complete", { windows: windows.length });
    return;
  }

  for (const window of windows) {
    await runForWindow(window, job, config, jobLogger, storage);
  }

  jobLogger.info("job.complete", { windows: windows.length });
}

async function runForWindow(
  window: { start: string; end: string },
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  runLogger: ReturnType<typeof logger.withContext>,
  storage: ReturnType<typeof createStorageClient>
) {
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const owner = job.scope?.owner ?? config.github.owner;
  const ownerType = job.scope?.ownerType ?? config.github.ownerType;
  const allowlist = job.scope?.allowlist ?? config.github.allowlist;
  const blocklist = job.scope?.blocklist ?? config.github.blocklist;
  const includePrivate =
    job.scope?.includePrivate ?? config.github.includePrivate;
  const windowHours = job.windowHours;
  const windowDays = resolveWindowDays(job);
  const windowKey = buildWindowKey(
    windowStart,
    windowEnd,
    config.logging.timeZone,
    Boolean(job.windowHours)
  );
  const reportBaseKey = buildReportBaseKey(
    config,
    job,
    ownerType,
    owner,
    windowKey
  );
  const indexBaseKey = buildIndexBaseKey(config, job, ownerType, owner);
  const manifestKey = `${reportBaseKey}/manifest.json`;
  const summaryKey = `${reportBaseKey}/summary.json`;

  try {
    const fetchStart = Date.now();
    runLogger.info("github.fetch.start", {
      allowlistCount: allowlist.length,
      blocklistCount: blocklist.length,
      includePrivate,
      perPage: config.github.perPage,
      maxPages: config.github.maxPages,
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

    const cappedRepos = job.maxRepos ? repos.slice(0, job.maxRepos) : repos;
    const normalizedRepos = cappedRepos.map((repo) => ({
      ...repo,
      commits: job.maxCommitsPerRepo
        ? repo.commits.slice(0, job.maxCommitsPerRepo)
        : repo.commits
    }));
    const trimmedByBudget = applyCommitBudget(
      normalizedRepos,
      job.maxTotalCommits
    );
    const authorFiltered = applyAuthorFilters(trimmedByBudget, job);

    const inactiveRepoCount = authorFiltered.filter(
      (repo) => repo.commits.length === 0
    ).length;
    const activeRepos = authorFiltered.filter(
      (repo) => repo.commits.length > 0
    );
    const reposForReport = job.includeInactiveRepos
      ? authorFiltered
      : activeRepos;

    runLogger.info("github.fetch.done", {
      repoCount: authorFiltered.length,
      activeRepoCount: activeRepos.length,
      inactiveRepoCount,
      maxCommitsPerRepo: job.maxCommitsPerRepo ?? null,
      maxRepos: job.maxRepos ?? null,
      maxTotalCommits: job.maxTotalCommits ?? null,
      ...withDuration(fetchStart, config)
    });

    const providerResults = await enrichReposWithContext({
      repos: reposForReport,
      window,
      config,
      rateLimit,
      logger: runLogger,
      providerAllowlist: job.contextProviders
    });
    runLogger.info("context.providers", { results: providerResults });

    const afterContext = applyContextAuthorFilters(reposForReport, job);
    const redacted = applyRedactions(afterContext, job.redactPaths);

    runLogger.info("context.snapshot", {
      repoCount: redacted.length,
      ...buildContextSnapshot(
        redacted,
        job.contextMaxBytes ?? config.logging.contextMaxBytes
      )
    });
    runLogger.info("context.files_read", buildContextFileStats(redacted));

    runLogger.info("github.rate_limit", {
      remaining: rateLimit.remaining ?? null,
      limit: rateLimit.limit ?? null,
      reset: rateLimit.reset ?? null,
      resetAt: rateLimit.reset
        ? formatTimestamp(
            new Date(rateLimit.reset * 1000),
            config.logging.timeZone
          )
        : null,
      resetInSeconds: rateLimit.reset
        ? Math.max(0, Math.floor(rateLimit.reset - Date.now() / 1000))
        : null
    });

    const input: ReportInput = {
      owner,
      ownerType,
      window,
      repos: redacted,
      inactiveRepoCount: job.includeInactiveRepos
        ? undefined
        : inactiveRepoCount
    };

    const activityStats = summarizeActivity(redacted);
    const isEmpty =
      activityStats.commits === 0 &&
      activityStats.prs === 0 &&
      activityStats.issues === 0;

    const templates = job.templates.length > 0 ? job.templates : ["default"];
    const artifacts: {
      id: string;
      format: string;
      stored: { key: string; uri: string; size: number };
    }[] = [];

    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return;
      }
    }

    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return;
    }

    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      for (const templateId of templates) {
        const template =
          templateId === "default" ? null : getTemplateById(templateId);
        if (templateId !== "default" && !template) {
          runLogger.warn("report.template.missing", { templateId });
          continue;
        }

        const outputFormat =
          template?.outputFormat ?? job.outputFormat ?? config.output.format;
        const templatePrompt = template
          ? [config.llm.promptTemplate ?? basePrompt, template.instructions].join(
              "\n\n"
            )
          : config.llm.promptTemplate ?? basePrompt;
        const extension = outputFormat === "json" ? "json" : "md";
        const templateKey = `${reportBaseKey}/${template?.id ?? "default"}.${extension}`;
        const contentType =
          outputFormat === "json"
            ? "application/json"
            : "text/markdown; charset=utf-8";

        let reportText = "";
        if (isEmpty && job.onEmpty !== "manifest-only") {
          reportText = buildEmptyReport(outputFormat, template?.id ?? "default");
        } else if (!isEmpty) {
          const generateStart = Date.now();
          runLogger.info("report.generate.start", {
            model: config.llm.model,
            format: outputFormat,
            template: template?.id ?? "default"
          });
          const report = await withRetry(
            () =>
              generateReport(input, {
                apiKey: config.llm.apiKey,
                model: config.llm.model,
                promptTemplate: templatePrompt,
                outputFormat,
                outputSchemaJson: config.output.schemaJson,
                validateSchema: config.output.validateSchema,
                maxTokensHint: job.maxTokensHint
              }),
            {
              retries: config.network.retryCount,
              backoffMs: config.network.retryBackoffMs
            }
          );
          reportText = report.text;
          runLogger.info("report.generate.done", {
            format: report.format,
            length: report.text.length,
            template: template?.id ?? "default",
            ...withDuration(generateStart, config)
          });
        }

        const writeStart = Date.now();
        runLogger.info("artifact.write.start", {
          storageType: config.storage.type,
          key: templateKey,
          template: template?.id ?? "default"
        });
        const artifact = await storage.put(templateKey, reportText, contentType);
        runLogger.info("artifact.write.done", {
          key: artifact.key,
          uri: artifact.uri,
          size: artifact.size,
          template: template?.id ?? "default",
          ...withDuration(writeStart, config)
        });
        artifacts.push({
          id: template?.id ?? "default",
          format: outputFormat,
          stored: artifact
        });

        const payload: WebhookPayload = {
          owner,
          ownerType,
          jobId: job.id,
          jobName: job.name,
          window,
          artifact,
          format: outputFormat,
          createdAt: new Date().toISOString()
        };

        const webhookStart = Date.now();
        runLogger.info("webhook.send.start", {
          enabled: Boolean(config.webhook.url),
          template: template?.id ?? "default"
        });
        await withRetry(() => sendWebhook(config.webhook, payload), {
          retries: config.network.retryCount,
          backoffMs: config.network.retryBackoffMs
        });
        runLogger.info("webhook.send.done", {
          enabled: Boolean(config.webhook.url),
          template: template?.id ?? "default",
          ...withDuration(webhookStart, config)
        });

        runLogger.info("run.complete", {
          artifact: artifact.uri,
          template: template?.id ?? "default"
        });
      }
    }

    if (artifacts.length === 0 && !(isEmpty && job.onEmpty === "manifest-only")) {
      runLogger.warn("manifest.skipped", { window: windowKey });
      return;
    }

    const manifest = buildManifest(
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      config.logging.timeZone,
      redacted,
      artifacts,
      isEmpty,
      job
    );
    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);
    runLogger.info("manifest.write", { key: manifestKey });

    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.update", { key: monthKey });

    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.latest", { key: latestKey });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runLogger.error("run.failed", { error: errorMessage });
    const failedManifest = buildFailedManifest({
      owner,
      ownerType,
      window: { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      timezone: config.logging.timeZone,
      job,
      error: errorMessage
    });
    await writeManifest(storage, manifestKey, failedManifest);
    await writeSummary(storage, summaryKey, failedManifest, manifestKey);
    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
  }
}

async function runStatsWindow(
  window: { start: string; end: string },
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  runLogger: ReturnType<typeof logger.withContext>,
  storage: ReturnType<typeof createStorageClient>
) {
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const owner = job.scope?.owner ?? config.github.owner;
  const ownerType = job.scope?.ownerType ?? config.github.ownerType;
  const allowlist = job.scope?.allowlist ?? config.github.allowlist;
  const blocklist = job.scope?.blocklist ?? config.github.blocklist;
  const includePrivate =
    job.scope?.includePrivate ?? config.github.includePrivate;
  const windowHours = job.windowHours;
  const windowDays = resolveWindowDays(job);
  const windowKey = buildWindowKey(
    windowStart,
    windowEnd,
    config.logging.timeZone,
    Boolean(job.windowHours)
  );
  const reportBaseKey = buildReportBaseKey(
    config,
    job,
    ownerType,
    owner,
    windowKey
  );
  const indexBaseKey = buildIndexBaseKey(config, job, ownerType, owner);
  const manifestKey = `${reportBaseKey}/manifest.json`;
  const summaryKey = `${reportBaseKey}/summary.json`;

  try {
    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return;
      }
    }

    const fetchStart = Date.now();
    runLogger.info("github.fetch.start", {
      allowlistCount: allowlist.length,
      blocklistCount: blocklist.length,
      includePrivate,
      perPage: config.github.perPage,
      maxPages: config.github.maxPages,
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

    const cappedRepos = job.maxRepos ? repos.slice(0, job.maxRepos) : repos;
    const normalizedRepos = cappedRepos.map((repo) => ({
      ...repo,
      commits: job.maxCommitsPerRepo
        ? repo.commits.slice(0, job.maxCommitsPerRepo)
        : repo.commits
    }));
    const trimmedByBudget = applyCommitBudget(
      normalizedRepos,
      job.maxTotalCommits
    );
    const authorFiltered = applyAuthorFilters(trimmedByBudget, job);

    const inactiveRepoCount = authorFiltered.filter(
      (repo) => repo.commits.length === 0
    ).length;
    const activeRepos = authorFiltered.filter(
      (repo) => repo.commits.length > 0
    );
    const reposForReport = job.includeInactiveRepos
      ? authorFiltered
      : activeRepos;

    runLogger.info("github.fetch.done", {
      repoCount: authorFiltered.length,
      activeRepoCount: activeRepos.length,
      inactiveRepoCount,
      maxCommitsPerRepo: job.maxCommitsPerRepo ?? null,
      maxRepos: job.maxRepos ?? null,
      maxTotalCommits: job.maxTotalCommits ?? null,
      ...withDuration(fetchStart, config)
    });

    const statsStart = Date.now();
    const statsPayload = await collectHourlyStats({
      config,
      job,
      repos: reposForReport,
      window: { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      rateLimit,
      timeZone: config.logging.timeZone
    });
    runLogger.info("stats.collect.done", {
      totals: statsPayload.totals,
      authors: statsPayload.authors.length,
      ...withDuration(statsStart, config)
    });

    runLogger.info("github.rate_limit", {
      remaining: rateLimit.remaining ?? null,
      limit: rateLimit.limit ?? null,
      reset: rateLimit.reset ?? null,
      resetAt: rateLimit.reset
        ? formatTimestamp(
            new Date(rateLimit.reset * 1000),
            config.logging.timeZone
          )
        : null,
      resetInSeconds: rateLimit.reset
        ? Math.max(0, Math.floor(rateLimit.reset - Date.now() / 1000))
        : null
    });

    const isEmpty =
      statsPayload.totals.commits === 0 &&
      statsPayload.totals.prsAuthored === 0 &&
      statsPayload.totals.prsMerged === 0 &&
      statsPayload.totals.issuesClosed === 0;

    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return;
    }

    const artifacts: {
      id: string;
      format: string;
      stored: { key: string; uri: string; size: number };
    }[] = [];
    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      const templateKey = `${reportBaseKey}/stats.json`;
      const artifact = await storage.put(
        templateKey,
        JSON.stringify(statsPayload, null, 2),
        "application/json"
      );
      artifacts.push({
        id: "stats",
        format: "json",
        stored: artifact
      });
    }

    const manifest = buildManifest(
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      config.logging.timeZone,
      reposForReport,
      artifacts,
      isEmpty,
      job
    );
    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);
    runLogger.info("manifest.write", { key: manifestKey });

    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.update", { key: monthKey });

    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.latest", { key: latestKey });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runLogger.error("run.failed", { error: errorMessage });
    const failedManifest = buildFailedManifest({
      owner,
      ownerType,
      window: { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      timezone: config.logging.timeZone,
      job,
      error: errorMessage
    });
    await writeManifest(storage, manifestKey, failedManifest);
    await writeSummary(storage, summaryKey, failedManifest, manifestKey);
    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
  }
}

async function runAggregateWindow(
  window: { start: string; end: string },
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  runLogger: ReturnType<typeof logger.withContext>,
  storage: ReturnType<typeof createStorageClient>
) {
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);
  const owner = job.scope?.owner ?? config.github.owner;
  const ownerType = job.scope?.ownerType ?? config.github.ownerType;
  const windowHours = job.windowHours;
  const windowDays = resolveWindowDays(job);
  const windowKey = buildWindowKey(
    windowStart,
    windowEnd,
    config.logging.timeZone,
    Boolean(job.windowHours)
  );
  const reportBaseKey = buildReportBaseKey(
    config,
    job,
    ownerType,
    owner,
    windowKey
  );
  const indexBaseKey = buildIndexBaseKey(config, job, ownerType, owner);
  const manifestKey = `${reportBaseKey}/manifest.json`;
  const summaryKey = `${reportBaseKey}/summary.json`;

  const sourceTemplateId = job.aggregation?.sourceTemplateId;
  if (!sourceTemplateId) {
    runLogger.warn("aggregate.skipped", { reason: "missing_source_template" });
    return;
  }

  const sourceJobId = job.aggregation?.sourceJobId ?? job.id;
  const sourcePrefix = job.aggregation?.sourceOutputPrefix ?? config.output.prefix;
  const sourceIndexBase = `${sourcePrefix}/_index/${ownerType}/${owner}/${sourceJobId}`;

  try {
    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return;
      }
    }

    const items = await loadIndexItemsForRange(
      storage,
      sourceIndexBase,
      window,
      config.logging.timeZone
    );
    const aggregateItems = await loadAggregateItems(
      storage,
      items,
      sourceTemplateId,
      config.logging.timeZone
    );
    const isEmpty = aggregateItems.length === 0;

    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return;
    }

    const templates = job.templates.length > 0 ? job.templates : ["default"];
    const artifacts: {
      id: string;
      format: string;
      stored: { key: string; uri: string; size: number };
    }[] = [];

    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      for (const templateId of templates) {
        const template =
          templateId === "default" ? null : getTemplateById(templateId);
        if (templateId !== "default" && !template) {
          runLogger.warn("report.template.missing", { templateId });
          continue;
        }

        const outputFormat =
          template?.outputFormat ?? job.outputFormat ?? config.output.format;
        const promptBase =
          job.aggregation?.promptTemplate ??
          config.llm.promptTemplate ??
          aggregatePrompt;
        const templatePrompt = template
          ? [promptBase, template.instructions].join("\n\n")
          : promptBase;
        const extension = outputFormat === "json" ? "json" : "md";
        const templateKey = `${reportBaseKey}/${template?.id ?? "default"}.${extension}`;
        const contentType =
          outputFormat === "json"
            ? "application/json"
            : "text/markdown; charset=utf-8";

        let reportText = "";
        if (isEmpty && job.onEmpty !== "manifest-only") {
          reportText = buildEmptyReport(outputFormat, template?.id ?? "default");
        } else if (!isEmpty) {
          const generateStart = Date.now();
          runLogger.info("report.generate.start", {
            model: config.llm.model,
            format: outputFormat,
            template: template?.id ?? "default"
          });
          const input: AggregateInput = {
            owner,
            ownerType,
            window,
            job: { id: job.id, name: job.name },
            source: { jobId: sourceJobId, templateId: sourceTemplateId },
            items: aggregateItems
          };
          const report = await withRetry(
            () =>
              generateAggregateReport(input, {
                apiKey: config.llm.apiKey,
                model: config.llm.model,
                promptTemplate: templatePrompt,
                outputFormat,
                outputSchemaJson: config.output.schemaJson,
                validateSchema: config.output.validateSchema,
                maxTokensHint: job.maxTokensHint
              }),
            {
              retries: config.network.retryCount,
              backoffMs: config.network.retryBackoffMs
            }
          );
          reportText = report.text;
          runLogger.info("report.generate.done", {
            format: report.format,
            length: report.text.length,
            template: template?.id ?? "default",
            ...withDuration(generateStart, config)
          });
        }

        const writeStart = Date.now();
        runLogger.info("artifact.write.start", {
          storageType: config.storage.type,
          key: templateKey,
          template: template?.id ?? "default"
        });
        const artifact = await storage.put(templateKey, reportText, contentType);
        runLogger.info("artifact.write.done", {
          key: artifact.key,
          uri: artifact.uri,
          size: artifact.size,
          template: template?.id ?? "default",
          ...withDuration(writeStart, config)
        });
        artifacts.push({
          id: template?.id ?? "default",
          format: outputFormat,
          stored: artifact
        });
      }
    }

    if (artifacts.length === 0 && !(isEmpty && job.onEmpty === "manifest-only")) {
      runLogger.warn("manifest.skipped", { window: windowKey });
      return;
    }

    const manifest = buildManifest(
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      config.logging.timeZone,
      [],
      artifacts,
      isEmpty,
      job
    );
    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);
    runLogger.info("manifest.write", { key: manifestKey });

    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.update", { key: monthKey });

    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    runLogger.info("index.latest", { key: latestKey });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    runLogger.error("run.failed", { error: errorMessage });
    const failedManifest = buildFailedManifest({
      owner,
      ownerType,
      window: { start: window.start, end: window.end, days: windowDays, hours: windowHours },
      timezone: config.logging.timeZone,
      job,
      error: errorMessage
    });
    await writeManifest(storage, manifestKey, failedManifest);
    await writeSummary(storage, summaryKey, failedManifest, manifestKey);
    const periodKey = formatMonthKey(windowStart, config.logging.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    await updateIndex(
      storage,
      monthKey,
      owner,
      ownerType,
      periodKey,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
    const latestKey = `${indexBaseKey}/latest.json`;
    await writeLatest(
      storage,
      latestKey,
      owner,
      ownerType,
      { start: window.start, end: window.end, days: windowDays, hours: windowHours, manifestKey },
      job
    );
  }
}

function buildWindowKey(
  start: Date,
  end: Date,
  timeZone?: string,
  includeTime?: boolean
) {
  const format = includeTime ? formatDateTimeKey : formatDateOnly;
  return `${format(start, timeZone)}__${format(end, timeZone)}`;
}

function formatDateOnly(value: Date, timeZone?: string) {
  if (!timeZone) return value.toISOString().slice(0, 10);
  const parts = formatDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateTimeKey(value: Date, timeZone?: string) {
  if (!timeZone) {
    const iso = value.toISOString();
    const date = iso.slice(0, 10);
    const time = iso.slice(11, 16).replace(":", "-");
    return `${date}T${time}`;
  }
  const parts = formatDateTimeParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}`;
}

function formatMonthKey(value: Date, timeZone?: string) {
  if (!timeZone) return value.toISOString().slice(0, 7);
  const parts = formatDateParts(value, timeZone);
  return `${parts.year}-${parts.month}`;
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

function formatDateTimeParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(value);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
  };
  return map;
}

function buildReportBaseKey(
  config: ReturnType<typeof loadConfig>,
  job: JobConfig,
  ownerType: "user" | "org",
  owner: string,
  windowKey: string
) {
  const prefix = job.outputPrefix ?? config.output.prefix;
  return `${prefix}/${ownerType}/${owner}/jobs/${job.id}/${windowKey}`;
}

function buildIndexBaseKey(
  config: ReturnType<typeof loadConfig>,
  job: JobConfig,
  ownerType: "user" | "org",
  owner: string
) {
  const prefix = job.outputPrefix ?? config.output.prefix;
  return `${prefix}/_index/${ownerType}/${owner}/${job.id}`;
}

function buildJobsRegistryKey(
  config: ReturnType<typeof loadConfig>,
  ownerType: "user" | "org",
  owner: string
) {
  return `${config.output.prefix}/_index/${ownerType}/${owner}/jobs.json`;
}

async function loadIndexItemsForRange(
  storage: ReturnType<typeof createStorageClient>,
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
  items.sort((a, b) => a.start.localeCompare(b.start));
  return items;
}

async function loadAggregateItems(
  storage: ReturnType<typeof createStorageClient>,
  items: IndexItem[],
  templateId: string,
  timeZone?: string
) {
  const results: AggregateInput["items"] = [];
  for (const item of items) {
    const manifestText = await storage.get(item.manifestKey);
    if (!manifestText) continue;
    const manifest = JSON.parse(manifestText) as ReportManifest;
    if (manifest.status === "failed") continue;
    const template = manifest.templates.find((entry) => entry.id === templateId);
    if (!template) continue;
    const content = await storage.get(template.key);
    if (!content) continue;
    results.push({
      date: formatDateOnly(new Date(item.start), timeZone),
      manifestKey: item.manifestKey,
      content
    });
  }
  return results;
}

function overlapsWindow(item: IndexItem, window: { start: string; end: string }) {
  const start = new Date(item.start).getTime();
  const end = new Date(item.end).getTime();
  const windowStart = new Date(window.start).getTime();
  const windowEnd = new Date(window.end).getTime();
  return start < windowEnd && end > windowStart;
}

function listMonthKeys(startIso: string, endIso: string, timeZone?: string) {
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

function applyAuthorFilters(repos: RepoActivity[], job: JobConfig) {
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

function applyContextAuthorFilters(repos: RepoActivity[], job: JobConfig) {
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

function applyRedactions(repos: RepoActivity[], redactPaths?: string[]) {
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

function matchesAny(path: string, patterns: string[]) {
  return patterns.some((pattern) => path.includes(pattern));
}

function normalizeAuthors(
  authors: string[] | undefined,
  aliases?: Record<string, string>
) {
  const set = new Set<string>();
  for (const author of authors ?? []) {
    set.add(normalizeAuthor(author, aliases));
  }
  return set;
}

function normalizeAuthor(
  author: string | null | undefined,
  aliases?: Record<string, string>
) {
  if (!author) return "";
  const trimmed = author.trim();
  const mapped = aliases?.[trimmed] ?? trimmed;
  return mapped.toLowerCase();
}

function resolveWindowDays(job: JobConfig) {
  if (job.windowHours) {
    return job.windowHours / 24;
  }
  return job.windowDays ?? 1;
}

function buildWindows(job: JobConfig, now: Date) {
  const windowHours = job.windowHours;
  const windowDays = job.windowDays ?? 1;
  const windowMs = windowHours
    ? windowHours * 60 * 60 * 1000
    : windowDays * 24 * 60 * 60 * 1000;

  if (!job.backfillWindows && !job.backfillStart && !job.backfillEnd) {
    const start = new Date(now.getTime() - windowMs);
    return [
      {
        start: start.toISOString(),
        end: now.toISOString()
      }
    ];
  }

  if (windowHours) {
    const windows = [];
    const count = job.backfillWindows && job.backfillWindows > 0 ? job.backfillWindows : 1;
    let cursor = new Date(now.getTime() - windowMs * (count - 1));
    for (let i = 0; i < count; i += 1) {
      const next = new Date(cursor.getTime() + windowMs);
      windows.push({ start: cursor.toISOString(), end: next.toISOString() });
      cursor = next;
    }
    return windows;
  }

  const endDate = job.backfillEnd
    ? parseDateOnly(job.backfillEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDate = job.backfillStart
    ? parseDateOnly(job.backfillStart)
    : new Date(endDate.getTime());

  if (job.backfillWindows && job.backfillWindows > 0) {
    startDate.setUTCDate(endDate.getUTCDate() - (job.backfillWindows - 1) * windowDays);
  }

  const windows = [];
  let cursor = new Date(startDate.getTime());
  while (cursor <= endDate) {
    const next = new Date(cursor.getTime());
    next.setUTCDate(next.getUTCDate() + windowDays);
    windows.push({
      start: cursor.toISOString(),
      end: next.toISOString()
    });
    cursor = next;
  }
  return windows;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

function applyCommitBudget(
  repos: ReportInput["repos"],
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

function buildContextSnapshot(repos: ReportInput["repos"], maxBytes: number) {
  const snapshot = repos.map((repo) => ({
    name: repo.repo.name,
    context: repo.context ?? null
  }));
  const size = byteLength(snapshot);
  if (size <= maxBytes) {
    return {
      contextBytes: size,
      truncated: false,
      context: snapshot
    };
  }

  const preview = buildContextPreview(repos, 500, 3, 5);
  const previewSize = byteLength(preview);
  if (previewSize <= maxBytes) {
    return {
      contextBytes: size,
      truncated: true,
      contextBytesPreview: previewSize,
      context: preview
    };
  }

  const tinyPreview = buildContextPreview(repos, 200, 1, 3);
  return {
    contextBytes: size,
    truncated: true,
    contextBytesPreview: byteLength(tinyPreview),
    context: tinyPreview
  };
}

function buildContextPreview(
  repos: ReportInput["repos"],
  maxTextBytes: number,
  maxCommits: number,
  maxFiles: number
) {
  return repos.map((repo) => ({
    name: repo.repo.name,
    context: repo.context
      ? {
          overview: repo.context.overview
            ? {
                description: repo.context.overview.description ?? null,
                topics: repo.context.overview.topics ?? [],
                readme: truncateTextBytes(
                  repo.context.overview.readme,
                  maxTextBytes
                ),
                llmTxt: truncateTextBytes(
                  repo.context.overview.llmTxt,
                  maxTextBytes
                )
              }
            : null,
          diffSummary: repo.context.diffSummary
            ? repo.context.diffSummary.slice(0, maxCommits).map((commit) => ({
                sha: commit.sha,
                totalAdditions: commit.totalAdditions,
                totalDeletions: commit.totalDeletions,
                files: commit.files.slice(0, maxFiles)
              }))
            : null
        }
      : null
  }));
}

function truncateTextBytes(value: string | undefined, maxBytes: number) {
  if (!value) return undefined;
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf8")}...[truncated]`;
}

function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function summarizeActivity(repos: ReportInput["repos"]) {
  return repos.reduce(
    (acc, repo) => ({
      commits: acc.commits + repo.commits.length,
      prs: acc.prs + (repo.context?.pullRequests?.length ?? 0),
      issues: acc.issues + (repo.context?.issues?.length ?? 0)
    }),
    { commits: 0, prs: 0, issues: 0 }
  );
}

function buildEmptyReport(format: "markdown" | "json", templateId: string) {
  if (format === "json") {
    return JSON.stringify({ empty: true, template: templateId }, null, 2);
  }
  return `# No activity\n\nNo activity recorded for this window.`;
}

function buildContextFileStats(repos: ReportInput["repos"]) {
  const perRepo = repos.map((repo) => {
    const files: { path: string; lines: number }[] = [];
    const overview = repo.context?.overview;
    if (overview?.readme) {
      files.push({ path: "README.md", lines: countLines(overview.readme) });
    }
    if (overview?.llmTxt) {
      files.push({ path: "llm.txt", lines: countLines(overview.llmTxt) });
    }
    if (repo.context?.diffSnippets) {
      for (const commit of repo.context.diffSnippets) {
        for (const file of commit.files) {
          files.push({ path: file.path, lines: countLines(file.patch) });
        }
      }
    }
    return {
      name: repo.repo.name,
      files
    };
  });

  const totals = perRepo.reduce(
    (acc, repo) => {
      for (const file of repo.files) {
        acc.files += 1;
        acc.lines += file.lines;
      }
      return acc;
    },
    { files: 0, lines: 0 }
  );

  return {
    repoCount: repos.length,
    totals,
    repos: perRepo
  };
}

function countLines(text: string) {
  if (!text) return 0;
  return text.split("\n").length;
}

function withDuration(startMs: number, config: ReturnType<typeof loadConfig>) {
  if (!config.logging.includeTimings) return {};
  return { durationMs: Date.now() - startMs };
}

main().catch((error) => {
  logger.error("run.error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
