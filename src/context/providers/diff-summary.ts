import type { ContextProvider } from "../types.js";
import { ensureContext } from "../utils.js";
import { updateRateLimit } from "../../github-rate-limit.js";
import type { CommitDiffSummary, DiffFileSummary } from "../../types.js";

export const diffSummaryProvider: ContextProvider = {
  name: "diff-summary",
  async run({ octokit, repos, config, rateLimit }) {
    if (!config.context.includeDiffSummary) return;

    for (const repo of repos) {
      const commits = repo.commits.slice(0, config.context.maxDiffCommitsPerRepo);
      if (commits.length === 0) continue;

      const summaries: CommitDiffSummary[] = [];
      for (const commit of commits) {
        const response = await octokit.repos.getCommit({
          owner: config.github.owner,
          repo: repo.repo.name,
          ref: commit.sha
        });
        updateRateLimit(rateLimit, response.headers as Record<string, string>);

        const files = (response.data.files ?? [])
          .slice(0, config.context.maxDiffFilesPerCommit)
          .map<DiffFileSummary>((file) => ({
            path: file.filename,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0
          }));

        summaries.push({
          sha: commit.sha,
          totalAdditions: response.data.stats?.additions ?? 0,
          totalDeletions: response.data.stats?.deletions ?? 0,
          files
        });
      }

      const context = ensureContext(repo);
      context.diffSummary = summaries;
    }
  }
};
