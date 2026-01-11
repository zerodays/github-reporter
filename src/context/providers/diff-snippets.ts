import type { ContextProvider } from "../types.js";
import { ensureContext } from "../utils.js";
import { updateRateLimit } from "../../github-rate-limit.js";
import type { CommitDiffSnippet, DiffSnippetFile } from "../../types.js";

export const diffSnippetsProvider: ContextProvider = {
  name: "diff-snippets",
  async run({ octokit, repos, config, rateLimit }) {
    if (!config.context.includeDiffSnippets) return;

    for (const repo of repos) {
      const commits = repo.commits.slice(0, config.context.maxSnippetCommitsPerRepo);
      if (commits.length === 0) continue;

      const snippets: CommitDiffSnippet[] = [];
      let budget = config.context.maxSnippetBytesPerRepo;

      for (const commit of commits) {
        if (budget <= 0) break;

        const response = await octokit.repos.getCommit({
          owner: config.github.owner,
          repo: repo.repo.name,
          ref: commit.sha
        });
        updateRateLimit(rateLimit, response.headers as Record<string, string>);

        const files = (response.data.files ?? [])
          .filter((file) => Boolean(file.patch))
          .filter((file) => !isIgnored(file.filename, config.context.ignoreExtensions))
          .sort((a, b) => (b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0)))
          .slice(0, config.context.maxSnippetFilesPerCommit);

        const snippetFiles: DiffSnippetFile[] = [];
        for (const file of files) {
          if (!file.patch || budget <= 0) continue;
          const patch = truncatePatch(file.patch, config.context.maxSnippetLinesPerFile);
          const patchBytes = Buffer.byteLength(patch, "utf8");
          if (patchBytes > budget) continue;
          budget -= patchBytes;
          snippetFiles.push({
            path: file.filename,
            patch
          });
        }

        if (snippetFiles.length > 0) {
          snippets.push({
            sha: commit.sha,
            files: snippetFiles
          });
        }
      }

      if (snippets.length > 0) {
        const context = ensureContext(repo);
        context.diffSnippets = snippets;
      }
    }
  }
};

function truncatePatch(patch: string, maxLines: number) {
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;
  return [...lines.slice(0, maxLines), "...[truncated]"]
    .join("\n");
}

function isIgnored(filename: string, ignoreExtensions: string[]) {
  return ignoreExtensions.some((ext) => filename.endsWith(ext));
}
