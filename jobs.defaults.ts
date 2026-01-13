import type { JobsFile } from "./src/jobs.ts";

export const defaultJobs: JobsFile = {
  jobs: [
    {
      id: "daily",
      name: "Daily activity",
      description: "Daily report for a single owner.",
      mode: "pipeline",
      templates: ["dev-diary", "changelog", "twitter"],
      includeInactiveRepos: false,
      maxCommitsPerRepo: 50,
      maxRepos: 100,
      maxTotalCommits: 1000,
      maxTokensHint: 1200,
      onEmpty: "manifest-only",
      backfillSlots: 0,
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
      templates: ["weekly-summary"],
      includeInactiveRepos: false,
      backfillSlots: 0,
      onEmpty: "manifest-only",
      aggregation: {
        sourceJobId: "daily",
        sourceTemplateId: "changelog",
        maxBytesPerItem: 12000,
        maxTotalBytes: 60000,
      },
      schedule: {
        type: "weekly",
        weekday: 1,
        hour: 0,
        minute: 0,
      },
    },
    {
      id: "hourly-stats",
      name: "Hourly stats",
      description: "Hourly activity stats for dashboards.",
      mode: "stats",
      templates: [],
      includeInactiveRepos: true,
      maxCommitsPerRepo: 20,
      maxTotalCommits: 200,
      backfillSlots: 0,
      onEmpty: "manifest-only",
      contextProviders: [],
      schedule: {
        type: "hourly",
        minute: 0,
      },
    },
  ],
};
