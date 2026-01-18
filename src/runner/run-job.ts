import { runPipelineWindow } from "../processors/pipeline.js";
import { runAggregateWindow } from "../processors/aggregate.js";
import { runStatsWindow } from "../processors/stats.js";
import { buildJobsRegistryKey } from "../utils.js";
import { writeJobsRegistry } from "../manifest.js";
import { getScheduleDecision } from "../scheduler.js";
import { listSlots } from "../slots.js";
import { logger } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { JobConfig } from "../jobs.js";
import type { StorageClient } from "../storage.js";
import type { JobRunResult, SlotWindow, WindowRunResult } from "./types.js";

export type RunJobOptions = {
  runScheduledOnly?: boolean;
  notify?: boolean;
  recordFailure?: boolean;
};

export async function runJobWithSchedule(args: {
  job: JobConfig;
  config: AppConfig;
  storage: StorageClient;
  options?: RunJobOptions;
}): Promise<JobRunResult> {
  const { job, config, storage, options } = args;
  const runScheduledOnly = options?.runScheduledOnly ?? true;
  const notify = options?.notify ?? true;
  const recordFailure = options?.recordFailure ?? true;

  const jobLogger = logger.withContext({
    owner: job.scope.owner,
    ownerType: job.scope.ownerType,
    jobId: job.id,
    jobName: job.name
  });

  if (runScheduledOnly && job.schedule) {
    const decision = await getScheduleDecision({
      job,
      now: new Date(),
      timeZone: config.timeZone,
      storage,
      owner: job.scope.owner,
      ownerType: job.scope.ownerType,
      prefix: config.output.prefix
    });
    if (!decision.due) {
      jobLogger.info("job.skipped", { reason: "not_due" });
      return { jobId: job.id, status: "skipped", reason: "not_due", slots: [] };
    }
  }

  const jobsKey = buildJobsRegistryKey(
    config.output.prefix,
    job.scope.ownerType,
    job.scope.owner
  );
  await writeJobsRegistry(storage, jobsKey, job.scope.owner, job.scope.ownerType, job);

  const slots = listSlots({
    now: new Date(),
    schedule: job.schedule,
    timeZone: config.timeZone ?? "UTC",
    backfillSlots: job.backfillSlots
  }) as SlotWindow[];

  jobLogger.info("job.start", { mode: job.mode, slots: slots.length });

  const results: WindowRunResult[] = [];
  for (const slot of slots) {
    const result = await runJobForSlot({
      job,
      slot,
      config,
      storage,
      options: { notify, recordFailure },
      jobLogger
    });
    results.push(result);
  }

  const failed = results.some((result) => result.status === "failed");
  const status = failed ? "failed" : "success";

  jobLogger.info("job.complete", { jobId: job.id });
  return { jobId: job.id, status, slots: results };
}

export async function runJobForSlot(args: {
  job: JobConfig;
  slot: SlotWindow;
  config: AppConfig;
  storage: StorageClient;
  options?: Pick<RunJobOptions, "notify" | "recordFailure">;
  jobLogger?: ReturnType<typeof logger.withContext>;
}): Promise<WindowRunResult> {
  const { job, slot, config, storage } = args;
  const notify = args.options?.notify ?? true;
  const recordFailure = args.options?.recordFailure ?? true;
  const jobLogger = args.jobLogger ?? logger.withContext({
    owner: job.scope.owner,
    ownerType: job.scope.ownerType,
    jobId: job.id,
    jobName: job.name
  });

  if (job.mode === "pipeline") {
    return runPipelineWindow(slot, job, config, jobLogger, storage, {
      notify,
      recordFailure
    });
  }
  if (job.mode === "aggregate") {
    return runAggregateWindow(slot, job, config, jobLogger, storage, {
      notify,
      recordFailure
    });
  }
  return runStatsWindow(slot, job, config, jobLogger, storage, {
    recordFailure
  });
}
