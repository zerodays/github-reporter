import { generateAggregateReport, aggregatePrompt } from "../generator.js";
import { withRetry } from "../retry.js";
import { sendWebhook } from "../webhook.js";
import {
  buildFailedManifest,
  buildManifest,
  updateIndex,
  writeLatest,
  writeManifest,
  writeSummary
} from "../manifest.js";
import {
  buildIndexBaseKey,
  buildReportBaseKey,
  formatMonthKey,
  getWindowSize,
  withDuration,
  truncateBytes,
  formatDateOnly,
  loadIndexItemsForRange
} from "../utils.js";
import { aggregateReportMetrics } from "../metrics.js";
import { type logger as LoggerType } from "../logger.js";
import type { AppConfig } from "../config.js";
import type { JobConfig } from "../jobs.js";
import type { StorageClient } from "../storage.js";
import type { AggregateInput } from "../types.js";
import type { IndexItem, ReportManifest } from "../manifest.js";
import type { WindowRunResult } from "../runner/types.js";
import fs from "node:fs/promises";
import path from "node:path";

export async function runAggregateWindow(
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
  options?: { notify?: boolean; recordFailure?: boolean }
): Promise<WindowRunResult> {
  const { window, slotKey, slotType, scheduledAt } = slot;
  const windowStart = new Date(window.start);
  const owner = job.scope.owner;
  const ownerType = job.scope.ownerType;
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

  const notify = options?.notify ?? true;
  const recordFailure = options?.recordFailure ?? true;
  const baseResult = { slotKey, slotType, scheduledAt, window };

  const runStart = Date.now();

  const sourceJobId = job.aggregation?.sourceJobId;
  if (!sourceJobId) {
    runLogger.warn("aggregate.skipped", { reason: "missing_source_job_id" });
    return { ...baseResult, status: "skipped", reason: "missing_source_job_id" };
  }

  const sourceIndexBase = buildIndexBaseKey(
    config.output.prefix, // Use global prefix for now, or detect from source job config?
    ownerType,
    owner,
    sourceJobId
  );

  try {
    if (job.idempotentKey) {
      const manifestExists = await storage.exists(manifestKey);
      if (manifestExists) {
        runLogger.info("run.skipped", { key: manifestKey });
        return { ...baseResult, status: "skipped", reason: "idempotent" };
      }
    }

    // 1. Find source reports in the index
    const items = await loadIndexItemsForRange(storage, sourceIndexBase, window, config.timeZone);
    
    // 2. Load and merge source outputs
    // Note: We no longer need sourceTemplateId because one job = one output
    const { items: aggregateItems, metrics: sourceMetrics } = await loadAggregateItems(storage, items, {
      maxBytesPerItem: job.aggregation?.maxBytesPerItem,
      maxTotalBytes: job.aggregation?.maxTotalBytes
    }, config.timeZone);

    const metricsConfig = job.metrics ?? {};
    const metrics = aggregateReportMetrics(sourceMetrics, {
      topContributors: metricsConfig.topContributors ?? 10,
      topRepos: metricsConfig.topRepos ?? 10
    });

    const isEmpty = aggregateItems.length === 0;
    if (isEmpty && job.onEmpty === "skip") {
      runLogger.info("run.skipped", { reason: "empty" });
      return { ...baseResult, status: "skipped", reason: "empty" };
    }

    // 3. Generate Report
    let output;
    let llmMetadata;
    if (!(isEmpty && job.onEmpty === "manifest-only")) {
      const outputFormat = job.outputFormat ?? config.output.format;
      const contentType = outputFormat === "json" ? "application/json" : "text/markdown; charset=utf-8";

      let reportText = "";
      if (isEmpty && job.onEmpty !== "manifest-only") {
        reportText = "# No activity recorded for this period.";
      } else {
        const generateStart = Date.now();
        runLogger.info("report.generate.start", { model: config.llm.model });

        // Resolve prompt
        let promptTemplate = job.prompt ?? aggregatePrompt;
        if (job.promptFile) {
          try {
            const absolutePath = path.resolve(process.cwd(), job.promptFile);
            promptTemplate = await fs.readFile(absolutePath, "utf-8");
          } catch (err) {
            runLogger.warn("report.prompt_file.failed", { path: job.promptFile, error: String(err) });
          }
        }

        const input: AggregateInput = {
          owner,
          ownerType,
          window,
          timeZone: config.timeZone ?? "UTC",
          metrics: metrics ?? undefined,
          job: { id: job.id, name: job.id },
          source: { jobId: sourceJobId },
          items: aggregateItems
        };

        const report = await withRetry(
          () => generateAggregateReport(input, {
            apiKey: config.llm.apiKey,
            model: config.llm.model,
            promptTemplate,
            outputFormat,
            outputSchemaJson: config.output.schemaJson,
            maxTokensHint: job.maxTokensHint
          }),
          { retries: config.network.retryCount, backoffMs: config.network.retryBackoffMs }
        );
        reportText = report.text;
        llmMetadata = report.usage ? {
          model: config.llm.model,
          inputTokens: report.usage?.inputTokens,
          outputTokens: report.usage?.outputTokens,
        } : undefined;

        runLogger.info("report.generate.done", { ...withDuration(generateStart, config.logging.includeTimings) });
      }

      // 4. Store Output
      const extension = outputFormat === "json" ? "json" : "md";
      const stored = await storage.put(`${reportBaseKey}/output.${extension}`, reportText, contentType);
      output = { format: outputFormat, stored };

      // 4b. Webhook
      const webhookConfig = job.webhook ?? config.webhook;
      if (
        notify &&
        (webhookConfig.url || (webhookConfig.token && webhookConfig.channel))
      ) {
        const payload = {
          owner,
          ownerType,
          jobId: job.id,
          jobName: job.name,
          window,
          artifact: stored,
          format: outputFormat,
          createdAt: new Date().toISOString()
        };
        runLogger.info("webhook.send.start");
        await withRetry(() => sendWebhook(webhookConfig, payload, reportText), {
          retries: config.network.retryCount,
          backoffMs: config.network.retryBackoffMs
        });
      }
    }

    // 5. Manifest & Indexing
    const dataProfile = job.dataProfile ?? "standard";
    const durationMs = Date.now() - runStart;
    const manifest = buildManifest({
      owner,
      ownerType,
      window: { ...window, days: windowDays, hours: windowHours },
      timezone: config.timeZone,
      scheduledAt,
      slotKey,
      slotType,
      repos: [], // No repo-level detail in aggregate
      output,
      empty: isEmpty,
      job,
      durationMs,
      dataProfile,
      llm: llmMetadata,
      source: { jobId: sourceJobId, itemCount: aggregateItems.length },
      metrics: metrics ?? undefined
    });

    await writeManifest(storage, manifestKey, manifest);
    await writeSummary(storage, summaryKey, manifest, manifestKey);
    
    // ... index update logic
    const periodKey = formatMonthKey(windowStart, config.timeZone);
    const monthKey = `${indexBaseKey}/${periodKey}.json`;
    const indexItem = {
       owner, ownerType, jobId: job.id, slotKey, slotType, scheduledAt, 
       window: { ...window, days: windowDays, hours: windowHours },
       status: "success" as const, empty: isEmpty, outputSize: manifest.output?.size ?? 0,
       manifestKey,
       metrics: metrics?.totals,
       durationMs,
       llm: llmMetadata
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
      const indexItem = {
         owner, ownerType, jobId: job.id, slotKey, slotType, scheduledAt,
         window: { ...window, days: windowDays, hours: windowHours },
         status: "failed" as const, empty: true, outputSize: 0,
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



async function loadAggregateItems(
  storage: StorageClient,
  items: IndexItem[],
  caps: { maxBytesPerItem?: number; maxTotalBytes?: number },
  timeZone?: string
) {
  const results: AggregateInput["items"] = [];
  const metrics: NonNullable<AggregateInput["metrics"]>[] = [];
  const totalCap = caps?.maxTotalBytes ?? Infinity;
  const perItemCap = caps?.maxBytesPerItem ?? Infinity;
  let totalBytes = 0;

  for (const item of items) {
    if (totalBytes >= totalCap) break;
    const manifestText = await storage.get(item.manifestKey);
    if (!manifestText) continue;
    const manifest = JSON.parse(manifestText) as ReportManifest;
    if (manifest.status === "failed" || !manifest.output) continue;
    
    const content = await storage.get(manifest.output.key);
    if (!content) continue;

    const truncated = truncateBytes(content, perItemCap);
    const bytes = Buffer.byteLength(truncated, "utf8");
    if (totalBytes + bytes > totalCap) break;

    results.push({
      date: formatDateOnly(new Date(item.window.start), timeZone),
      manifestKey: item.manifestKey,
      content: truncated
    });
    if (manifest.metrics) {
      metrics.push(manifest.metrics);
    }
    totalBytes += bytes;
  }
  return { items: results, metrics };
}
