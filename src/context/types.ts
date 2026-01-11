import type { Octokit } from "@octokit/rest";
import type { AppConfig } from "../config.js";
import type { ActivityWindow, RateLimitInfo, RepoActivity } from "../types.js";

export type ContextProviderArgs = {
  octokit: Octokit;
  repos: RepoActivity[];
  window: ActivityWindow;
  config: AppConfig;
  rateLimit: RateLimitInfo;
};

export type ContextProvider = {
  name: string;
  run: (args: ContextProviderArgs) => Promise<void>;
};
