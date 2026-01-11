import type { JobsFile } from "./src/jobs.ts";

export const defaultJobs: JobsFile = {
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
      schedule: {
        type: "daily",
        hour: 0,
        minute: 0,
      },
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
      },
      schedule: {
        type: "weekly",
        weekday: 0,
        hour: 0,
        minute: 0,
      },
    },
    {
      id: "hourly-stats",
      name: "Hourly stats",
      description: "Hourly activity stats for dashboards.",
      mode: "stats",
      windowHours: 1,
      templates: [],
      includeInactiveRepos: true,
      backfillWindows: 0,
      onEmpty: "manifest-only",
      contextProviders: [],
      schedule: {
        type: "hourly",
        minute: 0,
      },
    },
  ],
};
