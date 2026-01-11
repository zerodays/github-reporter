# GitHub Reporter

GitHub Reporter is a self-hostable microservice that turns GitHub activity into automated reports using LLMs. It supports individuals and organizations, multiple scheduled jobs, optional webhooks, and storage in local files or S3/R2 buckets.

Typical uses:
- Daily dev diaries and changelogs for a personal profile.
- Weekly team progress summaries derived from daily outputs.
- Hourly stats JSON for dashboards and office displays.

## Why this exists

Keeping consistent updates is hard. This service pulls activity from GitHub, enriches it with context (README, diffs, PRs, issues), and generates clean, readable summaries on a schedule. For teams, it can aggregate daily outputs into a weekly narrative without re-reading GitHub.

## Features

- Multi-job runner (daily, weekly, hourly, etc.)
- LLM-driven templates (markdown or JSON)
- Aggregation jobs (weekly summaries from daily reports)
- Stats-only jobs (deterministic JSON, no LLM)
- Optional webhook callbacks
- Local or S3/R2 storage
- Example viewer app in `examples/viewer`

## Quick start

1. Copy `.env.example` to `.env` and fill in values.
2. (Optional) Adjust `config.defaults.ts` and `jobs.defaults.ts`.
3. Install deps: `pnpm install`
4. Run once: `pnpm dev`

## How it works

1. Fetch activity for a time window (commits, PRs, issues).
2. Enrich context (README, llm.txt, diff summaries/snippets).
3. Generate one or more outputs per job.
4. Write artifacts + manifest + indices to storage.
5. Optionally call a webhook with the result.

## Config model

- Global defaults live in `config.defaults.ts`.
- Job definitions live in `jobs.defaults.ts`.
- Environment variables override defaults for the default job unless `JOBS_ENABLED` is set.

## Example defaults (annotated)

### `config.defaults.ts` (global config)

```ts
export const defaultConfig = {
  github: {
    ownerType: "user",
    lookbackHours: 24,
    perPage: 100,
    maxPages: 5,
    allowlist: [],
    blocklist: [],
    includePrivate: false
  },
  output: {
    format: "markdown",
    prefix: "reports",
    validateSchema: false
  },
  llm: {
    model: "gemini-3-flash-preview",
    promptTemplate: "You are a helpful reporter that summarizes GitHub activity."
  },
  storage: {
    type: "local",
    bucket: "",
    region: "",
    endpoint: "",
    forcePathStyle: false
  },
  network: {
    retryCount: 2,
    retryBackoffMs: 500
  },
  logging: {
    level: "info",
    includeTimings: true,
    format: "pretty",
    color: true,
    timeZone: "Europe/Ljubljana",
    contextMaxBytes: 4000
  },
  webhook: {},
  context: {
    includeReadme: true,
    includeLlmTxt: true,
    includeRepoDescription: true,
    includeRepoTopics: true,
    includeDiffSummary: true,
    includeDiffSnippets: true,
    includePullRequests: true,
    includePullRequestDetails: false,
    includeIssues: true,
    maxReadmeBytes: 36000,
    maxLlmTxtBytes: 24000,
    maxDiffFilesPerCommit: 60,
    maxDiffCommitsPerRepo: 30,
    maxSnippetCommitsPerRepo: 15,
    maxSnippetFilesPerCommit: 15,
    maxSnippetLinesPerFile: 200,
    maxSnippetBytesPerRepo: 60000,
    maxPullRequestsPerRepo: 60,
    maxIssuesPerRepo: 60,
    ignoreExtensions: [".lock", ".min.js", ".png"]
  }
};
```

- `github.ownerType`: `user` or `org` for the default owner scope.
- `github.lookbackHours`: fallback window size when no explicit window is set.
- `github.perPage`: GitHub API page size.
- `github.maxPages`: max pages to fetch per list.
- `github.allowlist`: only include these repo names (empty = all).
- `github.blocklist`: exclude these repo names.
- `github.includePrivate`: include private repos when token allows.
- `output.format`: `markdown` or `json` for artifacts.
- `output.prefix`: storage key prefix (folder).
- `output.validateSchema`: validate JSON output against schema if provided.
- `llm.model`: Gemini model name.
- `llm.promptTemplate`: base prompt used by templates.
- `storage.type`: `local` or `s3`.
- `storage.bucket`: S3/R2 bucket name (empty for local).
- `storage.region`: AWS region or `auto` for R2.
- `storage.endpoint`: custom endpoint (R2 uses full URL).
- `storage.forcePathStyle`: S3 path-style URLs (required for some R2 setups).
- `network.retryCount`: retry attempts for GitHub/LLM/webhook.
- `network.retryBackoffMs`: backoff delay between retries.
- `logging.level`: `debug|info|warn|error`.
- `logging.includeTimings`: include durationMs in logs when available.
- `logging.format`: `json` or `pretty`.
- `logging.color`: colorize pretty logs.
- `logging.timeZone`: timezone used for windows, ids, and logs.
- `logging.contextMaxBytes`: max bytes shown in context log snapshot.
- `webhook`: optional `{ url, secret }` for callbacks.
- `context.includeReadme`: include README in LLM context.
- `context.includeLlmTxt`: include `llm.txt` if present.
- `context.includeRepoDescription`: include repo description.
- `context.includeRepoTopics`: include repo topics/tags.
- `context.includeDiffSummary`: include per-commit diff summaries.
- `context.includeDiffSnippets`: include small code snippets.
- `context.includePullRequests`: include PR list in context.
- `context.includePullRequestDetails`: include PR body/reviews (extra API calls).
- `context.includeIssues`: include issues list in context.
- `context.maxReadmeBytes`: cap README bytes.
- `context.maxLlmTxtBytes`: cap llm.txt bytes.
- `context.maxDiffFilesPerCommit`: cap diff files in summary.
- `context.maxDiffCommitsPerRepo`: cap commits with diffs per repo.
- `context.maxSnippetCommitsPerRepo`: cap commits with snippets per repo.
- `context.maxSnippetFilesPerCommit`: cap files per commit for snippets.
- `context.maxSnippetLinesPerFile`: cap lines per snippet file.
- `context.maxSnippetBytesPerRepo`: cap snippet bytes per repo.
- `context.maxPullRequestsPerRepo`: cap PRs per repo.
- `context.maxIssuesPerRepo`: cap issues per repo.
- `context.ignoreExtensions`: file extensions excluded from snippets.

### `jobs.defaults.ts` (job config)

```ts
export const defaultJobs = {
  jobs: [
    {
      id: "daily",
      name: "Daily activity",
      description: "Daily report for a single owner.",
      mode: "pipeline",
      windowDays: 1,
      templates: ["dev-diary", "changelog", "twitter"],
      includeInactiveRepos: false,
      maxCommitsPerRepo: 50,
      maxRepos: 100,
      maxTotalCommits: 1000,
      maxTokensHint: 1200,
      onEmpty: "manifest-only",
      backfillWindows: 0,
      schedule: { type: "daily", hour: 0, minute: 0 }
    },
    {
      id: "weekly-summary",
      name: "Weekly summary",
      description: "Weekly aggregate summary derived from daily reports.",
      mode: "aggregate",
      windowDays: 7,
      templates: ["weekly-summary"],
      includeInactiveRepos: false,
      backfillWindows: 0,
      onEmpty: "manifest-only",
      aggregation: {
        sourceJobId: "daily",
        sourceTemplateId: "changelog",
        maxBytesPerItem: 12000,
        maxTotalBytes: 60000
      },
      schedule: { type: "weekly", weekday: 0, hour: 0, minute: 0 }
    },
    {
      id: "hourly-stats",
      name: "Hourly stats",
      description: "Hourly activity stats for dashboards.",
      mode: "stats",
      windowHours: 1,
      templates: [],
      includeInactiveRepos: true,
      maxCommitsPerRepo: 20,
      maxTotalCommits: 200,
      backfillWindows: 0,
      onEmpty: "manifest-only",
      contextProviders: [],
      schedule: { type: "hourly", minute: 0 }
    }
  ]
};
```

- `id`: stable job identifier used in storage paths and indices.
- `name`: display label for logs and viewer.
- `description`: human-readable job purpose.
- `mode`: `pipeline` (LLM), `aggregate` (LLM from stored artifacts), `stats` (JSON only).
- `windowDays`: report window size in days (pipeline/aggregate).
- `windowHours`: report window size in hours (stats).
- `templates`: template IDs to generate for this job.
- `includeInactiveRepos`: include repos with no activity.
- `maxCommitsPerRepo`: cap commits fetched per repo.
- `maxRepos`: cap repos processed for the window.
- `maxTotalCommits`: hard cap on total commits across repos.
- `maxTokensHint`: hint for LLM output length.
- `onEmpty`: `manifest-only`, `placeholder`, or `skip`.
- `backfillWindows`: number of past windows to run on start.
- `contextProviders`: override context providers (empty array disables).
- `aggregation.sourceJobId`: job ID to pull source artifacts from.
- `aggregation.sourceTemplateId`: template ID to aggregate (e.g., `changelog`).
- `aggregation.maxBytesPerItem`: cap per-day artifact bytes.
- `aggregation.maxTotalBytes`: cap total bytes sent to LLM.
- `schedule.type`: `hourly`, `daily`, or `weekly`.
- `schedule.minute`: minute of the hour to run.
- `schedule.hour`: hour (0-23) for daily/weekly schedules.
- `schedule.weekday`: day of week for weekly (0=Sunday).

## Scheduling (Railway cron)

Recommended setup is a single external cron (e.g., hourly) with internal scheduling enabled. Each job has a `schedule` in `jobs.defaults.ts`, and the runner skips jobs that are not due.

1. Deploy the repo on Railway.
2. Set environment variables from `.env.example`.
3. Create a Cron job:
   - Command: `pnpm dev`
   - Schedule: `0 * * * *` (hourly)
4. Keep `RUN_SCHEDULED_ONLY=true` so jobs run only when due.

This single cron triggers all jobs on their own schedules (hourly/daily/weekly).

## Storage

Artifacts are written under:
`{output.prefix}/{ownerType}/{owner}/jobs/{jobId}/{start}__{end}/`

Indexes are written under:
`{output.prefix}/_index/{ownerType}/{owner}/{jobId}/`

Storage can be:
- Local filesystem (`storage.type=local`)
- S3/R2 bucket (`storage.type=s3`)

### S3/R2 config

Set `BUCKET_TYPE=s3`, plus:
`BUCKET_NAME` (or `BUCKET_URI`), `BUCKET_REGION`, `BUCKET_ENDPOINT` (for R2), and `BUCKET_FORCE_PATH_STYLE=true` if needed.

## Webhook

Set `WEBHOOK_URL` (and optionally `WEBHOOK_SECRET`) to receive callbacks when artifacts are written.

## Example viewer

`examples/viewer` is a Next.js app that renders stored reports and histories. It reads from your bucket via a server-side proxy and supports job browsing and history pagination.

## Local setup (personal GitHub)

1. Create a GitHub token: Settings → Developer settings → Personal access tokens.
2. Choose scopes: public only = no extra scopes; private repos = `repo`.
3. Create a Gemini API key in Google AI Studio.
4. Set `.env` values:

```ini
GITHUB_OWNER=your_github_username
GITHUB_OWNER_TYPE=user
GITHUB_TOKEN=ghp_...
GEMINI_API_KEY=...
OUTPUT_FORMAT=markdown
REPO_ALLOWLIST=repo1,repo2
INCLUDE_PRIVATE=false
```

5. Run: `pnpm install` then `pnpm dev`.
6. Output appears in `out/reports/`.

## Health & smoke tests

- `pnpm health` validates config, storage, and GitHub access.
- `pnpm smoke` runs health checks and logs schedule decisions without writing artifacts.

## Notes

- Designed for self-hosting (Railway, containers, etc.)
- Private repos are supported with a token
