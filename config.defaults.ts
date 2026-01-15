import type { ConfigFile } from "./src/config.ts";

export const defaultConfig: ConfigFile = {
  github: {
    ownerType: "org", // "org" or "user" - determines API endpoint for listing repos
    perPage: 100, // Items per page in GitHub API pagination
    maxPages: 5, // Maximum pages to fetch (limits total repos)
    includePrivate: true, // Include private repositories in listings
  },
  output: {
    format: "markdown", // Output format: "markdown" or "json"
    prefix: "reports", // Storage path prefix for all reports
  },
  llm: {
    model: "gemini-3-flash-preview", // LLM model identifier for report generation
  },
  storage: {
    type: "s3", // Storage backend type (e.g., "s3", "local")
    bucket: "github-reporter", // Bucket/container name
    region: "auto", // AWS region ("auto" = auto-detect)
    forcePathStyle: true, // Use path-style URLs (needed for S3-compatible services)
  },
  network: {
    retryCount: 2, // Number of retry attempts for failed network requests
    retryBackoffMs: 500, // Delay in milliseconds between retries
  },
  logging: {
    level: "info", // Log level: "debug", "info", "warn", "error"
    includeTimings: true, // Include execution time in log entries
    format: "pretty", // Log format: "pretty" (human-readable) or "json"
    color: true, // Enable colored output in terminal logs
  },
  webhook: {}, // Webhook notification settings
  context: {
    includeReadme: true, // Fetch and include README files in context
    includeLlmTxt: true, // Fetch and include llm.txt/llms.txt files
    llmFiles: ["llms.txt", "llm.txt"], // Filenames to look for LLM context
    includeRepoDescription: true, // Include repository description
    includeRepoTopics: true, // Include repository topics/tags
    includeDiffSummary: true, // Include summary statistics of code changes
    includeDiffSnippets: true, // Include actual code snippets from diffs
    includePullRequests: true, // Fetch and include PR information
    includePullRequestDetails: true, // Include full PR details (not just counts)
    includeIssues: true, // Fetch and include issue information
    maxReadmeBytes: 36000, // Maximum README size to include (in bytes)
    maxLlmTxtBytes: 24000, // Maximum llm.txt size to include (in bytes)
    maxDiffFilesPerCommit: 60, // Maximum files to process per commit
    maxDiffCommitsPerRepo: 30, // Maximum commits to analyze per repo
    maxSnippetCommitsPerRepo: 15, // Maximum commits to extract snippets from
    maxSnippetFilesPerCommit: 15, // Maximum files to extract snippets from per commit
    maxSnippetLinesPerFile: 200, // Maximum lines per code snippet
    maxSnippetBytesPerRepo: 60000, // Maximum total snippet size per repo (in bytes)
    maxPullRequestsPerRepo: 60, // Maximum PRs to fetch per repository
    maxIssuesPerRepo: 60, // Maximum issues to fetch per repository
    ignoreExtensions: [
      // File extensions to skip when processing diffs
      ".lock",
      ".min.js",
      ".min.css",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".webp",
    ],
  },
};
