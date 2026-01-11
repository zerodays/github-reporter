import "dotenv/config";
import { z } from "zod";
import { defaultConfig } from "../config.defaults.js";

const truthy = new Set(["true", "1", "yes"]);

const envSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_OWNER_TYPE: z.enum(["user", "org"]).optional(),
  REPORT_LOOKBACK_HOURS: z.coerce.number().optional(),
  GITHUB_PER_PAGE: z.coerce.number().int().positive().optional(),
  GITHUB_MAX_PAGES: z.coerce.number().int().positive().optional(),
  REPO_ALLOWLIST: z.string().optional(),
  REPO_BLOCKLIST: z.string().optional(),
  INCLUDE_PRIVATE: z.string().optional(),

  OUTPUT_FORMAT: z.enum(["markdown", "json"]).optional(),
  OUTPUT_SCHEMA_JSON: z.string().optional(),
  OUTPUT_PREFIX: z.string().optional(),
  OUTPUT_VALIDATE_SCHEMA: z.string().optional(),
  INCLUDE_INACTIVE_REPOS: z.string().optional(),
  MAX_COMMITS_PER_REPO: z.coerce.number().int().positive().optional(),
  MAX_REPOS: z.coerce.number().int().positive().optional(),
  MAX_TOTAL_COMMITS: z.coerce.number().int().positive().optional(),
  MAX_TOKENS_HINT: z.coerce.number().int().positive().optional(),
  REPORT_IDEMPOTENT_KEY: z.string().optional(),
  REPORT_TEMPLATES: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  PROMPT_TEMPLATE: z.string().optional(),

  BUCKET_TYPE: z.string().optional(),
  BUCKET_URI: z.string().optional(),
  BUCKET_REGION: z.string().optional(),
  BUCKET_ACCESS_KEY_ID: z.string().optional(),
  BUCKET_SECRET_ACCESS_KEY: z.string().optional(),

  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  RETRY_COUNT: z.coerce.number().int().nonnegative().optional(),
  RETRY_BACKOFF_MS: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  LOG_INCLUDE_TIMINGS: z.string().optional(),
  LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
  LOG_COLOR: z.string().optional(),
  LOG_TIMEZONE: z.string().optional(),
  LOG_CONTEXT_MAX_BYTES: z.coerce.number().int().positive().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const fileConfig = fileConfigSchema.parse(defaultConfig);
  const allowlist = resolveList(
    env.REPO_ALLOWLIST,
    fileConfig.github.allowlist
  );
  const blocklist = resolveList(
    env.REPO_BLOCKLIST,
    fileConfig.github.blocklist
  );
  const owner = env.GITHUB_OWNER ?? fileConfig.github.owner;
  const apiKey = env.GEMINI_API_KEY ?? fileConfig.llm.apiKey;
  if (!owner) {
    throw new Error("Missing GITHUB_OWNER (env or config.defaults.ts).");
  }
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY (env or config.defaults.ts).");
  }
  return {
    github: {
      token: env.GITHUB_TOKEN ?? fileConfig.github.token,
      owner,
      ownerType: env.GITHUB_OWNER_TYPE ?? fileConfig.github.ownerType,
      lookbackHours:
        env.REPORT_LOOKBACK_HOURS ?? fileConfig.github.lookbackHours,
      perPage: env.GITHUB_PER_PAGE ?? fileConfig.github.perPage,
      maxPages: env.GITHUB_MAX_PAGES ?? fileConfig.github.maxPages,
      allowlist,
      blocklist,
      includePrivate: resolveBool(
        env.INCLUDE_PRIVATE,
        fileConfig.github.includePrivate
      ),
    },
    output: {
      format: env.OUTPUT_FORMAT ?? fileConfig.output.format,
      schemaJson: env.OUTPUT_SCHEMA_JSON ?? fileConfig.output.schemaJson,
      prefix: env.OUTPUT_PREFIX ?? fileConfig.output.prefix,
      validateSchema: resolveBool(
        env.OUTPUT_VALIDATE_SCHEMA,
        fileConfig.output.validateSchema
      ),
    },
    report: {
      includeInactiveRepos: resolveBool(
        env.INCLUDE_INACTIVE_REPOS,
        fileConfig.report.includeInactiveRepos
      ),
      maxCommitsPerRepo:
        env.MAX_COMMITS_PER_REPO ?? fileConfig.report.maxCommitsPerRepo,
      maxRepos: env.MAX_REPOS ?? fileConfig.report.maxRepos,
      maxTotalCommits:
        env.MAX_TOTAL_COMMITS ?? fileConfig.report.maxTotalCommits,
      maxTokensHint: env.MAX_TOKENS_HINT ?? fileConfig.report.maxTokensHint,
      idempotentKey:
        env.REPORT_IDEMPOTENT_KEY ?? fileConfig.report.idempotentKey,
      templates: resolveList(env.REPORT_TEMPLATES, fileConfig.report.templates),
    },
    llm: {
      apiKey,
      model: env.GEMINI_MODEL ?? fileConfig.llm.model,
      promptTemplate: env.PROMPT_TEMPLATE ?? fileConfig.llm.promptTemplate,
    },
    storage: {
      type: env.BUCKET_TYPE ?? fileConfig.storage.type,
      uri: env.BUCKET_URI ?? fileConfig.storage.uri,
      region: env.BUCKET_REGION ?? fileConfig.storage.region,
      accessKeyId: env.BUCKET_ACCESS_KEY_ID ?? fileConfig.storage.accessKeyId,
      secretAccessKey:
        env.BUCKET_SECRET_ACCESS_KEY ?? fileConfig.storage.secretAccessKey,
    },
    webhook: {
      url: env.WEBHOOK_URL ?? fileConfig.webhook.url,
      secret: env.WEBHOOK_SECRET ?? fileConfig.webhook.secret,
    },
    network: {
      retryCount: env.RETRY_COUNT ?? fileConfig.network.retryCount,
      retryBackoffMs: env.RETRY_BACKOFF_MS ?? fileConfig.network.retryBackoffMs,
    },
    logging: {
      level: env.LOG_LEVEL ?? fileConfig.logging.level,
      includeTimings: resolveBool(
        env.LOG_INCLUDE_TIMINGS,
        fileConfig.logging.includeTimings
      ),
      format: env.LOG_FORMAT ?? fileConfig.logging.format,
      color: resolveBool(env.LOG_COLOR, fileConfig.logging.color),
      timeZone: env.LOG_TIMEZONE ?? fileConfig.logging.timeZone,
      contextMaxBytes:
        env.LOG_CONTEXT_MAX_BYTES ?? fileConfig.logging.contextMaxBytes,
    },
    context: fileConfig.context,
  };
}

export const fileConfigSchema = z.object({
  github: z
    .object({
      token: z.string().optional(),
      owner: z.string().optional(),
      ownerType: z.enum(["user", "org"]).default("user"),
      lookbackHours: z.coerce.number().int().positive().default(24),
      perPage: z.coerce.number().int().positive().default(100),
      maxPages: z.coerce.number().int().positive().default(5),
      allowlist: z.array(z.string()).default([]),
      blocklist: z.array(z.string()).default([]),
      includePrivate: z.boolean().default(false),
    })
    .default({}),
  output: z
    .object({
      format: z.enum(["markdown", "json"]).default("markdown"),
      schemaJson: z.string().optional(),
      prefix: z.string().default("reports"),
      validateSchema: z.boolean().default(false),
    })
    .default({}),
  report: z
    .object({
      includeInactiveRepos: z.boolean().default(false),
      maxCommitsPerRepo: z.coerce.number().int().positive().optional(),
      maxRepos: z.coerce.number().int().positive().default(100),
      maxTotalCommits: z.coerce.number().int().positive().default(1000),
      maxTokensHint: z.coerce.number().int().positive().optional(),
      idempotentKey: z.string().optional(),
      templates: z.array(z.string()).default([]),
    })
    .default({}),
  llm: z
    .object({
      apiKey: z.string().optional(),
      model: z.string().default("gemini-3-flash-preview"),
      promptTemplate: z.string().optional(),
    })
    .default({}),
  storage: z
    .object({
      type: z.string().default("local"),
      uri: z.string().optional(),
      region: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
    })
    .default({}),
  network: z
    .object({
      retryCount: z.coerce.number().int().nonnegative().default(2),
      retryBackoffMs: z.coerce.number().int().positive().default(500),
    })
    .default({}),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      includeTimings: z.boolean().default(false),
      format: z.enum(["json", "pretty"]).default("json"),
      color: z.boolean().default(false),
      timeZone: z.string().optional(),
      contextMaxBytes: z.coerce.number().int().positive().default(4000),
    })
    .default({}),
  webhook: z
    .object({
      url: z.string().optional(),
      secret: z.string().optional(),
    })
    .default({}),
  context: z
    .object({
      includeReadme: z.boolean().default(true),
      includeLlmTxt: z.boolean().default(true),
      includeRepoDescription: z.boolean().default(true),
      includeRepoTopics: z.boolean().default(false),
      includeDiffSummary: z.boolean().default(true),
      includeDiffSnippets: z.boolean().default(false),
      maxReadmeBytes: z.coerce.number().int().positive().default(12000),
      maxLlmTxtBytes: z.coerce.number().int().positive().default(8000),
      maxDiffFilesPerCommit: z.coerce.number().int().positive().default(20),
      maxDiffCommitsPerRepo: z.coerce.number().int().positive().default(10),
      maxSnippetCommitsPerRepo: z.coerce.number().int().positive().default(5),
      maxSnippetFilesPerCommit: z.coerce.number().int().positive().default(3),
      maxSnippetLinesPerFile: z.coerce.number().int().positive().default(40),
      maxSnippetBytesPerRepo: z.coerce.number().int().positive().default(8000),
      ignoreExtensions: z.array(z.string()).default([]),
    })
    .default({}),
});

export type ConfigFile = z.infer<typeof fileConfigSchema>;

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
