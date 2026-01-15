import type { JobsConfig } from "./src/jobs.js";

/**
 * GitHub Reporter Jobs Configuration
 *
 * This file defines all jobs that the reporter will run.
 * Each job produces a single output (markdown or JSON).
 *
 * Edit this file to configure your reports, schedules, and teams.
 */
export const config: JobsConfig = {
  jobs: [
    // -------------------------------------------------------------------------
    // Daily Changelog - LLM-generated changelog from commits
    // -------------------------------------------------------------------------
    {
      id: "slack-daily-changelog",
      name: "Slack Daily Changelog",
      description: "Slack-formatted daily changelog",
      mode: "pipeline",
      dataProfile: "full",
      schedule: {
        type: "daily",
        hour: 0,
        minute: 0,
      },
      scope: {
        owner: "zerodays",
        ownerType: "org",
        blocklist: ["github-reporter"],
      },
      promptFile: "./prompts/slack-daily-changelog.txt",
      outputFormat: "markdown",
      onEmpty: "manifest-only",
      backfillSlots: 1,
      maxCommitsPerRepo: 50,
      maxRepos: 10,
      maxTotalCommits: 1000,
      maxTokensHint: 1200,
    },

    // -------------------------------------------------------------------------
    // Weekly Summary - Aggregates daily changelogs
    // -------------------------------------------------------------------------
    {
      id: "slack-weekly-summary",
      name: "Slack Weekly Summary",
      description: "Slack-formatted weekly summary from daily changelogs",
      mode: "aggregate",
      dataProfile: "minimal",
      schedule: {
        type: "weekly",
        weekday: 1, // Monday
        hour: 9,
        minute: 0,
      },
      scope: {
        owner: "zerodays",
        ownerType: "org",
      },
      aggregation: {
        sourceJobId: "slack-daily-changelog",
        maxDays: 7,
      },
      promptFile: "./prompts/slack-weekly-summary.txt",
      outputFormat: "markdown",
      onEmpty: "manifest-only",
      backfillSlots: 0,
    },
  ],
};
