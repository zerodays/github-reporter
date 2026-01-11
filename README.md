# GitHub Reporter

Self-hostable microservice that generates daily GitHub activity reports (markdown or JSON) using an LLM and stores them in your own bucket.

## Quick start

1. Copy `.env.example` to `.env` and fill in values.
2. (Optional) Adjust defaults in `config.defaults.ts`.
3. Install deps: `npm install`
4. Run once: `npm run dev`

## Config priority

Values are loaded from `config.defaults.ts` first, and environment variables override them when set.

## Context enrichment

Enable/disable README, llm.txt, repo metadata, diff summaries, and diff snippets in `config.defaults.ts` under `context`.

## Templates

Configure `report.templates` in `config.defaults.ts` to generate multiple outputs (e.g., `dev-diary`, `changelog`, `twitter`). Use `REPORT_TEMPLATES` env to override.

## Backfill

Set `BACKFILL_DAYS` (e.g., `7`) or `BACKFILL_START`/`BACKFILL_END` (`YYYY-MM-DD`) to generate historical daily reports.

## Window size

Set `REPORT_WINDOW_DAYS` to control the report window length (e.g., `7` for weekly, `30` for monthly-ish).

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
