import { loadConfig } from "./config.js";
import { loadJobs, type JobConfig } from "./jobs.js";
import { createStorageClient, describeStorage, validateStorage } from "./storage.js";
import { logger, setLoggerConfig } from "./logger.js";
import { runHealthCheck } from "./health.js";
import { writeJobsRegistry } from "./manifest.js";
import { getScheduleDecision } from "./scheduler.js";
import { buildJobsRegistryKey } from "./utils.js";

// Processors
import { runPipelineWindow } from "./processors/pipeline.js";
import { runAggregateWindow } from "./processors/aggregate.js";
import { runStatsWindow } from "./processors/stats.js";
import { listSlots } from "./slots.js";

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const jobFlagIndex = argv.indexOf("--job");
  const jobIdFromFlag = jobFlagIndex >= 0 ? argv[jobFlagIndex + 1] : undefined;
  const jobCmdIndex = argv.indexOf("job");
  const jobIdFromCmd = jobCmdIndex >= 0 ? argv[jobCmdIndex + 1] : undefined;
  return {
    jobId: jobIdFromFlag ?? jobIdFromCmd,
    runScheduledOnly: args.has("--scheduled-only")
  };
}

async function main() {
  const config = loadConfig();
  setLoggerConfig({
    level: config.logging.level,
    includeTimings: config.logging.includeTimings,
    format: config.logging.format,
    color: config.logging.color,
    timeZone: config.timeZone
  });

  const args = parseArgs(process.argv.slice(2));

  if (process.argv.includes("health")) {
    await runHealthCheck(config);
    return;
  }

  const baseLogger = logger.withContext({
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });

  const storage = createStorageClient(config.storage);
  baseLogger.info("storage.validate.start", describeStorage(config.storage));
  await validateStorage(config.storage);
  baseLogger.info("storage.validate.done", describeStorage(config.storage));

  const jobs = await loadJobs("jobs.config.ts", {
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  const selectedJobs = args.jobId
    ? jobs.filter((job) => job.id === args.jobId)
    : jobs;
  if (args.jobId && selectedJobs.length === 0) {
    throw new Error(`Job not found: ${args.jobId}`);
  }
  baseLogger.info("run.start", { jobs: selectedJobs.map((job) => job.id) });

  for (const job of selectedJobs) {
    await runJob(job, config, storage, {
      runScheduledOnly: args.runScheduledOnly
    });
  }

  baseLogger.info("run.complete", { jobs: selectedJobs.map((job) => job.id) });
}

async function runJob(
  job: JobConfig,
  config: ReturnType<typeof loadConfig>,
  storage: ReturnType<typeof createStorageClient>,
  schedulerConfig: { runScheduledOnly: boolean }
) {
  const jobOwner = job.scope.owner;
  const jobOwnerType = job.scope.ownerType;
  
  const jobLogger = logger.withContext({
    owner: jobOwner,
    ownerType: jobOwnerType,
    jobId: job.id,
    jobName: job.name
  });

  const now = new Date();
  
  // 1. Scheduling Decision
  if (schedulerConfig.runScheduledOnly && job.schedule) {
    const decision = await getScheduleDecision({
      job,
      now,
      timeZone: config.timeZone,
      storage,
      owner: jobOwner,
      ownerType: jobOwnerType,
      prefix: config.output.prefix
    });

    if (!decision.due) {
      jobLogger.info("job.skipped", { reason: "not_due" });
      return;
    }
  }

  // 2. Initial Job Registration
  const jobsKey = buildJobsRegistryKey(config.output.prefix, jobOwnerType, jobOwner);
  await writeJobsRegistry(storage, jobsKey, jobOwner, jobOwnerType, job);

  // 3. Resolve Slots
  const slots = listSlots({
    now,
    schedule: job.schedule,
    timeZone: config.timeZone ?? "UTC",
    backfillSlots: job.backfillSlots
  });

  jobLogger.info("job.start", { mode: job.mode, slots: slots.length });

  // 4. Process Windows
  for (const slot of slots) {
    try {
      if (job.mode === "pipeline") {
        await runPipelineWindow(slot, job, config, jobLogger, storage);
      } else if (job.mode === "aggregate") {
        await runAggregateWindow(slot, job, config, jobLogger, storage);
      } else if (job.mode === "stats") {
        await runStatsWindow(slot, job, config, jobLogger, storage);
      }
    } catch (err) {
      jobLogger.error("job.window.failed", { slotKey: slot.slotKey, error: String(err) });
    }
  }

  jobLogger.info("job.complete", { jobId: job.id });
}

main().catch((error) => {
  logger.error("run.error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
