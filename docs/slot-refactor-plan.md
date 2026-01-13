# Slot-Based Refactor Plan

## Goal
Move to a deterministic, slot-based architecture where all reports are generated and indexed by discrete time slots (hourly/daily/weekly/monthly/yearly). This replaces the current “continuous window” approach and makes output predictable, backfill reliable, and the viewer intuitive.

---

## Core Paradigm
- Time is sliced into discrete slots.
- A report is tied to a slot end (the scheduled execution time).
- A report window is `[slotStart, slotEnd]`, derived from the slot type.
- All storage keys, index entries, and viewer grouping use `slotKey` or `scheduledAt`.
- All scheduling and viewer display use a single fixed time zone (Europe/Ljubljana).

---

## Slot Definitions
- Hourly: slot end = `YYYY-MM-DDTHH:00` (local TZ), window = previous hour.
- Daily: slot end = next day at `00:00` (local TZ), window = previous day.
- Weekly: slot end = Monday `00:00` (local TZ), window = previous 7 days (week ends Sunday 23:59:59).
- Monthly: slot end = first day of next month `00:00`.
- Yearly: slot end = Jan 1 next year `00:00`.

---

## Data Model Changes
### Manifest
Add:
- `scheduledAt` (ISO, UTC recommended)
- `slotKey` (timezone-stable key string)
- `slotType` (hourly/daily/weekly/monthly/yearly)
- `timeZone` (Europe/Ljubljana)

Keep:
- `window.start`, `window.end` (computed from slot)

### Index Entries
Replace:
- `start`, `end` (still present but derived)

With:
- `slotKey`, `scheduledAt`, `slotType`

---

## Storage Key Strategy
Change report path to include `slotKey` (deterministic):
```
{prefix}/{ownerType}/{owner}/jobs/{jobId}/{slotKey}/...
```

---

## Scheduling & Window Generation
Replace `buildWindows()` with:
- `listSlots()` — enumerates slots based on schedule + backfill
- `resolveSlotForNow()` — determines current slot key for run
- `windowFromSlot()` — derives window start/end from slot

---

## Backfill Behavior
Backfill operates over slots, not time ranges:
- `backfillSlots: N` — generate N previous slots
- Backfill is deterministic: same slots every run
- No drifting based on runtime

---

## Viewer Changes
### Calendar
- Use `scheduledAt` / `slotKey` for grouping.
- Show entries on the slot end day.
- Weekly reports appear on Sunday (end of week), not on week start.
- Render dates in the fixed time zone (Europe/Ljubljana), not the browser TZ.

### Content
- Stats template renders a chart (JSON → visualization).
- Daily/weekly render markdown as today.

---

## Config Simplification
Remove:
- `github.lookbackHours`
- `windowHours`, `windowDays`, arbitrary backfill ranges
- `backfillStart`, `backfillEnd`
- Any custom window settings
- `output.validateSchema`
- `logging.contextMaxBytes`
- `llm.promptTemplate` (move prompts into templates)

Replace with:
- `schedule: hourly | daily | weekly | monthly | yearly`
- `backfillSlots: number`
- `onEmpty: skip | manifest-only`
- `templates: []`
- `mode: pipeline | aggregate | stats`

Example minimal job config:
```ts
{
  id: "daily",
  mode: "pipeline",
  schedule: "daily",
  templates: ["dev-diary", "changelog", "twitter"],
  backfillSlots: 0
}
```

---

## Env Simplification
Remove:
- `REPORT_WINDOW_DAYS`
- `BACKFILL_START`, `BACKFILL_END`
- `BACKFILL_WINDOWS`

Add:
- `BACKFILL_SLOTS`
- `RUN_SCHEDULED_ONLY`
- `JOBS_ENABLED`

---

## Edge Cases / Things to be Careful About
- Timezone correctness: slot calculations and viewer display must use Europe/Ljubljana.
- DST transitions: hour slots can skip or repeat; define consistent mapping.
- Idempotency: slotKey must fully prevent duplicates.
- Weekly alignment: confirm week ends Sunday at 23:59:59 local.
- Monthly/yearly boundaries: handle month lengths cleanly.

---

## Refactor Steps (Suggested Order)
1. Add slot helpers (`slotKey`, `scheduledAt`, `windowFromSlot`).
2. Replace window generation with slot enumeration.
3. Update manifest + index schema.
4. Update storage paths to slotKey.
5. Update viewer grouping to slotKey/scheduledAt.
6. Update stats rendering to chart.
7. Remove old config + env options.
8. Delete old data and regenerate.

---

## Remove/Replace in Code
- `config.defaults.ts`: remove `github.lookbackHours`, `output.validateSchema`, `logging.contextMaxBytes`, `llm.promptTemplate`.
- `src/config.ts`: remove env plumbing for `REPORT_LOOKBACK_HOURS`, `PROMPT_TEMPLATE`, `LOG_CONTEXT_MAX_BYTES`, `OUTPUT_VALIDATE_SCHEMA`.
- `jobs.defaults.ts`: replace `windowDays`, `windowHours`, `backfillWindows` with `schedule` and `backfillSlots`.
- `src/jobs.ts`: remove `windowDays`, `windowHours`, `backfillWindows`, `backfillStart`, `backfillEnd` and env overrides; replace with `schedule` + `backfillSlots`.
- `src/index.ts`: delete `buildWindows`, `resolveWindowDays`, `parseDateOnly`, and backfill window logic; replace with slot enumeration helpers.
- `src/manifest.ts`: remove `windowDays`/`windowHours` from `JobRegistryItem` and related calculations; store `schedule`/`slotType` instead.
- `src/generator.ts`: remove `promptTemplate` and `validateSchema` options if templates fully define outputs.
- `examples/viewer/src/components/report-viewer/context.tsx`: remove `windowDays`/`windowHours` fields from schemas and any logic that assumes them.
