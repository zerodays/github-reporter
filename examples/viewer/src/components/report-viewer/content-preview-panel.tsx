"use client";

import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useReportViewer } from "./context";

export function ContentPreviewPanel() {
  const { content, activeTemplateId, selectedManifest } = useReportViewer();
  const isStats =
    activeTemplateId === "stats" || selectedManifest?.job?.mode === "stats";
  const statsPayload = isStats ? safeParseJson(content) : null;
  const hourlyTotals = statsPayload
    ? sumHourlyActivity(statsPayload.authors ?? [])
    : [];
  const maxHourly = hourlyTotals.length
    ? Math.max(...hourlyTotals, 1)
    : 1;

  return (
    <Card className="order-2 flex min-h-0 flex-1 flex-col gap-0 border-border/60 bg-background/80 py-0 shadow-sm backdrop-blur lg:order-1">
      <CardContent className="flex min-h-0 flex-1 overflow-hidden p-0">
        {content ? (
          <ScrollArea className="h-full w-full" scrollBar="vertical">
            {statsPayload ? (
              <div className="px-6 py-6">
                <div className="grid gap-4">
                  <div className="grid gap-2 text-xs text-muted-foreground">
                    <span className="text-sm font-semibold text-foreground">
                      Stats overview
                    </span>
                    <div className="flex flex-wrap gap-3">
                      <span>Commits: {statsPayload.totals?.commits ?? 0}</span>
                      <span>
                        PRs: {statsPayload.totals?.prsAuthored ?? 0}
                      </span>
                      <span>
                        Issues: {statsPayload.totals?.issuesClosed ?? 0}
                      </span>
                      <span>
                        Additions: {statsPayload.totals?.additions ?? 0}
                      </span>
                      <span>
                        Deletions: {statsPayload.totals?.deletions ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/70 p-4">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      Activity by hour
                    </div>
                    <div className="flex items-end gap-1">
                      {hourlyTotals.map((value, index) => (
                        <div
                          key={`hour-${index}`}
                          className="flex-1 rounded-sm bg-sky-500/60"
                          style={{
                            height: `${Math.max(
                              4,
                              Math.round((value / maxHourly) * 80)
                            )}px`,
                          }}
                          title={`${index}:00 — ${value}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <article className="markdown px-6 py-6">
                <ReactMarkdown>{content}</ReactMarkdown>
              </article>
            )}
          </ScrollArea>
        ) : (
          <div className="px-6 py-6">
            <p className="text-xs text-muted-foreground">
              Select a template to load content.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function safeParseJson(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sumHourlyActivity(
  authors: Array<{ activityByHour?: number[] }>
) {
  const totals = Array.from({ length: 24 }, () => 0);
  for (const author of authors) {
    for (const [index, value] of (author.activityByHour ?? []).entries()) {
      totals[index] += value ?? 0;
    }
  }
  return totals;
}
