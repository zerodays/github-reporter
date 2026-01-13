/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

const OwnerTypeSchema = z.enum(["user", "org"]);

const JobRegistryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["pipeline", "aggregate", "stats"]),
  schedule: z.object({
    type: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]),
    minute: z.number().optional(),
    hour: z.number().optional(),
    weekday: z.number().optional(),
    dayOfMonth: z.number().optional(),
    month: z.number().optional(),
  }),
  templates: z.array(z.string()),
  outputFormat: z.enum(["markdown", "json"]).optional(),
  outputPrefix: z.string().optional(),
  updatedAt: z.string().optional(),
  version: z.string().optional(),
});

const JobRegistrySchema = z.object({
  owner: z.string(),
  ownerType: OwnerTypeSchema,
  jobs: z.array(JobRegistryItemSchema),
});

const IndexItemSchema = z.object({
  slotKey: z.string(),
  slotType: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]),
  scheduledAt: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.number(),
  hours: z.number().optional(),
  manifestKey: z.string(),
  jobId: z.string().optional(),
  summaryKey: z.string().optional(),
});

const SummarySchema = z.object({
  owner: z.string(),
  ownerType: OwnerTypeSchema,
  jobId: z.string(),
  slotKey: z.string(),
  slotType: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]),
  scheduledAt: z.string(),
  window: z.object({
    start: z.string(),
    end: z.string(),
    days: z.number(),
    hours: z.number().optional(),
  }),
  status: z.enum(["success", "failed"]),
  empty: z.boolean(),
  templates: z.array(z.string()),
  bytes: z.number(),
  manifestKey: z.string(),
});

const ManifestSchema = z.object({
  schemaVersion: z.number().optional(),
  job: z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["pipeline", "aggregate", "stats"]),
      version: z.string().optional(),
    })
    .optional(),
  status: z.enum(["success", "failed"]).optional(),
  error: z.string().optional(),
  owner: z.string(),
  ownerType: OwnerTypeSchema,
  scheduledAt: z.string(),
  slotKey: z.string(),
  slotType: z.enum(["hourly", "daily", "weekly", "monthly", "yearly"]),
  window: z.object({
    start: z.string(),
    end: z.string(),
    days: z.number(),
    hours: z.number().optional(),
  }),
  timezone: z.string().optional(),
  empty: z.boolean().optional(),
  templates: z.array(
    z.object({
      id: z.string(),
      format: z.string(),
      key: z.string(),
      uri: z.string(),
      size: z.number(),
    })
  ),
  repos: z.array(
    z.object({
      name: z.string(),
      commits: z.number(),
      prs: z.number(),
      issues: z.number(),
    })
  ),
  stats: z.object({
    repos: z.number(),
    commits: z.number(),
    prs: z.number(),
    issues: z.number(),
  }),
});

type OwnerType = z.infer<typeof OwnerTypeSchema>;
type JobRegistryItem = z.infer<typeof JobRegistryItemSchema>;
type IndexItem = z.infer<typeof IndexItemSchema>;
type Summary = z.infer<typeof SummarySchema>;
type Manifest = z.infer<typeof ManifestSchema>;

type IndexItemWithSummary = IndexItem & { summary?: Summary };

type ReportViewerContextValue = {
  ownerType: OwnerType;
  owner: string;
  setOwnerType: (value: OwnerType) => void;
  setOwner: (value: string) => void;
  jobs: JobRegistryItem[];
  jobId: string;
  setJobId: (value: string) => void;
  activeMonth: string;
  setActiveMonth: (value: string) => void;
  monthOptions: string[];
  baseIndex: string;
  itemsByDay: Map<string, IndexItemWithSummary[]>;
  selectedDayKey?: string;
  selectedManifest: Manifest | null;
  content: string;
  activeTemplateId: string;
  selectDay: (dayKey: string) => Promise<void>;
  selectTemplate: (templateId: string) => Promise<void>;
  loading: boolean;
  error?: string;
};

const ReportViewerContext = createContext<ReportViewerContextValue | null>(
  null
);

const defaultOwner = process.env.NEXT_PUBLIC_DEFAULT_OWNER ?? "";
const defaultOwnerType = (process.env.NEXT_PUBLIC_DEFAULT_OWNER_TYPE ??
  "user") as OwnerType;
const prefix = process.env.NEXT_PUBLIC_REPORT_PREFIX ?? "reports";
const VIEWER_TIME_ZONE = "Europe/Ljubljana";

function getCurrentMonthKey() {
  return getMonthKeyInTimeZone(new Date(), VIEWER_TIME_ZONE);
}

function getRecentMonths(count: number) {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    date.setUTCMonth(date.getUTCMonth() - i);
    months.push(getMonthKeyInTimeZone(date, VIEWER_TIME_ZONE));
  }
  return months;
}

async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

async function fetchText(url: string) {
  const res = await fetch(url);
  if (!res.ok) return "";
  return res.text();
}

export function ReportViewerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ownerType, setOwnerType] = useState<OwnerType>(defaultOwnerType);
  const [owner, setOwner] = useState(defaultOwner);
  const [jobs, setJobs] = useState<JobRegistryItem[]>([]);
  const [jobId, setJobId] = useState("");
  const [items, setItems] = useState<IndexItemWithSummary[]>([]);
  const [monthsLoaded, setMonthsLoaded] = useState<string[]>([]);
  const [activeMonth, setActiveMonth] = useState(getCurrentMonthKey());
  const [selectedManifest, setSelectedManifest] = useState<Manifest | null>(
    null
  );
  const [content, setContent] = useState("");
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const monthsLoadedRef = useRef<string[]>([]);

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
  const baseIndexRef = useRef(baseIndex);

  const monthOptions = useMemo(() => getRecentMonths(12), []);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, IndexItemWithSummary[]>();
    for (const item of items) {
      const dayKey = getDayKeyInTimeZone(item.scheduledAt, VIEWER_TIME_ZONE);
      if (!dayKey.startsWith(activeMonth)) continue;
      const entry = map.get(dayKey);
      if (entry) {
        entry.push(item);
      } else {
        map.set(dayKey, [item]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    }
    return map;
  }, [items, activeMonth]);

  const selectedDayKey = selectedManifest
    ? getDayKeyInTimeZone(selectedManifest.scheduledAt, VIEWER_TIME_ZONE)
    : undefined;

  const loadJobs = useCallback(async () => {
    if (!owner) return;
    setError(undefined);
    const data = await fetchJson(
      `/api/reports/${jobsIndex}`,
      JobRegistrySchema
    );
    if (!data) {
      setJobs([]);
      setJobId("");
      return;
    }
    setJobs(data.jobs ?? []);
    if (data.jobs?.length) {
      setJobId((current) => current || data.jobs[0]?.id || "");
    }
  }, [jobsIndex, owner]);

  const loadLatest = useCallback(async () => {
    if (!baseIndex) return;
    const requestBaseIndex = baseIndex;
    const latest = await fetchJson(
      `/api/reports/${baseIndex}/latest.json`,
      z.object({
        latest: IndexItemSchema,
      })
    );
    if (baseIndexRef.current !== requestBaseIndex) return;
    if (!latest?.latest?.manifestKey) return;
    const manifest = await fetchJson(
      `/api/reports/${latest.latest.manifestKey}`,
      ManifestSchema
    );
    if (baseIndexRef.current !== requestBaseIndex) return;
    if (!manifest) return;
    setSelectedManifest(manifest);
    const first = manifest.templates[0];
    if (first) {
      setActiveTemplateId(first.id);
      const text = await fetchText(`/api/reports/${first.key}`);
      if (baseIndexRef.current !== requestBaseIndex) return;
      setContent(text);
    }
  }, [baseIndex]);

  const loadMonth = useCallback(
    async (month: string) => {
      if (!baseIndex || !month) return false;
      const requestBaseIndex = baseIndex;
      const index = await fetchJson(
        `/api/reports/${baseIndex}/${month}.json`,
        z.object({ items: z.array(IndexItemSchema).optional() })
      );
      if (baseIndexRef.current !== requestBaseIndex) return false;
      if (!index?.items?.length) return false;
      const enriched = await Promise.all(
        index.items.map(async (item) => {
          const summaryKey =
            item.summaryKey ??
            item.manifestKey.replace(/manifest\.json$/, "summary.json");
          const summary = await fetchJson(
            `/api/reports/${summaryKey}`,
            SummarySchema
          );
          return { ...item, summaryKey, summary: summary ?? undefined };
        })
      );
      if (baseIndexRef.current !== requestBaseIndex) return false;
      setItems((prev) => [...prev, ...enriched]);
      return true;
    },
    [baseIndex]
  );

  const ensureMonthLoaded = useCallback(
    async (month: string) => {
      const loadedMonths = monthsLoadedRef.current;
      if (!month || loadedMonths.includes(month)) return;
      const loaded = await loadMonth(month);
      if (loaded) {
        setMonthsLoaded((prev) =>
          prev.includes(month) ? prev : [...prev, month]
        );
      }
    },
    [loadMonth]
  );

  const selectDay = useCallback(
    async (dayKey: string) => {
      const list = itemsByDay.get(dayKey);
      const mostRecent = list?.[0];
      if (!mostRecent) return;
      const manifest = await fetchJson(
        `/api/reports/${mostRecent.manifestKey}`,
        ManifestSchema
      );
      if (!manifest) return;
      setSelectedManifest(manifest);
      const first = manifest.templates[0];
      if (first) {
        setActiveTemplateId(first.id);
        const text = await fetchText(`/api/reports/${first.key}`);
        setContent(text);
      } else {
        setActiveTemplateId("");
        setContent("");
      }
    },
    [itemsByDay]
  );

  const selectTemplate = useCallback(
    async (templateId: string) => {
      if (!selectedManifest) return;
      const template = selectedManifest.templates.find(
        (entry) => entry.id === templateId
      );
      if (!template) return;
      setActiveTemplateId(templateId);
      const text = await fetchText(`/api/reports/${template.key}`);
      setContent(text);
    },
    [selectedManifest]
  );

  useEffect(() => {
    setJobs([]);
    setJobId("");
    setItems([]);
    setMonthsLoaded([]);
    setSelectedManifest(null);
    setContent("");
    setActiveTemplateId("");
    setError(undefined);
    if (!owner) return;
    void loadJobs();
  }, [owner, ownerType, loadJobs]);

  useEffect(() => {
    monthsLoadedRef.current = monthsLoaded;
  }, [monthsLoaded]);

  useEffect(() => {
    baseIndexRef.current = baseIndex;
    setItems([]);
    setMonthsLoaded([]);
    setSelectedManifest(null);
    setContent("");
    setActiveTemplateId("");
    setError(undefined);
    if (!baseIndex) return;
    void loadLatest();
  }, [baseIndex, loadLatest]);

  useEffect(() => {
    if (!baseIndex) return;
    let active = true;
    setLoading(true);
    void ensureMonthLoaded(activeMonth).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeMonth, baseIndex, ensureMonthLoaded]);

  const value = useMemo<ReportViewerContextValue>(
    () => ({
      ownerType,
      owner,
      setOwnerType,
      setOwner,
      jobs,
      jobId,
      setJobId,
      activeMonth,
      setActiveMonth,
      monthOptions,
      baseIndex,
      itemsByDay,
      selectedDayKey,
      selectedManifest,
      content,
      activeTemplateId,
      selectDay,
      selectTemplate,
      loading,
      error,
    }),
    [
      ownerType,
      owner,
      jobs,
      jobId,
      activeMonth,
      monthOptions,
      baseIndex,
      itemsByDay,
      selectedDayKey,
      selectedManifest,
      content,
      activeTemplateId,
      selectDay,
      selectTemplate,
      loading,
      error,
    ]
  );

  return (
    <ReportViewerContext.Provider value={value}>
      {children}
    </ReportViewerContext.Provider>
  );
}

export function useReportViewer() {
  const ctx = useContext(ReportViewerContext);
  if (!ctx) {
    throw new Error("useReportViewer must be used within ReportViewerProvider");
  }
  return ctx;
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: VIEWER_TIME_ZONE,
  });
}

export function listDaysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayString = String(day).padStart(2, "0");
    days.push(`${monthKey}-${dayString}`);
  }
  return days;
}

function getMonthKeyInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as { year: string; month: string };
  return `${map.year}-${map.month}`;
}

function getDayKeyInTimeZone(value: string, timeZone: string) {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  ) as { year: string; month: string; day: string };
  return `${map.year}-${map.month}-${map.day}`;
}
