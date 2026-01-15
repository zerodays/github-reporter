import { loadConfig } from "../src/config.js";
import { loadJobs, loadSchedulerConfig } from "../src/jobs.js";
import { createStorageClient } from "../src/storage.js";
import { logger, setLoggerConfig } from "../src/logger.js";
import { getScheduleDecision } from "../src/scheduler.js";
import { runHealthCheck } from "../src/health.js";

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

  await runHealthCheck(config);

  const schedulerConfig = loadSchedulerConfig();
  const jobs = await loadJobs("jobs.config.ts", {
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  const storage = createStorageClient(config.storage);

  baseLogger.info("smoke.jobs", {
    count: jobs.length,
    ids: jobs.map((job) => job.id)
  });

  const now = new Date();
  for (const job of jobs) {
    if (!job.schedule || !schedulerConfig.runScheduledOnly) {
      continue;
    }
    const owner = job.scope?.owner ?? config.github.owner;
    const ownerType = job.scope?.ownerType ?? config.github.ownerType;
    const decision = await getScheduleDecision({
      job,
      now,
      timeZone: config.logging.timeZone,
      storage,
      owner,
      ownerType,
      prefix: config.output.prefix
    });
    baseLogger.info("smoke.schedule", {
      jobId: job.id,
      due: decision.due,
      slotKey: decision.slotKey,
      lastSlotKey: decision.lastSlotKey,
      nextSlotKey: decision.nextSlotKey
    });
  }

  baseLogger.info("smoke.ok");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("smoke.error", { message });
  process.exit(1);
});
