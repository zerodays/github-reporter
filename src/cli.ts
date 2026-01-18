import { Command } from "commander";
import { loadConfig } from "./config.js";
import { loadJobs, type JobConfig } from "./jobs.js";
import { createStorageClient, validateStorage } from "./storage.js";
import { setLoggerConfig } from "./logger.js";
import { runJobForSlot } from "./runner/run-job.js";
import { parseAtToDate, resolveSlotForAt } from "./runner/slots.js";
import { buildIndexBaseKey, buildReportBaseKey, formatMonthKey, loadIndexItemsForRange } from "./utils.js";
import { createBufferedStorage } from "./storage-transaction.js";
import { loadJobsRegistry, listIndexPeriods, loadLatest, recomputeLatest, removeIndexItemBySlot } from "./storage-index.js";
import type { StorageClient } from "./storage.js";
import type { WindowRunResult } from "./runner/types.js";
import type { IndexItem, ReportManifest } from "./manifest.js";
import type { ReportMetricsTotals } from "./types.js";

type BaseContext = {
  config: ReturnType<typeof loadConfig>;
  storage: StorageClient;
};

const program = new Command();
program
  .name("reporter")
  .description("GitHub Reporter CLI")
  .version("0.1.0");

program
  .command("run")
  .requiredOption("--job <id>", "Job id to run")
  .requiredOption("--at <date>", "Date or datetime to resolve the slot")
  .option("--notify", "Send webhook/Slack notification")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({ prefix: options.prefix, validate: true });
    const job = await loadJob(config, options.job);
    const slot = resolveSlotForAt({
      at: options.at,
      schedule: job.schedule,
      timeZone: config.timeZone ?? "UTC"
    });

    const result = await runJobForSlot({
      job,
      slot,
      config,
      storage,
      options: { notify: Boolean(options.notify), recordFailure: true }
    });

    printRunResult(result, options.json);
  });

program
  .command("rerun")
  .requiredOption("--job <id>", "Job id to rerun")
  .requiredOption("--at <date>", "Date or datetime to resolve the slot")
  .option("--notify", "Send webhook/Slack notification")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({ prefix: options.prefix, validate: true });
    const job = await loadJob(config, options.job);
    const timeZone = config.timeZone ?? "UTC";
    const slot = resolveSlotForAt({ at: options.at, schedule: job.schedule, timeZone });

    const prefix = job.outputPrefix ?? config.output.prefix;
    const reportBaseKey = buildReportBaseKey(prefix, job.scope.ownerType, job.scope.owner, job.id, slot.slotKey);
    const existingKeys = await storage.list(reportBaseKey);

    const buffered = createBufferedStorage(storage);
    const result = await runJobForSlot({
      job,
      slot,
      config,
      storage: buffered.storage,
      options: { notify: Boolean(options.notify), recordFailure: false }
    });

    let finalResult = result;
    if (result.status === "success") {
      const committed = await buffered.commit();
      const committedKeys = new Set(Object.keys(committed));
      const outputKey = Object.keys(committed).find((key) =>
        /\/output\.(md|json)$/.test(key)
      );
      const outputUri = outputKey ? committed[outputKey]?.uri : undefined;
      if (outputUri) {
        finalResult = { ...result, outputUri };
      }
      for (const key of existingKeys) {
        if (!committedKeys.has(key)) {
          await storage.delete(key);
        }
      }
    } else {
      buffered.discard();
    }

    printRunResult(finalResult, options.json);
  });

program
  .command("delete")
  .requiredOption("--job <id>", "Job id to delete")
  .requiredOption("--at <date>", "Date or datetime to resolve the slot")
  .requiredOption("--yes", "Confirm deletion")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    if (!options.yes) {
      throw new Error("Deletion requires --yes.");
    }
    const { config, storage } = await loadBase({ prefix: options.prefix, validate: true });
    const job = await loadJob(config, options.job);
    const timeZone = config.timeZone ?? "UTC";
    const slot = resolveSlotForAt({ at: options.at, schedule: job.schedule, timeZone });
    const prefix = job.outputPrefix ?? config.output.prefix;

    const reportBaseKey = buildReportBaseKey(prefix, job.scope.ownerType, job.scope.owner, job.id, slot.slotKey);
    const manifestKey = `${reportBaseKey}/manifest.json`;
    const manifestText = await storage.get(manifestKey);
    const keys = await storage.list(reportBaseKey);

    for (const key of keys) {
      await storage.delete(key);
    }

    const indexBase = buildIndexBaseKey(prefix, job.scope.ownerType, job.scope.owner, job.id);
    const periodKey = resolvePeriodKey(slot.slotKey, manifestText, timeZone);
    const indexKey = `${indexBase}/${periodKey}.json`;
    const removal = await removeIndexItemBySlot({
      storage,
      indexKey,
      slotKey: slot.slotKey
    });

    const latest = await loadLatest(storage, indexBase);
    if (latest && latest.slotKey === slot.slotKey) {
      await recomputeLatest({ storage, indexBase });
    }

    const output = {
      status: "success",
      deletedKeys: keys.length,
      removedIndexItem: Boolean(removal.removed)
    };
    printJsonOrText(output, options.json);
  });

const listCommand = program.command("list").description("List storage metadata");

listCommand
  .command("owners")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const prefix = config.output.prefix;
    const keys = await storage.list(`${prefix}/_index/`);
    const owners = new Map<string, { owner: string; ownerType: "user" | "org" }>();
    for (const key of keys) {
      if (!key.endsWith("/jobs.json")) continue;
      const parts = key.split("/");
      const jobsIndex = parts.lastIndexOf("_index");
      if (jobsIndex === -1) continue;
      const ownerType = parts[jobsIndex + 1] as "user" | "org";
      const owner = parts[jobsIndex + 2];
      if (!ownerType || !owner) continue;
      owners.set(`${ownerType}:${owner}`, { owner, ownerType });
    }
    const rows = Array.from(owners.values()).sort((a, b) => {
      if (a.ownerType !== b.ownerType) return a.ownerType.localeCompare(b.ownerType);
      return a.owner.localeCompare(b.owner);
    });
    printJsonOrTable(rows, ["ownerType", "owner"], options.json);
  });

listCommand
  .command("jobs")
  .requiredOption("--owner <owner>", "Owner name")
  .requiredOption("--owner-type <type>", "Owner type: user or org")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const ownerType = parseOwnerType(options.ownerType);
    const registry = await loadJobsRegistry({
      storage,
      prefix: config.output.prefix,
      owner: options.owner,
      ownerType
    });
    const jobs = registry?.jobs ?? [];
    const rows = jobs.map((job) => ({
      id: job.id,
      name: job.name,
      mode: job.mode,
      lastRunAt: job.lastRunAt ?? "",
      lastStatus: job.lastStatus ?? "",
      totalRuns: job.totalRuns ?? 0
    }));
    printJsonOrTable(rows, ["id", "name", "mode", "lastRunAt", "lastStatus", "totalRuns"], options.json);
  });

listCommand
  .command("runs")
  .requiredOption("--owner <owner>", "Owner name")
  .requiredOption("--owner-type <type>", "Owner type: user or org")
  .requiredOption("--job <id>", "Job id")
  .option("--window <start..end>", "Window range for runs")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .option("--latest", "Show only the latest run")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const ownerType = parseOwnerType(options.ownerType);
    const prefix = config.output.prefix;
    const indexBase = buildIndexBaseKey(prefix, ownerType, options.owner, options.job);

    if (options.latest) {
      const latest = await loadLatest(storage, indexBase);
      printJsonOrTable(latest ? [latest] : [], ["slotKey", "status", "outputSize", "manifestKey"], options.json);
      return;
    }

    if (!options.window) {
      throw new Error("Missing --window (required unless --latest is set).");
    }

    const window = parseWindow(options.window, config.timeZone ?? "UTC");
    const items = await loadIndexItemsForRange(storage, indexBase, window, config.timeZone);
    const rows = items.map((item) => ({
      slotKey: item.slotKey,
      status: item.status,
      outputSize: item.outputSize,
      manifestKey: item.manifestKey
    }));
    printJsonOrTable(rows, ["slotKey", "status", "outputSize", "manifestKey"], options.json);
  });

listCommand
  .command("periods")
  .requiredOption("--owner <owner>", "Owner name")
  .requiredOption("--owner-type <type>", "Owner type: user or org")
  .requiredOption("--job <id>", "Job id")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const ownerType = parseOwnerType(options.ownerType);
    const prefix = config.output.prefix;
    const indexBase = buildIndexBaseKey(prefix, ownerType, options.owner, options.job);
    const periods = await listIndexPeriods(storage, indexBase);
    printJsonOrTable(periods.map((period) => ({ period })), ["period"], options.json);
  });

program
  .command("show")
  .requiredOption("--owner <owner>", "Owner name")
  .requiredOption("--owner-type <type>", "Owner type: user or org")
  .requiredOption("--job <id>", "Job id")
  .requiredOption("--window <start..end>", "Window range for runs")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--limit <n>", "Limit number of runs")
  .option("--full", "Print full output")
  .option("--manifest", "Include full manifest JSON")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const ownerType = parseOwnerType(options.ownerType);
    const prefix = config.output.prefix;
    const window = parseWindow(options.window, config.timeZone ?? "UTC");
    const limit = options.limit ? Number(options.limit) : undefined;
    if (options.limit && (!Number.isFinite(limit) || !limit || limit <= 0)) {
      throw new Error(`Invalid --limit value: ${options.limit}`);
    }

    const indexBase = buildIndexBaseKey(prefix, ownerType, options.owner, options.job);
    let items = await loadIndexItemsForRange(storage, indexBase, window, config.timeZone);
    if (limit) {
      items = items.slice(-limit);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const manifestText = await storage.get(item.manifestKey);
      const manifest = manifestText ? (JSON.parse(manifestText) as ReportManifest) : null;
      const outputKey = manifest?.output?.key;
      const outputText = outputKey ? await storage.get(outputKey) : null;
      const outputPreview = outputText
        ? buildOutputPreview(outputText, 20, 4000)
        : null;
      const resolvedWindow = manifest?.window ?? item.window;

      const record: Record<string, unknown> = {
        slotKey: item.slotKey,
        status: item.status,
        window: resolvedWindow,
        manifestKey: item.manifestKey,
        outputKey: outputKey ?? null,
        outputPreview
      };
      if (options.full && outputText) {
        record.output = outputText;
      }
      if (options.manifest && manifest) {
        record.manifest = manifest;
      }
      results.push(record);

      if (options.json) continue;

      const header = `=== ${item.slotKey} (${item.status}) ===`;
      console.log(header);
      console.log(`window: ${resolvedWindow.start} -> ${resolvedWindow.end}`);
      console.log(`manifest: ${item.manifestKey}`);
      if (outputKey) {
        console.log(`output: ${outputKey}`);
      } else {
        console.log("output: <none>");
      }
      const printableOutput = options.full ? outputText : outputPreview;
      if (printableOutput) {
        console.log(printableOutput);
      }
      if (options.manifest && manifest) {
        console.log(JSON.stringify(manifest, null, 2));
      }
      console.log("");
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    }
  });

program
  .command("stats")
  .requiredOption("--owner <owner>", "Owner name")
  .requiredOption("--owner-type <type>", "Owner type: user or org")
  .requiredOption("--window <start..end>", "Window range for stats")
  .option("--job <id>", "Job id")
  .option("--prefix <prefix>", "Override storage prefix")
  .option("--details", "Include duration and token usage stats")
  .option("--json", "JSON output")
  .action(async (options) => {
    const { config, storage } = await loadBase({
      prefix: options.prefix,
      validate: false,
      allowMissingLlmKey: true
    });
    const ownerType = parseOwnerType(options.ownerType);
    const prefix = config.output.prefix;
    const window = parseWindow(options.window, config.timeZone ?? "UTC");

    const jobIds = options.job ? [options.job] : await listJobsFromRegistry(storage, prefix, options.owner, ownerType);
    const allItems: IndexItem[] = [];

    for (const jobId of jobIds) {
      const indexBase = buildIndexBaseKey(prefix, ownerType, options.owner, jobId);
      const items = await loadIndexItemsForRange(storage, indexBase, window, config.timeZone);
      allItems.push(...items);
    }

    const stats = summarizeIndexItems(allItems);
    if (options.details) {
      const details = summarizeIndexItemDetails(allItems);
      Object.assign(stats, details);
    }

    printJsonOrText(stats, options.json);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function loadBase(args: {
  prefix?: string;
  validate: boolean;
  allowMissingLlmKey?: boolean;
}): Promise<BaseContext> {
  const config = loadConfig({ allowMissingLlmKey: args.allowMissingLlmKey });
  if (args.prefix) {
    config.output = { ...config.output, prefix: args.prefix };
  }
  setLoggerConfig({
    level: config.logging.level,
    includeTimings: config.logging.includeTimings,
    format: config.logging.format,
    color: config.logging.color,
    timeZone: config.timeZone
  });
  const storage = createStorageClient(config.storage);
  if (args.validate) {
    await validateStorage(config.storage);
  }
  return { config, storage };
}

async function loadJob(config: ReturnType<typeof loadConfig>, jobId: string): Promise<JobConfig> {
  const jobs = await loadJobs("jobs.config.ts", {
    owner: config.github.owner,
    ownerType: config.github.ownerType
  });
  const selected = jobs.find((job) => job.id === jobId);
  if (!selected) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return selected;
}

function parseWindow(value: string, timeZone: string) {
  const parts = value.split("..");
  if (parts.length !== 2) {
    throw new Error(`Invalid window format: ${value}`);
  }
  const start = parseAtToDate(parts[0], timeZone).toISOString();
  const end = parseAtToDate(parts[1], timeZone).toISOString();
  if (start > end) {
    throw new Error("Window start must be before end.");
  }
  return { start, end };
}

function resolvePeriodKey(slotKey: string, manifestText: string | null, timeZone: string) {
  if (manifestText) {
    const manifest = JSON.parse(manifestText) as ReportManifest;
    return formatMonthKey(new Date(manifest.window.start), timeZone);
  }
  const iso = slotKey.replace(/T(\d{2})-(\d{2})Z$/, "T$1:$2Z");
  const fallback = new Date(iso);
  if (Number.isFinite(fallback.getTime())) {
    return formatMonthKey(fallback, timeZone);
  }
  return slotKey.slice(0, 7);
}

function printRunResult(result: WindowRunResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = [
    `status: ${result.status}`,
    `slot: ${result.slotKey}`,
    `durationMs: ${result.durationMs ?? 0}`
  ];
  lines.push(`window: ${result.window.start} -> ${result.window.end}`);
  if (result.reason) lines.push(`reason: ${result.reason}`);
  if (result.outputUri) lines.push(`output: ${result.outputUri}`);
  if (result.error) lines.push(`error: ${result.error}`);
  console.log(lines.join("\n"));
}

function printJsonOrText(value: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function printJsonOrTable<T extends Record<string, unknown>>(rows: T[], headers: string[], json: boolean) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }
  const table = buildTable(headers, rows);
  console.log(table);
}

function buildTable(headers: string[], rows: Record<string, unknown>[]) {
  const widths = headers.map((header) => header.length);
  for (const row of rows) {
    headers.forEach((header, index) => {
      const value = String(row[header] ?? "");
      widths[index] = Math.max(widths[index], value.length);
    });
  }
  const headerLine = headers.map((header, index) => header.padEnd(widths[index])).join("  ");
  const separator = headers.map((_, index) => "-".repeat(widths[index])).join("  ");
  const body = rows.map((row) =>
    headers
      .map((header, index) => String(row[header] ?? "").padEnd(widths[index]))
      .join("  ")
  );
  return [headerLine, separator, ...body].join("\n");
}

function buildOutputPreview(text: string, maxLines: number, maxChars: number) {
  const lines = text.split("\n");
  const sliced = lines.slice(0, maxLines);
  let preview = sliced.join("\n");
  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars) + "...";
  }
  if (lines.length > maxLines) {
    preview += "\n...[truncated]";
  }
  return preview;
}

async function listJobsFromRegistry(
  storage: StorageClient,
  prefix: string,
  owner: string,
  ownerType: "user" | "org"
) {
  const registry = await loadJobsRegistry({ storage, prefix, owner, ownerType });
  return registry?.jobs.map((job) => job.id) ?? [];
}

function summarizeIndexItems(items: { status: string; outputSize: number; metrics?: ReportMetricsTotals }[]) {
  const totals = {
    runs: items.length,
    success: 0,
    failed: 0,
    outputBytes: 0,
    metrics: {
      repos: 0,
      commits: 0,
      additions: 0,
      deletions: 0,
      prsOpened: 0,
      prsMerged: 0,
      prsClosed: 0,
      issuesOpened: 0,
      issuesClosed: 0,
      contributors: 0
    }
  };

  for (const item of items) {
    if (item.status === "success") totals.success += 1;
    if (item.status === "failed") totals.failed += 1;
    totals.outputBytes += item.outputSize ?? 0;
    if (!item.metrics) continue;
    totals.metrics.repos += item.metrics.repos;
    totals.metrics.commits += item.metrics.commits;
    totals.metrics.additions += item.metrics.additions;
    totals.metrics.deletions += item.metrics.deletions;
    totals.metrics.prsOpened += item.metrics.prsOpened;
    totals.metrics.prsMerged += item.metrics.prsMerged;
    totals.metrics.prsClosed += item.metrics.prsClosed;
    totals.metrics.issuesOpened += item.metrics.issuesOpened;
    totals.metrics.issuesClosed += item.metrics.issuesClosed;
    totals.metrics.contributors += item.metrics.contributors;
  }

  return totals;
}

function summarizeIndexItemDetails(
  items: { durationMs?: number; llm?: ReportManifest["llm"] }[]
) {
  const durations: number[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const item of items) {
    if (typeof item.durationMs === "number") durations.push(item.durationMs);
    if (item.llm?.inputTokens) usage.inputTokens += item.llm.inputTokens;
    if (item.llm?.outputTokens) usage.outputTokens += item.llm.outputTokens;
  }
  return {
    durations: summarizeDurations(durations),
    llmUsage: usage
  };
}

function summarizeDurations(values: number[]) {
  if (values.length === 0) {
    return { avgMs: 0, maxMs: 0, p95Ms: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    avgMs: Math.round(total / sorted.length),
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[p95Index]
  };
}

function parseOwnerType(value: string): "user" | "org" {
  if (value === "user" || value === "org") return value;
  throw new Error(`Invalid owner type: ${value}`);
}
