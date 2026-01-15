# Architecture Refactor Plan

## Goal

Transition `github-reporter` from a "Docker-style" configuration (complex env vars overriding internal defaults) to a "GitOps-style" configuration (TypeScript config file as the single source of truth).

This optimizes for the "Fork & Deploy" use case, where users maintain their own `jobs.config.ts` to define multiple reports, schedules, and teams.

---

## Core Decisions

1. **Architecture:** Keep **Reporter** (Cron) and **Viewer** (Web) as separate services within a single monorepo.
2. **Configuration:** Move all logic (Schedules, Prompts, Scopes) into `jobs.config.ts`.
3. **Secrets:** Keep all secrets (Tokens, Keys, Bucket URLs) in Environment Variables.
4. **Locality:** Prompts can be inline or referenced via `promptFile`.
5. **One Job = One Output:** Each job produces a single artifact (simplifies mental model, manifest, and viewer).
6. **Data Profiles:** Jobs declare a `dataProfile` to control what data is fetched (minimal, standard, full).

---

## Job Model

Each job is a self-contained unit that:

1. **Triggers** on a schedule (hourly, daily, weekly, monthly, yearly)
2. **Fetches** GitHub data based on `scope` and `dataProfile`
3. **Processes** data using one of three modes:
   - `pipeline` → LLM-generated output (markdown/JSON)
   - `aggregate` → Summarizes previous job outputs
   - `stats` → Deterministic statistics JSON
4. **Writes** a single artifact + manifest to storage

### Example Jobs Config

```ts
import type { JobsConfig } from "./src/jobs";

export const jobs: JobsConfig = {
  jobs: [
    {
      id: "slack-daily-changelog",
      name: "Daily Changelog",
      mode: "pipeline",
      dataProfile: "full",
      schedule: { type: "daily", hour: 0 },
      scope: { owner: "my-org", repos: ["api", "web"], authors: ["alice", "bob"] },
      prompt: "Write a developer-friendly changelog summarizing today's commits...",
      outputFormat: "markdown"
    },
    {
      id: "daily-stats",
      name: "Daily Stats",
      mode: "stats",
      dataProfile: "minimal",
      schedule: { type: "daily", hour: 0 },
      scope: { owner: "my-org" }
    },
    {
      id: "slack-weekly-summary",
      name: "Weekly Summary",
      mode: "aggregate",
      dataProfile: "minimal",
      schedule: { type: "weekly", weekday: 1, hour: 9 },
      scope: { owner: "my-org" },
      aggregation: {
        sourceJobId: "slack-daily-changelog",  // No more sourceTemplateId needed!
        maxDays: 7
      },
      promptFile: "./prompts/slack-weekly-summary.txt",
      outputFormat: "markdown"
    }
  ]
};
```

---

## Data Profiles

Jobs declare what data they need via `dataProfile`:

| Profile     | Commits      | PRs/Issues | Diff Stats | README/LLM.txt | Code Snippets |
|-------------|--------------|------------|------------|----------------|---------------|
| `minimal`   | metadata only | counts     | ❌          | ❌              | ❌             |
| `standard`  | full          | details    | summary    | ❌              | ❌             |
| `full`      | full          | details    | full       | ✅              | ✅             |

**Defaults:**
- `stats` mode → `minimal`
- `pipeline` mode → `standard`

This keeps the config simple while allowing optimization. Granular overrides (`dataOverrides`) can be added later if needed.

---

## Job Schema (Zod)

```ts
const jobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.enum(["pipeline", "aggregate", "stats"]).default("pipeline"),
  
  // Scheduling
  schedule: scheduleSchema,
  
  // Scope (per-job, no global allowlist)
  scope: z.object({
    owner: z.string(),
    ownerType: z.enum(["user", "org"]).default("user"),
    repos: z.array(z.string()).optional(),        // allowlist
    authors: z.array(z.string()).optional(),
    excludeAuthors: z.array(z.string()).optional(),
  }),
  
  // Data fetching
  dataProfile: z.enum(["minimal", "standard", "full"]).optional(),
  
  // Processing (for pipeline/aggregate modes)
  prompt: z.string().optional(),
  promptFile: z.string().optional(),  // path relative to config
  outputFormat: z.enum(["markdown", "json"]).default("markdown"),
  
  // Aggregation (for aggregate mode)
  aggregation: z.object({
    sourceJobId: z.string(),
    maxDays: z.number().optional(),
    maxBytes: z.number().optional(),
  }).optional(),
  
  // Output behavior
  onEmpty: z.enum(["placeholder", "manifest-only", "skip"]).default("manifest-only"),
  backfillSlots: z.number().int().nonnegative().default(0),
  
  // Per-job webhook (optional, falls back to global)
  webhook: z.object({
    url: z.string().url(),
    secret: z.string().optional(),
  }).optional(),
});
```

---

## Runner Architecture

### Separation of Concerns

| File | Responsibility |
|------|----------------|
| `scheduler.ts` | **When** to run — cron logic, checks schedules, triggers jobs |
| `runner.ts` | **How** to run — orchestrates fetch → process → write |
| `processors/` | Mode-specific logic |

### Processor Files

```
src/
├── scheduler.ts        # Iterates jobs, checks schedule, calls runner
├── runner.ts           # Entry point, dispatches by mode
├── processors/
│   ├── pipeline.ts     # LLM-based extraction
│   ├── aggregate.ts    # Weekly/monthly summary logic
│   └── stats.ts        # Deterministic stats computation
├── github/
│   └── fetcher.ts      # Data fetching with profiles
└── manifest.ts         # Writes manifest, index, registry
```

### Runner Flow

```ts
// runner.ts
export async function runJob(job: JobConfig) {
  const data = await fetchGitHubData(job.scope, job.dataProfile);
  
  switch (job.mode) {
    case "pipeline":
      return processPipeline(job, data);
    case "aggregate":
      return processAggregate(job);
    case "stats":
      return processStats(job, data);
  }
}
```

---

## Viewer Design

The viewer stays "dumb" — it doesn't know about job definitions, only manifests.

### Rendering Logic

| `manifest.job.mode` | `format` | Rendering |
|---------------------|----------|-----------|
| any | `markdown` | ReactMarkdown |
| `stats` | `json` | Charts (hardcoded stats schema) |
| other | `json` | Pretty JSON with syntax highlighting |

### Manifest Structure (Enhanced)

Each job produces one manifest with one artifact. New fields added for observability:

```ts
type ReportManifest = {
  schemaVersion: number;
  job: { id, name, mode, version? };
  status: "success" | "failed";
  error?: string;                    // Only when status === "failed"
  owner: string;
  ownerType: "user" | "org";
  scheduledAt: string;
  slotKey: string;
  slotType: "hourly" | "daily" | ...;
  window: { start, end, days, hours? };
  timezone?: string;
  empty?: boolean;
  
  // NEW: Observability fields
  generatedAt: string;               // When artifact was actually generated
  durationMs: number;                // How long the job took
  dataProfile: "minimal" | "standard" | "full";
  
  // NEW: LLM metadata (for pipeline/aggregate modes)
  llm?: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  
  // NEW: Aggregation source (for aggregate mode)
  source?: {
    jobId: string;
    itemCount: number;
  };
  
  // Single output (not templates[])
  output?: {
    format: "markdown" | "json";
    key: string;
    uri: string;
    size: number;
  };
  
  // Summary stats for calendar badges
  stats: { repos, commits, prs, issues };
  repos: { name, commits, prs, issues }[];
};
```

### Summary Structure (Optimized for Calendar)

Lightweight version of manifest for quick calendar loading:

```ts
type SummaryItem = {
  owner: string;
  ownerType: "user" | "org";
  jobId: string;
  slotKey: string;
  slotType: "hourly" | "daily" | ...;
  scheduledAt: string;
  window: { start, end, days, hours? };
  status: "success" | "failed";
  empty: boolean;
  outputSize: number;                // bytes (was: templates[].size sum)
  manifestKey: string;
};
```

---

## Storage Layer

### Folder Structure

```
{prefix}/
├── _index/
│   └── {ownerType}/{owner}/
│       ├── jobs.json                    # Job registry
│       └── {jobId}/
│           ├── latest.json              # Pointer to most recent run
│           └── YYYY-MM.json             # Monthly index of runs
└── {ownerType}/{owner}/{jobId}/{slotKey}/
    ├── manifest.json                    # Full run metadata
    ├── summary.json                     # Lightweight for calendar
    └── output.{md|json}                 # Actual artifact
```

> **Note:** Simplified from `.../jobs/{jobId}/...` to `.../{jobId}/...` — removed redundant `jobs/` segment.

### Jobs Registry (Enhanced)

```ts
type JobsRegistry = {
  owner: string;
  ownerType: "user" | "org";
  updatedAt: string;
  jobs: {
    id: string;
    name: string;
    mode: "pipeline" | "aggregate" | "stats";
    schedule: Schedule;
    outputFormat: "markdown" | "json";
    version?: string;
    updatedAt: string;
    // NEW fields
    totalRuns: number;               // Avoid counting index items
    lastRunAt?: string;              // Quick "last run" display
    lastStatus?: "success" | "failed";
  }[];
};
```

### Indexing System

**Monthly indexes** (`YYYY-MM.json`) — ✅ Good design, no changes needed.

**Latest pointer** (`latest.json`) — ✅ Good for quick access.

### Manifest on Failure

**Always generate a manifest**, even on failure. This ensures:
- Calendar shows "Failed" badge instead of empty day
- Error message preserved for debugging
- Index stays consistent

---

## Compatibility Assessment

### ✅ Slots & Backfill — No Changes Needed

The existing `slots.ts` is schedule-based and fully compatible:
- `listSlots()` generates slot windows for backfill
- `resolveSlotKey()` computes the current slot
- Handles all schedule types with timezone awareness

### ✅ Scheduler — Minimal Changes

`scheduler.ts` is already clean:
- `getScheduleDecision()` checks if job is due by comparing slot keys
- Uses `latest.json` to track execution history
- Only needs cleanup of any `templates` references

### ⚠️ Error Handling — Needs Update

`buildFailedManifest()` currently returns `templates: []`. 

**Change needed:** Update to return `output: undefined` instead.

### ⚠️ Aggregation — Simplification

Current aggregation logic uses `sourceTemplateId` to find which template to aggregate:
```ts
// Current (src/index.ts:888)
const sourceTemplateId = job.aggregation?.sourceTemplateId;
const template = manifest.templates.find((entry) => entry.id === templateId);
```

**Change needed:** With one output per job, aggregation directly reads `manifest.output.key`:
```ts
// New approach
const content = await storage.get(manifest.output.key);
```

**Removed fields:**
- `aggregation.sourceTemplateId` — no longer needed
- `aggregation.sourceOutputPrefix` — can be derived from `sourceJobId`

### ℹ️ Tests — Deferred

No test files exist in the project. Testing will be deferred to a future iteration.

---

## What Gets Removed

### Environment Variable Override System (Complete Removal)

The entire env var override pattern in `src/jobs.ts` will be removed. This includes:

**Env vars to remove from schema:**
| Env Var | Current Purpose | New Location |
|---------|-----------------|---------------|
| `JOBS_ENABLED` | Filter which jobs run | Remove (all jobs in config run) |
| `RUN_SCHEDULED_ONLY` | Skip schedule check | Remove (always scheduled) |
| `BACKFILL_SLOTS` | Override backfill count | `job.backfillSlots` in config |
| `REPORT_TEMPLATES` | Override templates | Removed (one output per job) |
| `REPORT_ON_EMPTY` | Override empty behavior | `job.onEmpty` in config |
| `INCLUDE_INACTIVE_REPOS` | Override flag | `job.includeInactiveRepos` in config |
| `MAX_COMMITS_PER_REPO` | Override limit | `job.maxCommitsPerRepo` in config |
| `MAX_REPOS` | Override limit | `job.maxRepos` in config |
| `MAX_TOTAL_COMMITS` | Override limit | `job.maxTotalCommits` in config |
| `MAX_TOKENS_HINT` | Override limit | `job.maxTokensHint` in config |
| `REPORT_IDEMPOTENT_KEY` | Override key | `job.idempotentKey` in config |

**Functions to remove:**
- `applyEnvOverridesToJob()` — the entire override mechanism
- `loadSchedulerConfig()` — replace with direct config read
- `resolveBool()` and `resolveList()` helper functions

**New pattern:** Config is the single source of truth. The system reads `jobs.config.ts` directly:
```ts
// Before (complex)
const env = envSchema.parse(process.env);
const jobs = loadJobs(); // applies env overrides

// After (simple)
import { jobs } from "../jobs.config.js";
```

### From `src/jobs.ts`

| Field/Function | Reason |
|----------------|--------|
| `templates: z.array(z.string())` | One output per job |
| `aggregation.sourceTemplateId` | Simplified aggregation |
| `aggregation.sourceOutputPrefix` | Derive from sourceJobId |
| `envSchema` | No more env overrides |
| `applyEnvOverridesToJob()` | No more env overrides |
| `loadSchedulerConfig()` | Simplified |
| `resolveBool()` | Only used for env parsing |
| `resolveList()` | Only used for env parsing |

### From `config.defaults.ts`

| Field | Reason |
|-------|--------|
| `github.allowlist` | Moved to `job.scope.repos` |
| `github.blocklist` | Moved to `job.scope` |

### From `src/manifest.ts`

| Field | Replacement |
|-------|-------------|
| `templates: ManifestTemplate[]` | `output?: { format, key, uri, size }` |
| `JobRegistryItem.templates` | `JobRegistryItem.outputFormat` |

### From `src/templates.ts`

The entire template registry system will be removed since prompts are now inline or in `promptFile`.

---

## Directory Structure (Target)

```
/
├── jobs.config.ts       # User edits this
├── config.defaults.ts   # Platform defaults (storage, logging, etc.)
├── .env                 # Secrets only
├── prompts/             # Example prompts (users copy and customize)
│   ├── slack-daily-changelog.txt
│   ├── dev-diary.txt
│   ├── twitter.txt
│   └── slack-weekly-summary.txt
├── src/
│   ├── index.ts         # Entrypoint
│   ├── scheduler.ts     # Cron/schedule logic (minimal changes)
│   ├── runner.ts        # Job execution orchestrator
│   ├── processors/
│   │   ├── pipeline.ts
│   │   ├── aggregate.ts
│   │   └── stats.ts
│   ├── generator.ts     # LLM interaction (updated for token capture)
│   ├── github/
│   │   └── fetcher.ts   # Data fetching with profiles
│   ├── slots.ts         # Keep as-is
│   ├── manifest.ts      # Updated schema
│   ├── webhook.ts       # Updated for per-job webhooks
│   └── storage.ts       # Keep as-is
└── viewer/          # Next.js App (update manifest handling)
```

---

## Implementation Phases

### Phase 1: Schema & Config
- [ ] Define new Zod schema for `jobs.config.ts`
- [ ] Remove scope from global config (`github.allowlist`, `github.blocklist`)
- [ ] Add `dataProfile` field
- [ ] Support `promptFile` alongside inline `prompt`
- [ ] Remove `templates` field, add single output config
- [ ] Add per-job `webhook` field (with global fallback)

### Phase 2: Storage Layer & Manifest
- [ ] Change `templates: ManifestTemplate[]` to `output?: { format, key, uri, size }`
- [ ] Add new manifest fields: `generatedAt`, `durationMs`, `dataProfile`, `llm`, `source`
- [ ] Update `buildManifest()` to capture timing and LLM metadata
- [ ] Update `buildFailedManifest()` to use new schema
- [ ] Update `writeSummary()` to use `outputSize` instead of `templates`
- [ ] Update `JobRegistryItem` with `totalRuns`, `lastRunAt`, `lastStatus`
- [ ] Simplify folder structure: remove `jobs/` segment from paths

### Phase 3: Runner Refactor
- [ ] Create `processors/` directory structure
- [ ] Extract pipeline logic to `processors/pipeline.ts`
- [ ] Extract aggregate logic to `processors/aggregate.ts`
- [ ] Extract stats logic to `processors/stats.ts`
- [ ] Simplify `runner.ts` to dispatch by mode
- [ ] Remove `sourceTemplateId` from aggregation

### Phase 4: Data Layer
- [ ] Refactor GitHub fetching to respect `dataProfile`
- [ ] Implement fetch caching for same scope + profile
- [ ] Move context provider logic into fetcher

### Phase 5: Viewer Alignment
- [ ] Update viewer to read `output` instead of `templates[]`
- [ ] Ensure calendar shows one output per manifest
- [ ] Test stats rendering with new schema

### Phase 6: Generator & Prompts
- [ ] Update `generator.ts` to capture token usage from Gemini API
- [ ] Remove `source.templateId` reference from `buildAggregatePrompt()`
- [ ] Create example prompts in `prompts/` directory
- [ ] Migrate existing templates to example prompt files

### Phase 7: Cleanup
- [ ] Remove env-var override system (`applyEnvOverridesToJob`)
- [ ] Remove `src/templates.ts`
- [ ] Remove legacy fields from all schemas
- [ ] Update README with new configuration guide

---

## Open Questions

- [ ] Should we add a `dataOverrides` field for granular control, or wait for real use cases?
- [ ] Cache strategy for GitHub fetches when multiple jobs have same scope?
