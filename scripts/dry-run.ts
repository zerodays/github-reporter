import { loadConfig } from "../src/config.js";
import { loadJobs } from "../src/jobs.js";
import { fetchActivity } from "../src/github.js";
import { enrichReposWithContext } from "../src/context/index.js";
import { generateReport, basePrompt } from "../src/generator.js";
import { computeReportMetrics } from "../src/metrics.js";
import {
  applyAuthorFilters,
  applyCommitBudget,
  applyContextAuthorFilters,
  applyRedactions,
  buildEmptyReport,
  summarizeActivity,
} from "../src/utils.js";
import { listSlots, SlotSchedule } from "../src/slots.js";
import { runPipelineWindow } from "../src/processors/pipeline.js";
import { logger, setLoggerConfig } from "../src/logger.js";
import type { StorageClient } from "../src/storage.js";
import type { JobConfig } from "../src/jobs.js";
import type { ReportInput } from "../src/types.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const jobFlagIndex = argv.indexOf("--job");
  const jobIdFromFlag = jobFlagIndex >= 0 ? argv[jobFlagIndex + 1] : undefined;
  const jobCmdIndex = argv.indexOf("job");
  const jobIdFromCmd = jobCmdIndex >= 0 ? argv[jobCmdIndex + 1] : undefined;
  return {
    jobId: jobIdFromFlag ?? jobIdFromCmd,
    verbose: args.has("--verbose"),
    showMetrics: !args.has("--no-metrics"),
    usePipeline: !args.has("--no-pipeline-logs"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const jobs = await loadJobs("jobs.config.ts", {
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  const job = selectJob(jobs, args.jobId);

  if (job.mode !== "pipeline") {
    throw new Error(`Dry run only supports pipeline jobs. Got: ${job.mode}`);
  }

  const timeZone = config.timeZone ?? "UTC";
  const window = resolveWindow(job, timeZone);
  if (args.usePipeline) {
    await runWithPipelineLogs(job, config, window, timeZone, args.showMetrics);
    return;
  }
  logStep(
    "dry-run.start",
    {
      jobId: job.id,
      mode: job.mode,
      dataProfile: job.dataProfile ?? "standard",
      metricsOnly: job.metricsOnly ?? false,
      window,
      timeZone,
    },
    args.verbose
  );

  const allowlist = job.scope.allowlist ?? [];
  const blocklist = job.scope.blocklist ?? [];
  const includePrivate =
    job.scope.includePrivate ?? config.github.includePrivate;
  const dataProfile = job.dataProfile ?? "standard";

  const { repos, meta } = await fetchActivity(
    {
      token: config.github.token,
      owner: job.scope.owner,
      ownerType: job.scope.ownerType,
      allowlist,
      blocklist,
      includePrivate,
      perPage: config.github.perPage,
      maxPages: config.github.maxPages,
    },
    window,
    dataProfile,
    {
      maxActiveRepos: job.maxRepos,
      preferActive: Boolean(job.maxRepos),
    }
  );
  logStep(
    "github.fetch.done",
    {
      totalRepos: meta.totalRepos,
      filteredRepos: meta.filteredRepos,
      scannedRepos: meta.scannedRepos,
      stoppedEarly: meta.stoppedEarly,
    },
    args.verbose
  );

  const repoLimit = dataProfile === "minimal" ? job.maxRepos : undefined;
  const cappedRepos = repoLimit ? repos.slice(0, repoLimit) : repos;
  const normalizedRepos = cappedRepos.map((repo) => ({
    ...repo,
    commits: job.maxCommitsPerRepo
      ? repo.commits.slice(0, job.maxCommitsPerRepo)
      : repo.commits,
  }));
  const trimmedByBudget = applyCommitBudget(
    normalizedRepos,
    job.maxTotalCommits
  );
  const authorFiltered = applyAuthorFilters(trimmedByBudget, job);

  const inactiveRepoCount = authorFiltered.filter(
    (repo) => repo.commits.length === 0
  ).length;
  const activeRepos = authorFiltered.filter((repo) => repo.commits.length > 0);
  const reposForReport = job.includeInactiveRepos
    ? authorFiltered
    : activeRepos;
  logStep(
    "repos.filtered",
    {
      totalRepos: authorFiltered.length,
      activeRepos: activeRepos.length,
      inactiveRepos: inactiveRepoCount,
    },
    args.verbose
  );

  const metricsOnly = job.metricsOnly === true;
  const providerAllowlist = metricsOnly
    ? ["diff-summary", "pull-requests", "issues"]
    : job.contextProviders;

  const providerResults = await enrichReposWithContext({
    repos: reposForReport,
    window,
    config,
    rateLimit: {},
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    providerAllowlist,
    dataProfile: job.dataProfile,
  });
  logStep("context.providers", { results: providerResults }, args.verbose);

  const afterContext = applyContextAuthorFilters(reposForReport, job);
  const redacted = applyRedactions(afterContext, job.redactPaths);

  const metricsConfig = job.metrics ?? {};
  const metrics = computeReportMetrics(redacted, window, {
    topContributors: metricsConfig.topContributors ?? 10,
    topRepos: metricsConfig.topRepos ?? 10,
    authorAliases: job.scope.authorAliases,
  });
  logStep("metrics.totals", metrics.totals, true);

  const activityStats = summarizeActivity(redacted);
  const isEmpty =
    activityStats.commits === 0 &&
    activityStats.prs === 0 &&
    activityStats.issues === 0;

  if (job.metricsOnly === true) {
    if (args.showMetrics) {
      console.log(JSON.stringify(metrics, null, 2));
    }
    return;
  }

  if (isEmpty && job.onEmpty === "manifest-only") {
    console.error(
      "No activity for this window; onEmpty=manifest-only, no report."
    );
    console.log(buildEmptyReport(job.outputFormat ?? "markdown", job.id));
    return;
  }

  const outputFormat = job.outputFormat ?? config.output.format;
  let reportText = "";

  if (isEmpty) {
    reportText = buildEmptyReport(outputFormat, job.id);
  } else {
    let promptTemplate = job.prompt ?? basePrompt;
    if (job.promptFile) {
      try {
        const absolutePath = path.resolve(process.cwd(), job.promptFile);
        promptTemplate = await fs.readFile(absolutePath, "utf-8");
      } catch (error) {
        console.error(`Failed to load prompt file: ${job.promptFile}`);
      }
    }

    const input: ReportInput = {
      owner: job.scope.owner,
      ownerType: job.scope.ownerType,
      window,
      timeZone,
      metrics,
      repos: redacted,
      inactiveRepoCount: job.includeInactiveRepos
        ? undefined
        : inactiveRepoCount,
    };

    const report = await generateReport(input, {
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      promptTemplate,
      outputFormat,
      outputSchemaJson: config.output.schemaJson,
      maxTokensHint: job.maxTokensHint,
    });
    reportText = report.text;
  }

  console.log(reportText);
}

function selectJob(jobs: JobConfig[], jobId?: string) {
  if (jobId) {
    const selected = jobs.find((job) => job.id === jobId);
    if (!selected) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return selected;
  }
  const pipeline = jobs.find((job) => job.mode === "pipeline");
  if (!pipeline) {
    throw new Error("No pipeline job found. Use --job to select one.");
  }
  return pipeline;
}

function resolveWindow(job: JobConfig, timeZone: string) {
  const schedule =
    job.schedule?.type === "daily"
      ? job.schedule
      : { type: "daily", hour: 0, minute: 0 };
  const slots = listSlots({
    now: new Date(),
    schedule: schedule as SlotSchedule,
    timeZone,
    backfillSlots: 1,
  });
  return slots[0].window;
}

async function runWithPipelineLogs(
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  window: { start: string; end: string },
  timeZone: string,
  showMetrics: boolean
) {
  setLoggerConfig({
    level: config.logging.level,
    includeTimings: config.logging.includeTimings,
    format: config.logging.format,
    color: config.logging.color,
    timeZone,
  });

  const storage = createMemoryStorage();
  const slot = {
    slotKey: "dry-run",
    slotType: (job.schedule?.type ?? "daily") as
      | "hourly"
      | "daily"
      | "weekly"
      | "monthly"
      | "yearly",
    scheduledAt: window.end,
    window,
  };
  const dryJob: JobConfig = {
    ...job,
    webhook: { enabled: false },
  };

  const jobLogger = logger.withContext({
    owner: job.scope.owner,
    ownerType: job.scope.ownerType,
    jobId: job.id,
    jobName: job.name,
  });

  await runPipelineWindow(slot, dryJob, config, jobLogger, storage, { notify: false });

  const outputKey = await findStoredKey(storage, /output\.(md|json)$/);
  const manifestKey = await findStoredKey(storage, /manifest\.json$/);
  if (showMetrics && manifestKey) {
    const manifestText = await storage.get(manifestKey);
    if (manifestText) {
      const manifest = JSON.parse(manifestText) as { metrics?: unknown };
      console.log(JSON.stringify(manifest.metrics ?? {}, null, 2));
    }
  }
  if (outputKey) {
    const output = await storage.get(outputKey);
    if (output) {
      console.log(output);
      return;
    }
  }
  console.error("No output produced for this window.");
}

function createMemoryStorage(): StorageClient {
  const store = new Map<string, string>();
  return {
    async put(key, body) {
      store.set(key, body);
      return {
        key,
        uri: `dryrun://${key}`,
        size: Buffer.byteLength(body, "utf8"),
      };
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async exists(key) {
      return store.has(key);
    },
    async list(prefix) {
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

async function findStoredKey(storage: StorageClient, pattern: RegExp) {
  const keys = await storage.list("");
  return keys.find((key) => pattern.test(key));
}

function logStep(
  label: string,
  data: Record<string, unknown>,
  enabled: boolean
) {
  if (!enabled) return;
  console.log(`[${label}] ${JSON.stringify(data)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
