# Job Architecture Plan

## Goals
- Support multiple jobs per deployment (daily user, team daily, hourly stats, weekly summaries).
- Keep storage and viewer fully data-driven (no hardcoded job list).
- Maintain a single clean pipeline with zero legacy single-run code.
- Allow aggregation jobs that reuse stored manifests instead of re-fetching GitHub.

## Big Picture
1. Job configs define scope, window, templates, and mode.
2. Runner executes jobs (pipeline or aggregation) on a schedule.
3. Each job writes artifacts + manifest + indices under a job namespace.
4. Viewer discovers jobs via `jobs.json` and lists history per job.

## Config Split (Global vs Job)
Global config stays in `config.defaults.ts`:
- Credentials (GitHub, LLM, storage)
- Shared limits (rate limits, retries, logging)
- Context provider defaults (README/diff toggles, caps)

Job config moves to `jobs.defaults.ts`:
- Scope (owner/org, repo allowlist, author filters)
- Window size (days/hours)
- Templates + output format
- Idempotency + output namespace
- Mode (pipeline vs aggregate)

## Storage Layout (data-driven)
- Reports: `{prefix}/{ownerType}/{owner}/jobs/{jobId}/{start}__{end}/`
- Manifest: `.../manifest.json`
- Job indices: `{prefix}/_index/{ownerType}/{owner}/{jobId}/YYYY-MM.json`
- Job latest: `{prefix}/_index/{ownerType}/{owner}/{jobId}/latest.json`
- Job registry: `{prefix}/_index/{ownerType}/{owner}/jobs.json`
- Registry scope: per owner only (no global registry).

## Phase 1: Job Config + Runner (Implementation Details)
1. Add `jobs.defaults.ts` (typed) with standard jobs and descriptions.
2. Add `jobs.schema.ts` (zod) + `JOBS_ENABLED` env parsing.
3. Implement `runJob(jobConfig)` that:
   - Builds the window(s) for the job
   - Runs the existing pipeline per window
   - Writes artifacts + manifest + indices under job namespace
4. Implement `runJobs(jobList)` runner:
   - Filter enabled jobs
   - Log job start/end + failures
   - Continue on failure (configurable)
5. Replace single-run logic in `src/index.ts` with `runJobs`.

## Phase 2: Job-aware Storage + Indexing (Implementation Details)
1. Extend manifest to include `jobId`, `jobName`, `scope`, and `templates`.
2. Write `jobs.json` registry:
   - job id, name, description, windowDays, templates
   - updated on each job run
3. Make manifest/index paths job-aware:
   - `{prefix}/{ownerType}/{owner}/jobs/{jobId}/{start}__{end}/`
   - `{prefix}/_index/{ownerType}/{owner}/{jobId}/YYYY-MM.json`
4. Add idempotency per job+window:
   - skip if manifest exists for that job/window
5. Add `latest.json` per job.

## Phase 3: Aggregation Jobs (Implementation Details)
1. Implement `runAggregateJob(jobConfig)`:
   - load manifests for window from index files
   - fetch daily template artifacts (e.g., changelog)
   - concatenate into a structured weekly input (date headers)
   - run LLM to generate the weekly narrative
2. Add weekly team job that summarizes daily outputs:
   - uses the weekly LLM template
   - avoids GitHub API calls entirely
3. Add stats-only job:
   - JSON output for dashboards

## Phase 4: Org Features + Author Rollups (Implementation Details)
1. Author filters in job config (`authors`, `excludeAuthors`).
2. Per-user reports:
   - job templating for each author in org
3. Team rollups:
   - group by repo, rank by weighted score
4. Add PR/issue owner attribution in summaries.

## Cleanup Requirements
- No deprecated single-run code paths.
- Pipeline functions shared by all jobs.
- Configs and templates are job-scoped and discoverable.

## Limits & Safeguards
- Weekly aggregation caps: max bytes per day + max total bytes per job.
- Idempotency keys per job to prevent collisions (hourly/daily/weekly).
- Author mapping support for org jobs (aliases/emails).
- PR detail fetch disabled by default on org-scale jobs.
- Manifest write must succeed before index update.
- Viewer should handle empty indexes gracefully.
- Empty windows default to `manifest-only` (no placeholder artifacts).
- Define job identity stability: `jobId` immutable; add `jobVersion` for template/schema changes.
- Window semantics: timezone-aware boundaries with documented inclusivity (e.g., `[start, end)`).
- Job output contract: versioned manifest schema + required fields for viewer rendering.
- Add window `summary.json` for list views (title, templates, empty flag, bytes).
- Aggregation inputs: job config must specify canonical source template (e.g., `changelog`).
- Failure handling: write failed manifests (`status: failed`, error) so gaps are visible.
- Timezone handling: use a single timezone for windows, ids, dates, and logs.
- Org jobs: author normalization rules live in job config (aliases/emails).
- Redaction/allowlist: optional per-job path patterns to omit sensitive data.
- Performance caps: per-job context byte limits and provider allowlists.
