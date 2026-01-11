import { loadConfig } from "./config.js";
import { fetchActivity } from "./github.js";
import { basePrompt, generateReport } from "./generator.js";
import { artifactExists, writeArtifact } from "./storage.js";
import { sendWebhook } from "./webhook.js";
import type { ReportInput, WebhookPayload } from "./types.js";
import { formatTimestamp, logger, setLoggerConfig } from "./logger.js";
import { withRetry } from "./retry.js";
import { enrichReposWithContext } from "./context/index.js";
import { getTemplateById } from "./templates.js";

async function main() {
  const config = loadConfig();
  setLoggerConfig({
    level: config.logging.level,
    includeTimings: config.logging.includeTimings,
    format: config.logging.format,
    color: config.logging.color,
    timeZone: config.logging.timeZone
  });
  const runLogger = logger.withContext({
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  runLogger.info("run.start");
  const now = new Date();
  const windows = buildWindows(config, now);
  if (windows.length > 1) {
    runLogger.info("backfill.start", {
      days: windows.length,
      start: formatTimestamp(new Date(windows[0].start), config.logging.timeZone),
      end: formatTimestamp(
        new Date(windows[windows.length - 1].end),
        config.logging.timeZone
      )
    });
  }

  for (const window of windows) {
    await runForWindow(window, config, runLogger);
  }
}

function buildArtifactKey(
  date: Date,
  extension: string,
  idempotentKey?: string,
  templateId?: string
) {
  if (!idempotentKey) {
    const suffix = templateId ? `.${templateId}` : "";
    return `${slugDate(date)}${suffix}.${extension}`;
  }
  if (idempotentKey === "daily") {
    const daily = date.toISOString().slice(0, 10);
    const suffix = templateId ? `.${templateId}` : "";
    return `${daily}${suffix}.${extension}`;
  }
  const suffix = templateId ? `.${templateId}` : "";
  return `${idempotentKey}${suffix}.${extension}`;
}

function slugDate(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function runForWindow(
  window: { start: string; end: string },
  config: ReturnType<typeof loadConfig>,
  runLogger: ReturnType<typeof logger.withContext>
) {
  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);

  const fetchStart = Date.now();
  runLogger.info("github.fetch.start", {
    allowlistCount: config.github.allowlist.length,
    blocklistCount: config.github.blocklist.length,
    includePrivate: config.github.includePrivate,
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
          owner: config.github.owner,
          ownerType: config.github.ownerType,
          allowlist: config.github.allowlist,
          blocklist: config.github.blocklist,
          includePrivate: config.github.includePrivate,
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

  const cappedRepos = config.report.maxRepos
    ? repos.slice(0, config.report.maxRepos)
    : repos;
  const normalizedRepos = cappedRepos.map((repo) => ({
    ...repo,
    commits: config.report.maxCommitsPerRepo
      ? repo.commits.slice(0, config.report.maxCommitsPerRepo)
      : repo.commits
  }));
  const trimmedByBudget = applyCommitBudget(
    normalizedRepos,
    config.report.maxTotalCommits
  );

  const inactiveRepoCount = trimmedByBudget.filter(
    (repo) => repo.commits.length === 0
  ).length;
  const activeRepos = trimmedByBudget.filter((repo) => repo.commits.length > 0);
  const reposForReport = config.report.includeInactiveRepos
    ? trimmedByBudget
    : activeRepos;

  runLogger.info("github.fetch.done", {
    repoCount: trimmedByBudget.length,
    activeRepoCount: activeRepos.length,
    inactiveRepoCount,
    maxCommitsPerRepo: config.report.maxCommitsPerRepo ?? null,
    maxRepos: config.report.maxRepos ?? null,
    maxTotalCommits: config.report.maxTotalCommits ?? null,
    ...withDuration(fetchStart, config)
  });

  const providerResults = await enrichReposWithContext({
    repos: reposForReport,
    window,
    config,
    rateLimit,
    logger: runLogger
  });
  runLogger.info("context.providers", { results: providerResults });
  runLogger.info("context.snapshot", {
    repoCount: reposForReport.length,
    ...buildContextSnapshot(reposForReport, config.logging.contextMaxBytes)
  });
  runLogger.info("context.files_read", buildContextFileStats(reposForReport));

  runLogger.info("github.rate_limit", {
    remaining: rateLimit.remaining ?? null,
    limit: rateLimit.limit ?? null,
    reset: rateLimit.reset ?? null,
    resetAt: rateLimit.reset
      ? formatTimestamp(new Date(rateLimit.reset * 1000), config.logging.timeZone)
      : null,
    resetInSeconds: rateLimit.reset
      ? Math.max(0, Math.floor(rateLimit.reset - Date.now() / 1000))
      : null
  });

  const input: ReportInput = {
    owner: config.github.owner,
    ownerType: config.github.ownerType,
    window,
    repos: reposForReport,
    inactiveRepoCount: config.report.includeInactiveRepos
      ? undefined
      : inactiveRepoCount
  };

  const storageConfig = {
    type: config.storage.type,
    uri: config.storage.uri,
    region: config.storage.region,
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
    prefix: config.output.prefix
  };

  const templates =
    config.report.templates.length > 0 ? config.report.templates : ["default"];

  for (const templateId of templates) {
    const template =
      templateId === "default" ? null : getTemplateById(templateId);
    if (templateId !== "default" && !template) {
      runLogger.warn("report.template.missing", { templateId });
      continue;
    }

    const outputFormat = template?.outputFormat ?? config.output.format;
    const templatePrompt = template
      ? [config.llm.promptTemplate ?? basePrompt, template.instructions].join(
          "\n\n"
        )
      : config.llm.promptTemplate ?? basePrompt;
    const extension = outputFormat === "json" ? "json" : "md";
    const key = buildArtifactKey(
      windowStart,
      extension,
      config.report.idempotentKey,
      template?.id ?? "default"
    );

    const exists = await artifactExists(storageConfig, key);
    if (config.report.idempotentKey && exists) {
      runLogger.info("run.skipped", {
        key,
        template: template?.id ?? "default"
      });
      continue;
    }

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
          maxTokensHint: config.report.maxTokensHint
        }),
      {
        retries: config.network.retryCount,
        backoffMs: config.network.retryBackoffMs
      }
    );
    runLogger.info("report.generate.done", {
      format: report.format,
      length: report.text.length,
      template: template?.id ?? "default",
      ...withDuration(generateStart, config)
    });

    const writeStart = Date.now();
    runLogger.info("artifact.write.start", {
      storageType: config.storage.type,
      key,
      template: template?.id ?? "default"
    });
    const artifact = await writeArtifact(storageConfig, key, report.text);
    runLogger.info("artifact.write.done", {
      key: artifact.key,
      uri: artifact.uri,
      size: artifact.size,
      template: template?.id ?? "default",
      ...withDuration(writeStart, config)
    });

    const payload: WebhookPayload = {
      owner: config.github.owner,
      ownerType: config.github.ownerType,
      window,
      artifact,
      format: report.format,
      createdAt: new Date().toISOString()
    };

    const webhookStart = Date.now();
    runLogger.info("webhook.send.start", {
      enabled: Boolean(config.webhook.url),
      template: template?.id ?? "default"
    });
    await withRetry(
      () => sendWebhook(config.webhook, payload),
      {
        retries: config.network.retryCount,
        backoffMs: config.network.retryBackoffMs
      }
    );
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

function buildWindows(
  config: ReturnType<typeof loadConfig>,
  now: Date
) {
  if (
    !config.report.backfillDays &&
    !config.report.backfillStart &&
    !config.report.backfillEnd
  ) {
    const windowDays = config.report.windowDays ?? 1;
    const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    return [
      {
        start: start.toISOString(),
        end: now.toISOString()
      }
    ];
  }

  const endDate = config.report.backfillEnd
    ? parseDateOnly(config.report.backfillEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDate = config.report.backfillStart
    ? parseDateOnly(config.report.backfillStart)
    : new Date(endDate.getTime());

  if (config.report.backfillDays && config.report.backfillDays > 0) {
    startDate.setUTCDate(endDate.getUTCDate() - (config.report.backfillDays - 1));
  }

  const windows = [];
  let cursor = new Date(startDate.getTime());
  const windowDays = config.report.windowDays ?? 1;
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

function buildContextSnapshot(
  repos: ReportInput["repos"],
  maxBytes: number
) {
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
