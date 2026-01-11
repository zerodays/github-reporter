# Plan

## Phase 1: MVP (single daily run)
1. Config + env validation (owner, token, output format, storage).
2. Fetch repo list and recent commits for the lookback window.
3. Generate report text with Gemini using a prompt template.
4. Store artifact (local first, then S3/GCS).
5. Optional webhook callback with artifact metadata.

## Phase 2: Robustness
1. Add backfill support for the last N days.
2. Add retry policy for GitHub and webhook calls.
3. Add rate-limit handling and pagination.
4. Add structured output validation when a JSON schema is provided.

## Phase 3: Org features
1. Org-wide summary mode (group report).
2. Optional per-user rollups by commit author.
3. Repo filters and team-based scopes.

## Phase 4: Context enrichment
1. Pull README / llm.txt / selected files for context.
2. Summarize diffs to reduce token usage.
3. Support multiple output templates per run (tweet, blog, ledger).
