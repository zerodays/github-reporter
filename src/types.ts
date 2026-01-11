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

export type AggregateInput = {
  owner: string;
  ownerType: "user" | "org";
  window: ActivityWindow;
  job: { id: string; name: string };
  source: { jobId: string; templateId: string };
  items: { date: string; manifestKey: string; content: string }[];
};

export type RepoContext = {
  overview?: RepoOverview;
  diffSummary?: CommitDiffSummary[];
  diffSnippets?: CommitDiffSnippet[];
  pullRequests?: PullRequestSummary[];
  issues?: IssueSummary[];
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

export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  state: string;
  author: string | null;
  reviewers?: string[];
  labels?: string[];
  mergedBy?: string | null;
  reviewsCount?: number;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  createdAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
};

export type IssueSummary = {
  number: number;
  title: string;
  url: string;
  state: string;
  author: string | null;
  createdAt: string;
  closedAt?: string | null;
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
  jobId?: string;
  jobName?: string;
  window: ActivityWindow;
  artifact: StoredArtifact;
  format: "markdown" | "json";
  createdAt: string;
};
