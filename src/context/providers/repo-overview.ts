import type { ContextProvider } from "../types.js";
import { ensureContext } from "../utils.js";
import { updateRateLimit } from "../../github-rate-limit.js";

export const repoOverviewProvider: ContextProvider = {
  name: "repo-overview",
  async run({ octokit, repos, config, rateLimit }) {
    const includeDescription = config.context.includeRepoDescription;
    const includeTopics = config.context.includeRepoTopics;
    if (!includeDescription && !includeTopics) return;

    for (const repo of repos) {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}",
        {
          owner: config.github.owner,
          repo: repo.repo.name,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
            accept: "application/vnd.github+json"
          }
        }
      );
      updateRateLimit(rateLimit, response.headers);

      const context = ensureContext(repo);
      context.overview = context.overview ?? {};
      if (includeDescription) {
        context.overview.description = response.data.description ?? null;
      }
      if (includeTopics) {
        context.overview.topics = response.data.topics ?? [];
      }
    }
  }
};
