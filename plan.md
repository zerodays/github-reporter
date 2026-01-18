# GitHub Reporter CLI Plan

## Goals
- Provide a professional, modern, simple CLI for manual operation.
- Use the same pipeline code path as scheduled runs.
- Support safe re-runs (replace only after success) and deletions.
- Make storage browsing and stats discoverable and friendly.
- Document the CLI so it is easy for humans and LLMs to use.

## Decisions (Locked)
- Notifications only when `--notify` is passed.
- Single intended time selector for running: `--at <ISO|YYYY-MM-DD>`.
- Replace behavior: run new job first, replace old run only on success.
- Invocation: `pnpm reporter` (not a global binary).
- Rerun failures do not write a failed manifest; preserve existing run.

## CLI UX (High-Level)
Command layout (single entrypoint with subcommands):

- `reporter run`
  - Runs a job for the slot resolved from `--at`.
  - `--job <id>` (required unless `--all`)
  - `--at <date|datetime>` (required)
  - `--notify` (optional)
  - `--json` (machine output)

- `reporter rerun`
  - Same as `run`, but replaces an existing slot after success.
  - `--job <id>` + `--at <date|datetime>` (required)
  - `--notify` (optional)
  - `--json`

- `reporter delete`
  - Deletes a specific slot and updates indexes.
  - `--job <id>` + `--at <date|datetime>` (required)
  - `--yes` (required to execute)
  - `--json`

- `reporter list`
  - `reporter list owners`
  - `reporter list jobs --owner <owner> --owner-type <user|org>`
  - `reporter list runs --owner <owner> --owner-type <user|org> --job <id> --window <start..end>`
  - `--json` for machine output

- `reporter stats`
  - Aggregated stats for a window.
  - `--owner <owner> --owner-type <user|org> [--job <id>] --window <start..end>`
  - `--json`

## Time Selection Semantics
- `--at` resolves the slot using the job schedule and configured timezone.
- Accepts:
  - Full ISO (with timezone) for precise selection.
  - Date-only (`YYYY-MM-DD`) interpreted in the configured timezone.
- Implementation: `resolveSlotForAt(job, at, timeZone)` which derives the correct slot key/window using existing slot helpers.

## Bridge/Refactor Work (Shared Runner API)
Create a small runner API so CLI and scheduled runs share code cleanly:

- `src/runner/run-job.ts`
  - `runJobForSlot(job, slot, { config, storage, notify }) -> RunResult`
  - `RunResult` includes `status`, `durationMs`, `slotKey`, `outputUri`, `manifestKey`.
  - Sets `notify` so webhooks/Slack run only when requested.

- `src/runner/slots.ts`
  - `resolveSlotForAt(job, at, timeZone)`
  - Centralized date parsing and slot resolution.

- `src/storage-index.ts`
  - Read and write helpers for:
    - `jobs.json`
    - `{YYYY-MM}.json` monthly indexes
    - `latest.json`
  - Recalc latest after deletions or reruns.

- `src/storage-transaction.ts`
  - Wraps `StorageClient` to allow "buffered writes with read-through".
  - Commit writes only after successful run.
  - On replace: remove stale keys under `{prefix}/{ownerType}/{owner}/{jobId}/{slotKey}/` that are not in the new output set.

- `src/cli.ts`
  - CLI entrypoint (uses a command parser library like `commander`).
  - Maps subcommands to runner/index helpers.

Update `src/index.ts` to delegate to `runJobForSlot`, so scheduled runs and CLI share logic.

## Storage Listing Plan
Use storage indexes instead of full bucket scans:

- Owners:
  - List keys under `${prefix}/_index/` and find `jobs.json`.
- Jobs:
  - Read `jobs.json` to list jobs for an owner.
- Runs:
  - Read monthly indexes for a time window (using `loadIndexItemsForRange`).
  - Optionally fetch `manifest.json` for details (`--details` or on-demand).

Optional: allow `--prefix` override to target non-default storage roots (low effort).

## Stats Plan
Compute windowed stats using index items (fast) and optional manifest fetches (detail):

- Base stats from index items:
  - Run count, success/fail, total output bytes, slot coverage.
  - Totals from `metrics` when present (commits, prs, issues, repos, etc).
- Optional detailed stats:
  - Pull `durationMs` from manifest for averages/p95 (or add to summary/index).
  - Pull LLM usage (tokens/model) if available.

If performance is a concern, add `durationMs` to summary/index payload in a later step.

## Safety + UX
- All destructive actions require `--yes`.
- `rerun` never deletes old output unless the new run succeeds.
- `--json` output for automation; pretty tables by default for humans.
- Clear error messages when job/owner is missing or `--at` is invalid.

## Documentation
Add `docs/CLI.md`:
- Quickstart examples
- Command reference
- Output examples (`--json` vs human)
- Replace/delete safety rules
- Timezone and `--at` semantics

Update `README.md` to link `docs/CLI.md` and include a minimal CLI example.

## Phased Delivery (Completed)
1. ✅ Runner/slot refactor and `--notify` gating.
2. ✅ CLI skeleton with `run`, `rerun`, `delete`.
3. ✅ Listing commands wired to `_index` data.
4. ✅ Stats command for window aggregation.
5. ✅ Documentation and examples.

## Open Questions (If Needed Later)
- Confirm output format for list/stats (table vs JSON default).
- Decide whether to add `--details` to pull manifests for durations.
