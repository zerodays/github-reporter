export type RepoRef = {
  name: string;
  private: boolean;
  htmlUrl: string;
};

export type CommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

export type RepoActivity = {
  repo: RepoRef;
  commits: CommitSummary[];
  context?: RepoContext;
};

export type RateLimitInfo = {
  limit?: number;
  remaining?: number;
  reset?: number;
};

export type ActivityWindow = {
  start: string;
  end: string;
};

export type ReportInput = {
  owner: string;
  ownerType: "user" | "org";
  window: ActivityWindow;
  repos: RepoActivity[];
  inactiveRepoCount?: number;
};

export type RepoContext = {
  overview?: RepoOverview;
  diffSummary?: CommitDiffSummary[];
  diffSnippets?: CommitDiffSnippet[];
};

export type RepoOverview = {
  description?: string | null;
  topics?: string[];
  readme?: string;
  llmTxt?: string;
};

export type CommitDiffSummary = {
  sha: string;
  totalAdditions: number;
  totalDeletions: number;
  files: DiffFileSummary[];
};

export type DiffFileSummary = {
  path: string;
  additions: number;
  deletions: number;
};

export type CommitDiffSnippet = {
  sha: string;
  files: DiffSnippetFile[];
};

export type DiffSnippetFile = {
  path: string;
  patch: string;
};

export type ReportOutput = {
  format: "markdown" | "json";
  text: string;
};

export type StoredArtifact = {
  key: string;
  uri: string;
  size: number;
};

export type WebhookPayload = {
  owner: string;
  ownerType: "user" | "org";
  window: ActivityWindow;
  artifact: StoredArtifact;
  format: "markdown" | "json";
  createdAt: string;
};
