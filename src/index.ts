import { loadConfig } from "./config.js";
import { loadJobs } from "./jobs.js";
import { createStorageClient, describeStorage, validateStorage } from "./storage.js";
import { logger, setLoggerConfig } from "./logger.js";
import { runHealthCheck } from "./health.js";
import { runJobWithSchedule } from "./runner/run-job.js";

const truthy = new Set(["true", "1", "yes"]);

function parseEnvBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return truthy.has(value.toLowerCase());
}

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const jobFlagIndex = argv.indexOf("--job");
  const jobIdFromFlag = jobFlagIndex >= 0 ? argv[jobFlagIndex + 1] : undefined;
  const jobCmdIndex = argv.indexOf("job");
  const jobIdFromCmd = jobCmdIndex >= 0 ? argv[jobCmdIndex + 1] : undefined;
  const runAll = args.has("--run-all");
  const scheduledOnlyFlag = args.has("--scheduled-only");
  const envScheduledOnly = parseEnvBool(process.env.SCHEDULED_ONLY);
  const runScheduledOnly = runAll
    ? false
    : scheduledOnlyFlag
    ? true
    : envScheduledOnly ?? true;
  return {
    jobId: jobIdFromFlag ?? jobIdFromCmd,
    runScheduledOnly
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
    await runJobWithSchedule({
      job,
      config,
      storage,
      options: { runScheduledOnly: args.runScheduledOnly }
    });
  }

  baseLogger.info("run.complete", { jobs: selectedJobs.map((job) => job.id) });
}

main().catch((error) => {
  logger.error("run.error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
