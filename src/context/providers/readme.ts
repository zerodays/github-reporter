import type { ContextProvider } from "../types.js";
import { ensureContext, truncateText } from "../utils.js";
import { updateRateLimit } from "../../github-rate-limit.js";

export const readmeProvider: ContextProvider = {
  name: "readme",
  async run({ octokit, repos, config, rateLimit }) {
    if (!config.context.includeReadme) return;

    for (const repo of repos) {
      try {
        const response = await octokit.repos.getReadme({
          owner: config.github.owner,
          repo: repo.repo.name
        });
        updateRateLimit(rateLimit, response.headers as Record<string, string>);

        const content = Buffer.from(response.data.content, "base64").toString(
          "utf8"
        );
        const text = truncateText(content, config.context.maxReadmeBytes);
        const context = ensureContext(repo);
        context.overview = context.overview ?? {};
        context.overview.readme = text;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) continue;
        throw error;
      }
    }
  }
};
