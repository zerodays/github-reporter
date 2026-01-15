import { z } from "zod";

// =============================================================================
// SCHEDULE SCHEMA
// =============================================================================

const scheduleSchema = z.object({
  type: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]),
  minute: z.coerce.number().int().min(0).max(59).optional(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  month: z.coerce.number().int().min(1).max(12).optional()
});

// =============================================================================
// SCOPE SCHEMA (Per-job, replaces global allowlist/blocklist)
// =============================================================================

const scopeSchema = z.object({
  owner: z.string().min(1),
  ownerType: z.enum(["user", "org"]).default("user"),
  repos: z.array(z.string()).optional(),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  includePrivate: z.boolean().optional(),
  authors: z.array(z.string()).optional(),
  excludeAuthors: z.array(z.string()).optional(),
  authorAliases: z.record(z.string()).optional()
});

const scopeFileSchema = scopeSchema.partial({ owner: true });

// =============================================================================
// WEBHOOK SCHEMA (Per-job, falls back to global)
// =============================================================================

const webhookSchema = z.object({
  url: z.string().url().optional(),
  token: z.string().optional(),
  channel: z.string().optional(),
  secret: z.string().optional(),
  mode: z.enum(["file", "message", "both"]).optional(),
  enabled: z.boolean().optional()
});

// =============================================================================
// AGGREGATION SCHEMA
// =============================================================================

const aggregationSchema = z.object({
  sourceJobId: z.string().min(1),
  maxDays: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
  maxBytesPerItem: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

// =============================================================================
// JOB SCHEMA (One job = One output)
// =============================================================================

const jobBaseShape = {
  // Identity
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),

  // Mode: determines processing logic
  mode: z.enum(["pipeline", "aggregate", "stats"]).default("pipeline"),

  // Scheduling
  schedule: scheduleSchema,

  // Scope: what data to fetch (per-job, no global)
  scope: scopeSchema,

  // Data profile: how much data to fetch
  dataProfile: z.enum(["minimal", "standard", "full"]).optional(),

  // Processing (for pipeline/aggregate modes)
  prompt: z.string().optional(),
  promptFile: z.string().optional(),
  outputFormat: z.enum(["markdown", "json"]).default("markdown"),

  // Aggregation (for aggregate mode only)
  aggregation: aggregationSchema.optional(),

  // Output behavior
  onEmpty: z.enum(["placeholder", "manifest-only", "skip"]).default("manifest-only"),
  backfillSlots: z.number().int().nonnegative().default(0),
  outputPrefix: z.string().optional(),
  idempotentKey: z.boolean().optional().default(false),

  // Data Processing
  contextProviders: z.array(z.string()).optional(),
  redactPaths: z.array(z.string()).optional(),

  // Limits
  maxCommitsPerRepo: z.number().int().positive().optional(),
  maxRepos: z.number().int().positive().optional(),
  maxTotalCommits: z.number().int().positive().optional(),
  maxTokensHint: z.number().int().positive().optional(),
  includeInactiveRepos: z.boolean().optional().default(false),

  // Metrics
  metrics: z
    .object({
      topContributors: z.number().int().positive().optional(),
      topRepos: z.number().int().positive().optional()
    })
    .optional(),
  metricsOnly: z.boolean().optional(),

  // Per-job webhook (optional, falls back to global config)
  webhook: webhookSchema.optional()
};

const jobSchema = z
  .object(jobBaseShape)
  .refine(
    (job) => {
      // Aggregate mode requires aggregation config
      if (job.mode === "aggregate" && !job.aggregation) {
        return false;
      }
      return true;
    },
    { message: "Aggregate mode requires aggregation config" }
  )
  .refine(
    (job) => {
      // Pipeline/aggregate modes should have prompt or promptFile
      if (job.mode === "pipeline" && !job.prompt && !job.promptFile) {
        return false;
      }
      return true;
    },
    { message: "Pipeline mode requires prompt or promptFile" }
  );

const jobFileSchema = z
  .object({
    ...jobBaseShape,
    scope: scopeFileSchema
  })
  .refine(
    (job) => {
      if (job.mode === "aggregate" && !job.aggregation) {
        return false;
      }
      return true;
    },
    { message: "Aggregate mode requires aggregation config" }
  )
  .refine(
    (job) => {
      if (job.mode === "pipeline" && !job.prompt && !job.promptFile) {
        return false;
      }
      return true;
    },
    { message: "Pipeline mode requires prompt or promptFile" }
  );

// =============================================================================
// JOBS CONFIG FILE SCHEMA
// =============================================================================

const jobsConfigSchema = z.object({
  jobs: z.array(jobSchema).min(1)
});

const jobsConfigFileSchema = z.object({
  jobs: z.array(jobFileSchema).min(1)
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Schedule = z.infer<typeof scheduleSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type Webhook = z.infer<typeof webhookSchema>;
export type Aggregation = z.infer<typeof aggregationSchema>;
export type JobConfig = z.infer<typeof jobSchema>;
export type JobsConfig = z.input<typeof jobsConfigFileSchema>;

type JobScopeDefaults = {
  owner?: string;
  ownerType?: "user" | "org";
};

// =============================================================================
// SCHEMA EXPORTS (for validation)
// =============================================================================

export {
  scheduleSchema,
  scopeSchema,
  webhookSchema,
  aggregationSchema,
  jobSchema,
  jobsConfigSchema,
  jobsConfigFileSchema
};

// =============================================================================
// DEFAULT DATA PROFILES
// =============================================================================

export function getDefaultDataProfile(mode: JobConfig["mode"]): "minimal" | "standard" | "full" {
  switch (mode) {
    case "aggregate":
    case "stats":
      return "minimal";
    case "pipeline":
    default:
      return "standard";
  }
}

// =============================================================================
// PROMPT LOADING
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export function loadPrompt(job: JobConfig, configDir: string): string | undefined {
  if (job.prompt) {
    return job.prompt;
  }
  if (job.promptFile) {
    const promptPath = resolve(configDir, job.promptFile);
    return readFileSync(promptPath, "utf-8");
  }
  return undefined;
}
export async function loadJobs(
  configPath: string = "jobs.config.ts",
  defaults?: JobScopeDefaults
): Promise<JobConfig[]> {
  const absolutePath = resolve(process.cwd(), configPath);
  try {
    // Basic check for existence
    if (!existsSync(absolutePath)) {
      throw new Error(`Jobs config file not found at ${absolutePath}`);
    }
    
    // Use dynamic import for ESM compatibility
    const config = await import(`file://${absolutePath}`);
    const rawConfig = config.config || config.default || config;
    const resolvedConfig = applyJobScopeDefaults(rawConfig, defaults);
    const parsed = jobsConfigSchema.parse(resolvedConfig);
    return parsed.jobs;
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`Invalid jobs configuration: ${err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw err;
  }
}

export function loadSchedulerConfig() {
  return {
    runScheduledOnly: process.argv.includes("--scheduled-only") || process.env.SCHEDULED_ONLY === "true"
  };
}

function applyJobScopeDefaults(rawConfig: unknown, defaults?: JobScopeDefaults) {
  if (!defaults) return rawConfig;
  const ownerDefault = defaults.owner?.trim();
  const ownerTypeDefault = defaults.ownerType;
  if (!ownerDefault && !ownerTypeDefault) return rawConfig;

  if (!rawConfig || typeof rawConfig !== "object") return rawConfig;
  const config = rawConfig as { jobs?: unknown };
  if (!Array.isArray(config.jobs)) return rawConfig;

  return {
    ...config,
    jobs: config.jobs.map((job) => {
      if (!job || typeof job !== "object") return job;
      const jobObj = job as { scope?: Record<string, unknown> };
      const scope =
        jobObj.scope && typeof jobObj.scope === "object" ? jobObj.scope : {};
      const scopeOwnerRaw = (scope as { owner?: unknown }).owner;
      const scopeOwner =
        typeof scopeOwnerRaw === "string" ? scopeOwnerRaw.trim() : "";
      const scopeOwnerTypeRaw = (scope as { ownerType?: unknown }).ownerType;
      const scopeOwnerType =
        scopeOwnerTypeRaw === "user" || scopeOwnerTypeRaw === "org"
          ? scopeOwnerTypeRaw
          : undefined;

      const mergedScope = {
        ...scope,
        ...(scopeOwner ? {} : ownerDefault ? { owner: ownerDefault } : {}),
        ...(scopeOwnerType
          ? {}
          : ownerTypeDefault
          ? { ownerType: ownerTypeDefault }
          : {})
      };

      return {
        ...jobObj,
        scope: mergedScope
      };
    })
  };
}
