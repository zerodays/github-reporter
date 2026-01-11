import { Octokit } from "@octokit/rest";
import type { AppConfig } from "../config.js";
import type { ActivityWindow, RateLimitInfo, RepoActivity } from "../types.js";
import type { ContextLogger } from "../logger.js";
import { withRetry } from "../retry.js";
import { diffSummaryProvider } from "./providers/diff-summary.js";
import { diffSnippetsProvider } from "./providers/diff-snippets.js";
import { llmTxtProvider } from "./providers/llm-txt.js";
import { readmeProvider } from "./providers/readme.js";
import { repoOverviewProvider } from "./providers/repo-overview.js";
import type { ContextProvider } from "./types.js";

const providers: ContextProvider[] = [
  repoOverviewProvider,
  readmeProvider,
  llmTxtProvider,
  diffSummaryProvider,
  diffSnippetsProvider
];

export async function enrichReposWithContext(args: {
  repos: RepoActivity[];
  window: ActivityWindow;
  config: AppConfig;
  rateLimit: RateLimitInfo;
  logger: ContextLogger;
}) {
  const octokit = new Octokit({
    auth: args.config.github.token
  });

  const results: {
    name: string;
    ok: boolean;
    durationMs?: number;
    error?: string;
  }[] = [];

  for (const provider of providers) {
    const start = Date.now();
    try {
      await withRetry(
        () =>
          provider.run({
            octokit,
            repos: args.repos,
            window: args.window,
            config: args.config,
            rateLimit: args.rateLimit
          }),
        {
          retries: args.config.network.retryCount,
          backoffMs: args.config.network.retryBackoffMs
        }
      );
      results.push({
        name: provider.name,
        ok: true,
        durationMs: args.config.logging.includeTimings
          ? Date.now() - start
          : undefined
      });
    } catch (error) {
      results.push({
        name: provider.name,
        ok: false,
        durationMs: args.config.logging.includeTimings
          ? Date.now() - start
          : undefined,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}
