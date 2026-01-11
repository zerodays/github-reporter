import "dotenv/config";
import { z } from "zod";
import { defaultJobs } from "../jobs.defaults.js";

const truthy = new Set(["true", "1", "yes"]);

const envSchema = z.object({
  JOBS_ENABLED: z.string().optional(),
  RUN_SCHEDULED_ONLY: z.string().optional(),
  REPORT_WINDOW_DAYS: z.coerce.number().int().positive().optional(),
  BACKFILL_WINDOWS: z.coerce.number().int().nonnegative().optional(),
  BACKFILL_START: z.string().optional(),
  BACKFILL_END: z.string().optional(),
  REPORT_TEMPLATES: z.string().optional(),
  REPORT_ON_EMPTY: z.enum(["placeholder", "manifest-only", "skip"]).optional(),
  INCLUDE_INACTIVE_REPOS: z.string().optional(),
  MAX_COMMITS_PER_REPO: z.coerce.number().int().positive().optional(),
  MAX_REPOS: z.coerce.number().int().positive().optional(),
  MAX_TOTAL_COMMITS: z.coerce.number().int().positive().optional(),
  MAX_TOKENS_HINT: z.coerce.number().int().positive().optional(),
  REPORT_IDEMPOTENT_KEY: z.string().optional()
});

const jobScopeSchema = z.object({
  owner: z.string().optional(),
  ownerType: z.enum(["user", "org"]).optional(),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  includePrivate: z.boolean().optional(),
  authors: z.array(z.string()).optional(),
  excludeAuthors: z.array(z.string()).optional(),
  authorAliases: z.record(z.string()).optional()
});

const scheduleSchema = z.object({
  type: z.enum(["hourly", "daily", "weekly"]),
  minute: z.coerce.number().int().min(0).max(59).optional(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  weekday: z.coerce.number().int().min(0).max(6).optional()
});

const jobSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    mode: z.enum(["pipeline", "aggregate", "stats"]).default("pipeline"),
    jobVersion: z.string().optional(),
    windowDays: z.coerce.number().int().positive().optional(),
    windowHours: z.coerce.number().int().positive().optional(),
  templates: z.array(z.string()).default([]),
  outputFormat: z.enum(["markdown", "json"]).optional(),
  onEmpty: z.enum(["placeholder", "manifest-only", "skip"]).default("manifest-only"),
  includeInactiveRepos: z.boolean().default(false),
  maxCommitsPerRepo: z.coerce.number().int().positive().optional(),
  maxRepos: z.coerce.number().int().positive().optional(),
  maxTotalCommits: z.coerce.number().int().positive().optional(),
  maxTokensHint: z.coerce.number().int().positive().optional(),
  idempotentKey: z.string().optional(),
  backfillWindows: z.coerce.number().int().nonnegative().default(0),
  backfillStart: z.string().optional(),
  backfillEnd: z.string().optional(),
    outputPrefix: z.string().optional(),
    contextProviders: z.array(z.string()).optional(),
    contextMaxBytes: z.coerce.number().int().positive().optional(),
    redactPaths: z.array(z.string()).optional(),
    schedule: scheduleSchema.optional(),
    scope: jobScopeSchema.optional(),
    aggregation: z
      .object({
        sourceTemplateId: z.string().optional(),
        sourceJobId: z.string().optional(),
        sourceOutputPrefix: z.string().optional(),
        promptTemplate: z.string().optional()
      })
      .optional()
  })
  .refine((job) => job.windowDays || job.windowHours, {
    message: "Job must define windowDays or windowHours."
  });

const jobsFileSchema = z.object({
  jobs: z.array(jobSchema).min(1)
});

export type JobScope = z.infer<typeof jobScopeSchema>;
export type JobConfig = z.infer<typeof jobSchema>;
export type JobsFile = z.infer<typeof jobsFileSchema>;

export function loadSchedulerConfig() {
  const env = envSchema.parse(process.env);
  return {
    runScheduledOnly: resolveBool(env.RUN_SCHEDULED_ONLY, true)
  };
}

export function loadJobs(): JobConfig[] {
  const env = envSchema.parse(process.env);
  const file = jobsFileSchema.parse(defaultJobs);
  const enabled = resolveList(env.JOBS_ENABLED, []);
  const applyEnvOverrides = enabled.length === 0;
  const selected =
    enabled.length === 0
      ? file.jobs
      : file.jobs.filter((job) => enabled.includes(job.id));
  if (selected.length === 0) {
    throw new Error("No jobs enabled. Check JOBS_ENABLED or jobs.defaults.ts.");
  }
  if (!applyEnvOverrides) {
    return selected;
  }
  return selected.map((job) => applyEnvOverridesToJob(job, env));
}

function applyEnvOverridesToJob(job: JobConfig, env: z.infer<typeof envSchema>) {
  const templates = resolveList(env.REPORT_TEMPLATES, job.templates);
  return {
    ...job,
    includeInactiveRepos: resolveBool(
      env.INCLUDE_INACTIVE_REPOS,
      job.includeInactiveRepos
    ),
    windowDays: env.REPORT_WINDOW_DAYS ?? job.windowDays,
    maxCommitsPerRepo: env.MAX_COMMITS_PER_REPO ?? job.maxCommitsPerRepo,
    maxRepos: env.MAX_REPOS ?? job.maxRepos,
    maxTotalCommits: env.MAX_TOTAL_COMMITS ?? job.maxTotalCommits,
    maxTokensHint: env.MAX_TOKENS_HINT ?? job.maxTokensHint,
    idempotentKey: env.REPORT_IDEMPOTENT_KEY ?? job.idempotentKey,
    templates,
    backfillWindows: env.BACKFILL_WINDOWS ?? job.backfillWindows,
    backfillStart: normalizeDateValue(env.BACKFILL_START ?? job.backfillStart),
    backfillEnd: normalizeDateValue(env.BACKFILL_END ?? job.backfillEnd),
    onEmpty: env.REPORT_ON_EMPTY ?? job.onEmpty
  };
}

function resolveBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return truthy.has(value.toLowerCase());
}

function resolveList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateValue(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
