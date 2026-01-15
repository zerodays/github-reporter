import type { JobsConfig } from "./src/jobs.js";

/**
 * GitHub Reporter Jobs Configuration
 *
 * This file defines all jobs that the reporter will run.
 * Each job produces a single output (markdown or JSON).
 *
 * Edit this file to configure your reports, schedules, and teams.
 * Tip: If GITHUB_OWNER/GITHUB_OWNER_TYPE are set, owner/ownerType can be omitted in scope.
 */
export const config: JobsConfig = {
  jobs: [
    // -------------------------------------------------------------------------
    // Daily Changelog - LLM-generated changelog from commits
    // -------------------------------------------------------------------------
    {
      id: "slack-daily-changelog", // Unique job identifier
      name: "Slack Daily Changelog", // Display name for the job
      description: "Slack-formatted daily changelog", // Optional job description
      mode: "pipeline", // Processing mode: "pipeline" (generate from data), "aggregate" (combine reports), or "stats" (metrics only)
      dataProfile: "full", // Data depth: "minimal" (metadata only), "standard" (commits+diffs), or "full" (includes PRs/issues/snippets)
      schedule: {
        type: "daily", // Schedule frequency: "daily", "weekly", "monthly", etc.
        hour: 0, // Hour of day (0-23) to run
        minute: 0, // Minute of hour (0-59) to run
      },
      scope: {
        // blocklist: ["github-reporter"], // Repos to exclude from this job
      },
      promptFile: "./prompts/slack-daily-changelog.txt", // Path to LLM prompt template file
      outputFormat: "markdown", // Output format: "markdown" or "json"
      onEmpty: "manifest-only", // Behavior when no activity: "manifest-only" (save metadata), "placeholder" (generate empty report), or "skip" (do nothing)
      backfillSlots: 0, // Number of past time slots to process (0 = only current slot)
      maxCommitsPerRepo: 50, // Maximum commits to fetch per repository
      maxRepos: 10, // Maximum repositories to process
      maxTotalCommits: 1000, // Maximum total commits across all repos
      maxTokensHint: 1200, // Estimated LLM token budget hint for prompt optimization
      metrics: {
        topContributors: 10, // Number of top contributors to include in metrics
        topRepos: 10, // Number of top repos to include in metrics
      },
    },

    // -------------------------------------------------------------------------
    // Weekly Summary - Aggregates daily changelogs
    // -------------------------------------------------------------------------
    {
      id: "slack-weekly-summary", // Unique job identifier
      name: "Slack Weekly Summary", // Display name for the job
      description: "Slack-formatted weekly summary from daily changelogs", // Optional job description
      mode: "aggregate", // Processing mode: aggregates reports from another job
      dataProfile: "minimal", // Data depth: "minimal" since it uses aggregated data, not fresh GitHub data
      schedule: {
        type: "weekly", // Schedule frequency: runs once per week
        weekday: 1, // Day of week (0=Sunday, 1=Monday, etc.)
        hour: 1, // Hour of day (0-23) to run
        minute: 0, // Minute of hour (0-59) to run
      },
      scope: {}, // Repo filtering (empty = use all repos from source job)
      aggregation: {
        sourceJobId: "slack-daily-changelog", // ID of job whose reports to aggregate
        maxDays: 7, // Maximum number of days to aggregate from source job
      },
      promptFile: "./prompts/slack-weekly-summary.txt", // Path to LLM prompt template file
      outputFormat: "markdown", // Output format: "markdown" or "json"
      onEmpty: "manifest-only", // Behavior when no activity: "manifest-only" (save metadata), "placeholder" (generate empty report), or "skip" (do nothing)
      backfillSlots: 0, // Number of past time slots to process (0 = only current slot)
      metrics: {
        topContributors: 10, // Number of top contributors to include in metrics
        topRepos: 10, // Number of top repos to include in metrics
      },
    },
  ],
};
