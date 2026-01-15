# GitHub Reporter

GitHub Reporter is a self-hostable microservice that turns GitHub activity into automated reports using LLMs. It follows a **GitOps-style architecture** where your configuration (`jobs.config.ts`) is the single source of truth for your reporting pipeline.

Typical uses:
- **Daily dev diaries** summarized from your commits and PRs.
- **Weekly team progress** aggregated from daily reports.
- **Hourly stats** captured as deterministic JSON for dashboards.
- **Twitter-style snippets** of your shipping progress.

## Core Concepts

- **GitOps Config**: All jobs, schedules, and scopes are defined in `jobs.config.ts`. Environment variables are reserved for secrets (`GITHUB_TOKEN`, `GEMINI_API_KEY`, etc.).
- **One Job = One Output**: Each job generates exactly one primary artifact (Markdown or JSON). This simplifies storage, logic, and rendering.
- **Data Profiles**: Control exactly how much context is fetched from GitHub to optimize for token usage and performance.
- **Aggregation**: Summarize a sequence of existing reports (e.g., Weekly Summary from 7 Daily Reports) without re-scraping GitHub.

## 🚀 Quick Start

1. **Clone & Setup**:
   ```bash
   pnpm install
   cp .env.example .env
   ```
2. **Configure Secrets**: Add your `GITHUB_TOKEN` and `GEMINI_API_KEY` to `.env`.
3. **Define Jobs**: Edit `jobs.config.ts` to set your owner scope and schedules.
4. **Run**:
   ```bash
   pnpm dev
   ```
   Run a single job by id:
   ```bash
   pnpm dev -- --job slack-daily-changelog
   ```

   > [!TIP]
   > Need help getting your tokens? Check out our [Token Setup Guide](docs/SETUP_TOKENS.md) for step-by-step instructions on creating GitHub and Slack credentials.

## 🛠 Configuration (`jobs.config.ts`)

Jobs are defined using a TypeScript-native configuration. This allows for type safety and easy versioning of your reporting logic.

```typescript
// jobs.config.ts
import { JobsConfig } from "./src/jobs";

export default {
  jobs: [
    {
      id: "daily-diary",
      name: "Daily Developer Diary",
      mode: "pipeline",
      scope: { owner: "vucinatim", ownerType: "user" },
      schedule: { type: "daily", hour: 0 },
      dataProfile: "standard",
      promptFile: "prompts/dev-diary.txt",
    },
    {
      id: "slack-weekly-summary",
      name: "Slack Weekly Summary",
      mode: "aggregate",
      scope: { owner: "vucinatim", ownerType: "user" },
      schedule: { type: "weekly", weekday: 0 },
      aggregation: {
        sourceJobId: "daily-diary",
        maxDays: 7
      },
      promptFile: "prompts/slack-weekly-summary.txt",
    }
  ]
} satisfies JobsConfig;
```

### Data Profiles

| Profile | Description | Use Case |
| :--- | :--- | :--- |
| `minimal` | Basic repo metadata & counts. | Stats dashboards, high-level monitors. |
| `standard` | Metadata + Commits + README + Diff Summaries. | Most developer diaries and changelogs. |
| `full` | Metadata + Commits + PRs + Issues + Code Snippets. | Deep technical analysis and review reports. |

## 📁 Storage Structure

Artifacts are stored in a predictable, flat structure designed for high-performance indexing:

- **Reports**: `{prefix}/{ownerType}/{owner}/{jobId}/{start}__{end}/`
  - `output.md` (or `.json`) — The generated report.
  - `manifest.json` — Detailed metadata and observability tags.
  - `summary.json` — Lightweight stats for calendar displays.
- **Index**: `{prefix}/_index/{ownerType}/{owner}/{jobId}/`
  - `latest.json` — Pointer to the most recent run.
  - `{YYYY-MM}.json` — Monthly index of all runs for timeline rendering.

## 🛰 Slack & Webhooks

GitHub Reporter supports real-time notifications via standard webhooks or a rich Slack integration.

### Slack Integration (Recommended)
Reports are uploaded as **searchable snippets** using the Slack Files API, bypassing standard message character limits.

1.  **Create a Slack App**: Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app.
2.  **Add Scopes**: Under **OAuth & Permissions**, add the `files:write` bot token scope.
3.  **Install App**: Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-...`).
4.  **Add App to Channel**: Invite your bot to the desired Slack channel (`/invite @your_bot_name`).
5.  **Get Channel ID**: Right-click the channel name in Slack > View channel details > Copy Channel ID at the bottom.
6.  **Configure**:
    ```bash
    # .env
    SLACK_TOKEN=xoxb-your-token
    SLACK_CHANNEL=C12345678
    ```
    Or per-job in `jobs.config.ts`.

### Standard Webhooks
For Discord, custom APIs, or automation tools:
```bash
WEBHOOK_URL=https://your-webhook.com
WEBHOOK_SECRET=your-hmac-secret # Optional
```
Validated payloads include the `x-signature` header for security.

## 📊 Viewer

An example viewer app is provided in `viewer`. It is a Next.js application that provides a beautiful calendar-based interface for browsing your reports. It reads directly from your storage (Local or S3/R2) via a secure proxy.

Run it with:
```bash
pnpm viewer:dev
```

## 🛰 Deployment (Railway)

GitHub Reporter is optimized for "Fork & Deploy" on Railway:

1. Deploy the repository.
2. Set your `.env` variables in the Railway dashboard.
3. Configure an hourly CRON in Railway:
   - **Schedule**: `0 * * * *`
   - **Command**: `pnpm dev --scheduled-only`

The `--scheduled-only` flag ensures the runner only executes jobs that are currently due based on their internal `schedule` definition.

## 🔍 Validation & Health

- `pnpm health`: Validates your configuration, storage carrier access, and GitHub token scopes.
- `pnpm smoke`: Simulates a run to check schedules and API connectivity without writing artifacts.

---
License: MIT
