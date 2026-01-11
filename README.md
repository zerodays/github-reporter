# GitHub Reporter

Self-hostable microservice that generates daily GitHub activity reports (markdown or JSON) using an LLM and stores them in your own bucket.

## Quick start

1. Copy `.env.example` to `.env` and fill in values.
2. (Optional) Adjust global defaults in `config.defaults.ts` and job defaults in `jobs.defaults.ts`.
3. Install deps: `npm install`
4. Run once: `npm run dev`

## Config priority

Values are loaded from `config.defaults.ts` and `jobs.defaults.ts` first. Environment variables override defaults for the default job unless `JOBS_ENABLED` is set.

## Context enrichment

Enable/disable README, llm.txt, repo metadata, diff summaries, diff snippets, PRs, and issues in `config.defaults.ts` under `context`.

## Templates

Configure templates per job in `jobs.defaults.ts` (e.g., `dev-diary`, `changelog`, `twitter`). Use `REPORT_TEMPLATES` env to override the default job.

## Jobs

Set `JOBS_ENABLED` to a comma-separated list of job IDs to run specific jobs (e.g., `daily,weekly-team`). If unset, all jobs in `jobs.defaults.ts` run and the `REPORT_*` env values override the default job.

## Scheduling

Recommended setup is a single external cron (e.g., hourly) with internal scheduling enabled. Each job has a `schedule` in `jobs.defaults.ts`, and the runner skips jobs that are not due.

To disable internal schedule gating and run every enabled job on every invocation, set `RUN_SCHEDULED_ONLY=false`.

## Backfill

Set `BACKFILL_WINDOWS` (e.g., `7`) or `BACKFILL_START`/`BACKFILL_END` (`YYYY-MM-DD`) to generate historical reports. `BACKFILL_WINDOWS` counts report windows, not days.

## Window size

Set `REPORT_WINDOW_DAYS` to control the report window length (e.g., `7` for weekly, `30` for monthly-ish). For hourly jobs, use `windowHours` in `jobs.defaults.ts`.

## Empty windows

Set `REPORT_ON_EMPTY` to control what happens when there is no activity: `manifest-only` (default), `placeholder`, or `skip`.

## Storage layout

Artifacts are written under `{output.prefix}/{ownerType}/{owner}/jobs/{jobId}/{start}__{end}/` with a `manifest.json` per window, plus indices under `{output.prefix}/_index/{ownerType}/{owner}/{jobId}/`.

## Storage config (S3/R2)

Set `BUCKET_TYPE=s3`, plus:
`BUCKET_NAME` (or `BUCKET_URI`), `BUCKET_REGION`, `BUCKET_ENDPOINT` (for R2), and `BUCKET_FORCE_PATH_STYLE=true` if needed.

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

5. Run: `npm install` then `npm run dev`.
6. Output appears in `out/reports/`.

## Logging

Logs are JSON lines (structured) so Railway and other log viewers can parse them cleanly.

## What it does (MVP)

- Pulls recent activity from selected repos
- Summarizes changes
- Generates a report via Gemini
- Writes the artifact to storage
- Optionally calls a webhook

## Notes

- Designed for self-hosting (Railway, containers, etc.)
- Private repos are supported with a token
