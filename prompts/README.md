# Prompts Gallery

This directory contains example prompt templates for `github-reporter`. 

You can use these in your `jobs.config.ts` by setting the `promptFile` property.

## Available Prompts

- `slack-daily-changelog.txt`: Slack-formatted daily changelog.
- `dev-diary.txt`: A technical summary intended for developers working on the project.
- `slack-weekly-summary.txt`: A high-level Slack-formatted weekly summary.
- `twitter.txt`: A short, punchy summary optimized for social media.

## How to use

```typescript
// jobs.config.ts
{
  id: "daily-report",
  mode: "pipeline",
  promptFile: "prompts/dev-diary.txt",
  // ...
}
```
