"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type IndexItem = {
  start: string;
  end: string;
  days: number;
  hours?: number;
  manifestKey: string;
  jobId?: string;
};

type Manifest = {
  schemaVersion?: number;
  job?: {
    id: string;
    name: string;
    description?: string;
    mode: "pipeline" | "aggregate" | "stats";
    version?: string;
  };
  status?: "success" | "failed";
  error?: string;
  owner: string;
  ownerType: "user" | "org";
  window: { start: string; end: string; days: number; hours?: number };
  timezone?: string;
  templates: { id: string; format: string; key: string; uri: string; size: number }[];
  repos: { name: string; commits: number; prs: number; issues: number }[];
  stats: { repos: number; commits: number; prs: number; issues: number };
};

type JobRegistryItem = {
  id: string;
  name: string;
  description?: string;
  mode: "pipeline" | "aggregate" | "stats";
  windowDays: number;
  windowHours?: number;
  templates: string[];
  outputFormat?: "markdown" | "json";
  outputPrefix?: string;
  updatedAt?: string;
};

type JobRegistry = {
  owner: string;
  ownerType: "user" | "org";
  jobs: JobRegistryItem[];
};

const defaultOwner = process.env.NEXT_PUBLIC_DEFAULT_OWNER ?? "";
const defaultOwnerType = (process.env.NEXT_PUBLIC_DEFAULT_OWNER_TYPE ?? "user") as
  | "user"
  | "org";
const prefix = process.env.NEXT_PUBLIC_REPORT_PREFIX ?? "reports";

export default function ReportViewer() {
  const [ownerType, setOwnerType] = useState<"user" | "org">(defaultOwnerType);
  const [owner, setOwner] = useState(defaultOwner);
  const [jobs, setJobs] = useState<JobRegistryItem[]>([]);
  const [jobId, setJobId] = useState("");
  const [latest, setLatest] = useState<Manifest | null>(null);
  const [selected, setSelected] = useState<Manifest | null>(null);
  const [content, setContent] = useState<string>("");
  const [items, setItems] = useState<IndexItem[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const jobsIndex = useMemo(
    () => `${prefix}/_index/${ownerType}/${owner}/jobs.json`,
    [ownerType, owner]
  );
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === jobId),
    [jobs, jobId]
  );
  const baseIndex = useMemo(() => {
    if (!jobId) return "";
    const jobPrefix = selectedJob?.outputPrefix ?? prefix;
    return `${jobPrefix}/_index/${ownerType}/${owner}/${jobId}`;
  }, [ownerType, owner, jobId, selectedJob]);

  useEffect(() => {
    if (!owner) return;
    setItems([]);
    setMonths([]);
    setLatest(null);
    setSelected(null);
    setContent("");
    setHasMore(true);
    void loadJobs();
  }, [jobsIndex]);

  useEffect(() => {
    if (!baseIndex) return;
    setItems([]);
    setMonths([]);
    setLatest(null);
    setSelected(null);
    setContent("");
    setHasMore(true);
    void loadLatest(baseIndex);
    void loadMore();
  }, [baseIndex]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [owner, months.length, loading, hasMore]);

  async function loadJobs() {
    try {
      const res = await fetch(`/api/reports/${jobsIndex}`);
      if (res.status === 404) {
        setJobs([]);
        setJobId("");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as JobRegistry;
      const list = data.jobs ?? [];
      setJobs(list);
      if (list.length > 0) {
        setJobId((current) => current || list[0]?.id || "");
      }
    } catch {
      // ignore
    }
  }

  async function loadLatest(indexBase: string) {
    try {
      const res = await fetch(`/api/reports/${indexBase}/latest.json`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.latest?.manifestKey) {
        const manifest = await loadManifest(data.latest.manifestKey);
        setLatest(manifest);
        setSelected(manifest);
        if (manifest?.templates?.[0]) {
          await loadTemplate(manifest.templates[0].key);
        }
      }
    } catch {
      // ignore
    }
  }

  async function loadMonth(month: string) {
    try {
      const res = await fetch(`/api/reports/${baseIndex}/${month}.json`);
      if (res.status === 404) return false;
      if (!res.ok) return false;
      const data = await res.json();
      const list = (data.items as IndexItem[]) ?? [];
      setItems((prev) => [...prev, ...list]);
      return true;
    } catch {
      return false;
    }
  }

  async function loadMore() {
    if (!owner || !baseIndex || loading || !hasMore) return;
    setLoading(true);
    const next = nextMonth(months[months.length - 1]);
    if (!next) {
      setLoading(false);
      setHasMore(false);
      return;
    }
    const loaded = await loadMonth(next);
    if (loaded) {
      setMonths((prev) => [...prev, next]);
    } else {
      setHasMore(false);
    }
    setLoading(false);
  }

  async function loadManifest(key: string) {
    const res = await fetch(`/api/reports/${key}`);
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  }

  async function loadTemplate(key: string) {
    const res = await fetch(`/api/reports/${key}`);
    if (!res.ok) return;
    const text = await res.text();
    setContent(text);
  }

  const reportList = useMemo(
    () => [...items].sort((a, b) => b.start.localeCompare(a.start)),
    [items]
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">Settings</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-widest text-zinc-500">
              Owner Type
            </span>
            <select
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={ownerType}
              onChange={(event) =>
                setOwnerType(event.target.value as "user" | "org")
              }
            >
              <option value="user">User</option>
              <option value="org">Org</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-widest text-zinc-500">
              Owner
            </span>
            <input
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="vucinatim"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-widest text-zinc-500">
              Job
            </span>
            <select
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              disabled={jobs.length === 0}
            >
              {jobs.length === 0 ? (
                <option value="">No jobs found</option>
              ) : (
                jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="text-xs text-zinc-500">
            Data source: <span className="text-zinc-300">{baseIndex}</span>
          </div>
        </div>
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-widest text-zinc-500">
            Latest report
          </h3>
          {latest ? (
            <button
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm"
              onClick={() => {
                setSelected(latest);
                if (latest.templates[0]) {
                  void loadTemplate(latest.templates[0].key);
                }
              }}
            >
              <div className="text-zinc-100">
                {latest.window.start.slice(0, 10)}
              </div>
              <div className="text-xs text-zinc-500">
                {formatWindowLabel(latest.window)} • {latest.stats.commits} commits
              </div>
            </button>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">No latest report.</p>
          )}
        </div>
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-widest text-zinc-500">
            History
          </h3>
          <button
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            onClick={() => {
              setItems([]);
              setMonths([]);
              void loadMore();
            }}
          >
            Load Month
          </button>
          <div className="mt-4 max-h-72 space-y-2 overflow-auto">
            {reportList.map((item) => (
              <button
                key={item.manifestKey}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-400"
                onClick={async () => {
                  const manifest = await loadManifest(item.manifestKey);
                  if (!manifest) return;
                  setSelected(manifest);
                  if (manifest.templates[0]) {
                    await loadTemplate(manifest.templates[0].key);
                  }
                }}
              >
                <div className="text-zinc-200">{item.start.slice(0, 10)}</div>
                <div className="text-zinc-500">
                  {formatIndexLabel(item)} • {item.manifestKey.split("/").pop()}
                </div>
              </button>
            ))}
            <div ref={loadMoreRef} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        {selected ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-zinc-100">
                {selected.owner} · {selected.window.start.slice(0, 10)}
              </h2>
              <p className="text-sm text-zinc-400">
                {formatWindowLabel(selected.window)} · {selected.stats.commits} commits ·
                {" "}
                {selected.stats.prs} PRs · {selected.stats.issues} issues
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.templates.map((template) => (
                <button
                  key={template.key}
                  className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300"
                  onClick={() => void loadTemplate(template.key)}
                >
                  {template.id}
                </button>
              ))}
            </div>
            <article className="markdown">
              <ReactMarkdown>{content}</ReactMarkdown>
            </article>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">Select a report to view.</div>
        )}
      </section>
    </div>
  );
}

function nextMonth(current?: string) {
  const base = current ?? new Date().toISOString().slice(0, 7);
  const [year, month] = base.split("-").map(Number);
  if (!year || !month) return null;
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function formatWindowLabel(window: { days: number; hours?: number }) {
  if (window.hours && window.hours > 0) {
    return `${window.hours} hour window`;
  }
  return `${window.days} day window`;
}

function formatIndexLabel(item: { days: number; hours?: number }) {
  if (item.hours && item.hours > 0) {
    return `${item.hours} hour window`;
  }
  return `${item.days} day window`;
}
