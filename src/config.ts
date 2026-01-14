import "dotenv/config";
import { z } from "zod";
import { defaultConfig } from "../config.defaults.js";

const truthy = new Set(["true", "1", "yes"]);

const envSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_OWNER_TYPE: z.enum(["user", "org"]).optional(),
  GITHUB_PER_PAGE: z.coerce.number().int().positive().optional(),
  GITHUB_MAX_PAGES: z.coerce.number().int().positive().optional(),
  INCLUDE_PRIVATE: z.string().optional(),

  OUTPUT_FORMAT: z.enum(["markdown", "json"]).optional(),
  OUTPUT_SCHEMA_JSON: z.string().optional(),
  OUTPUT_PREFIX: z.string().optional(),
  TIMEZONE: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),

  BUCKET_TYPE: z.string().optional(),
  BUCKET_URI: z.string().optional(),
  BUCKET_NAME: z.string().optional(),
  BUCKET_REGION: z.string().optional(),
  BUCKET_ENDPOINT: z.string().optional(),
  BUCKET_FORCE_PATH_STYLE: z.string().optional(),
  BUCKET_ACCESS_KEY_ID: z.string().optional(),
  BUCKET_SECRET_ACCESS_KEY: z.string().optional(),

  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  SLACK_TOKEN: z.string().optional(),
  SLACK_CHANNEL: z.string().optional(),
  RETRY_COUNT: z.coerce.number().int().nonnegative().optional(),
  RETRY_BACKOFF_MS: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  LOG_INCLUDE_TIMINGS: z.string().optional(),
  LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
  LOG_COLOR: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const fileConfig = fileConfigSchema.parse(defaultConfig);
  
  const apiKey = env.GEMINI_API_KEY ?? fileConfig.llm.apiKey;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY (env or config.defaults.ts).");
  }
  
  const storage = {
    type: env.BUCKET_TYPE ?? fileConfig.storage.type,
    bucket: resolveBucketName(env, fileConfig.storage.bucket),
    region: env.BUCKET_REGION ?? fileConfig.storage.region,
    endpoint: env.BUCKET_ENDPOINT ?? fileConfig.storage.endpoint,
    forcePathStyle: resolveBool(
      env.BUCKET_FORCE_PATH_STYLE,
      fileConfig.storage.forcePathStyle
    ),
    accessKeyId: env.BUCKET_ACCESS_KEY_ID ?? fileConfig.storage.accessKeyId,
    secretAccessKey:
      env.BUCKET_SECRET_ACCESS_KEY ?? fileConfig.storage.secretAccessKey,
  };

  if (storage.type === "s3" && !storage.bucket) {
    throw new Error("Missing BUCKET_NAME/BUCKET_URI for S3 storage.");
  }

  return {
    github: {
      token: env.GITHUB_TOKEN ?? fileConfig.github.token,
      owner: env.GITHUB_OWNER ?? fileConfig.github.owner ?? "",
      ownerType: env.GITHUB_OWNER_TYPE ?? fileConfig.github.ownerType,
      perPage: env.GITHUB_PER_PAGE ?? fileConfig.github.perPage,
      maxPages: env.GITHUB_MAX_PAGES ?? fileConfig.github.maxPages,
      includePrivate: resolveBool(
        env.INCLUDE_PRIVATE,
        fileConfig.github.includePrivate
      ),
    },
    output: {
      format: env.OUTPUT_FORMAT ?? fileConfig.output.format,
      schemaJson: env.OUTPUT_SCHEMA_JSON ?? fileConfig.output.schemaJson,
      prefix: env.OUTPUT_PREFIX ?? fileConfig.output.prefix,
    },
    llm: {
      apiKey,
      model: env.GEMINI_MODEL ?? fileConfig.llm.model,
    },
    storage,
    webhook: {
      url: env.WEBHOOK_URL ?? fileConfig.webhook.url,
      secret: env.WEBHOOK_SECRET ?? fileConfig.webhook.secret,
      token: env.SLACK_TOKEN ?? fileConfig.webhook.token,
      channel: env.SLACK_CHANNEL ?? fileConfig.webhook.channel,
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
      timeZone: env.TIMEZONE ?? fileConfig.logging.timeZone,
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
      perPage: z.coerce.number().int().positive().default(100),
      maxPages: z.coerce.number().int().positive().default(5),
      includePrivate: z.boolean().default(false),
    })
    .default({}),
  output: z
    .object({
      format: z.enum(["markdown", "json"]).default("markdown"),
      schemaJson: z.string().optional(),
      prefix: z.string().default("reports"),
    })
    .default({}),
  llm: z
    .object({
      apiKey: z.string().optional(),
      model: z.string().default("gemini-3-flash-preview"),
    })
    .default({}),
  storage: z
    .object({
      type: z.string().default("local"),
      bucket: z.string().optional(),
      region: z.string().optional(),
      endpoint: z.string().optional(),
      forcePathStyle: z.boolean().default(false),
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
    })
    .default({}),
  webhook: z
    .object({
      url: z.string().optional(),
      secret: z.string().optional(),
      token: z.string().optional(),
      channel: z.string().optional(),
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
      includePullRequests: z.boolean().default(false),
      includePullRequestDetails: z.boolean().default(false),
      includeIssues: z.boolean().default(false),
      maxReadmeBytes: z.coerce.number().int().positive().default(12000),
      maxLlmTxtBytes: z.coerce.number().int().positive().default(8000),
      maxDiffFilesPerCommit: z.coerce.number().int().positive().default(20),
      maxDiffCommitsPerRepo: z.coerce.number().int().positive().default(10),
      maxSnippetCommitsPerRepo: z.coerce.number().int().positive().default(5),
      maxSnippetFilesPerCommit: z.coerce.number().int().positive().default(3),
      maxSnippetLinesPerFile: z.coerce.number().int().positive().default(40),
      maxSnippetBytesPerRepo: z.coerce.number().int().positive().default(8000),
      maxPullRequestsPerRepo: z.coerce.number().int().positive().default(20),
      maxIssuesPerRepo: z.coerce.number().int().positive().default(20),
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

function resolveBucketName(
  env: { BUCKET_NAME?: string; BUCKET_URI?: string },
  fallback?: string
) {
  if (env.BUCKET_NAME) return env.BUCKET_NAME;
  if (env.BUCKET_URI) return stripBucketScheme(env.BUCKET_URI);
  return fallback;
}

function stripBucketScheme(value: string) {
  return value.replace(/^s3:\/\//, "");
}
