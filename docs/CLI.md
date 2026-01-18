# GitHub Reporter CLI

The CLI provides manual control for running, rerunning, deleting, listing, and inspecting reports.

## Quick Start

```bash
pnpm reporter run --job daily-diary --at 2024-11-03
pnpm reporter run --job daily-diary --at 2024-11-03 --notify
```

## Time Selection (`--at`)

- `--at` is the single intended selector for runs and reruns.
- Accepts:
  - Full ISO timestamps with timezone (e.g. `2024-11-03T14:00:00Z`)
  - Date-only (`YYYY-MM-DD`) interpreted in the configured timezone
- For daily schedules, date-only selects that calendar day (24h window).

## Commands

### `reporter run`

Run a job for the slot resolved by `--at`.

```bash
pnpm reporter run --job daily-diary --at 2024-11-03
```

Options:
- `--notify` send webhooks/Slack (default off)
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output

### `reporter rerun`

Rerun a slot and replace it only after success. Failed reruns do not overwrite the existing run.

```bash
pnpm reporter rerun --job daily-diary --at 2024-11-03
```

Options:
- `--notify` send webhooks/Slack (default off)
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output

### `reporter delete`

Delete a run for a given slot and update indexes.

```bash
pnpm reporter delete --job daily-diary --at 2024-11-03 --yes
```

Options:
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output

### `reporter list`

List owners, jobs, and runs from storage indexes.

```bash
pnpm reporter list owners
pnpm reporter list jobs --owner my-org --owner-type org
pnpm reporter list runs --owner my-org --owner-type org --job daily-diary --window 2024-11-01..2024-11-30
pnpm reporter list periods --owner my-org --owner-type org --job daily-diary
```

Options:
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output
- `--latest` show only latest run (for `list runs`)

### `reporter stats`

Compute aggregate stats for a window (optionally across all jobs).

```bash
pnpm reporter stats --owner my-org --owner-type org --window 2024-11-01..2024-11-30
pnpm reporter stats --owner my-org --owner-type org --job daily-diary --window 2024-11-01..2024-11-30 --details
```

Options:
- `--job <id>` limit to a single job
- `--details` include duration/token usage (from index data)
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output

### `reporter show`

Show run contents for a window, including output previews.

```bash
pnpm reporter show --owner my-org --owner-type org --job daily-diary --window 2024-11-01..2024-11-30
pnpm reporter show --owner my-org --owner-type org --job daily-diary --window 2024-11-01..2024-11-30 --full
```

Options:
- `--limit <n>` limit number of runs (most recent)
- `--full` print full output instead of preview
- `--manifest` include full manifest JSON
- `--prefix <prefix>` override storage prefix
- `--json` machine-readable output

## Notes

- Storage is selected from `.env`/config. `--prefix` only changes the storage prefix.
- Notifications are opt-in; use `--notify` to send webhooks/Slack.
- `list` and `stats` do not require `GEMINI_API_KEY`.
