"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReportViewer, VIEWER_TIME_ZONE } from "./context";

function formatWindowLabel(window: { days: number; hours?: number }) {
  if (window.hours && window.hours > 0) {
    return `${window.hours} hour window`;
  }
  return `${window.days} day window`;
}

function formatDateForBadge(value: string, timeZone: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function ReportDetailsPanel() {
  const { 
    selectedManifest, 
    selectedItems, 
    selectedDayKey, 
    selectRun, 
    jobId 
  } = useReportViewer();

  return (
    <Card className="order-1 border-border/60 bg-background/70 shadow-sm backdrop-blur lg:order-2">
      {selectedManifest ? (
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="text-[10px]">
                {selectedManifest.job?.name ?? "Report"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {formatDateForBadge(selectedManifest.window.start, VIEWER_TIME_ZONE)}
              </Badge>
              {selectedManifest.status === "failed" ? (
                <Badge variant="destructive" className="text-[10px]">
                  Failed
                </Badge>
              ) : selectedManifest.empty ? (
                <Badge variant="outline" className="text-[10px]">
                  Empty
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-lg">
              {selectedManifest.owner} · {formatWindowLabel(selectedManifest.window)}
            </CardTitle>
            <div className="text-[10px] text-muted-foreground">
              Timezone: {VIEWER_TIME_ZONE}
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground border-b border-border/40 pb-2">
              <span>{selectedManifest.stats?.commits ?? 0} commits</span>
              <span>{selectedManifest.stats?.prs ?? 0} PRs</span>
              <span>{selectedManifest.stats?.issues ?? 0} issues</span>
              <span>{selectedManifest.stats?.repos ?? 0} repos</span>
            </div>
            
            <div className="space-y-2 pt-1 border-b border-border/40 pb-2">
              <div className="flex flex-col gap-1 text-[10px] text-muted-foreground/80">
                {selectedManifest.durationMs !== undefined && (
                  <span>Duration: {selectedManifest.durationMs}ms</span>
                )}
                {selectedManifest.llm && (
                  <span>
                    LLM: {selectedManifest.llm.model} 
                    {selectedManifest.llm.inputTokens !== undefined && ` (${selectedManifest.llm.inputTokens}/${selectedManifest.llm.outputTokens} tokens)`}
                  </span>
                )}
                {selectedManifest.dataProfile && (
                  <span>Profile: {selectedManifest.dataProfile}</span>
                )}
                {selectedManifest.source && (
                  <span>Source: {selectedManifest.source.jobId} ({selectedManifest.source.itemCount} items)</span>
                )}
              </div>
            </div>

            {selectedItems.length > 1 && (
              <div className="space-y-2 pt-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Runs for {selectedDayKey}
                </h3>
                <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                  {selectedItems.map((item) => {
                    const isSelected = selectedManifest.scheduledAt === item.scheduledAt;
                    const time = new Date(item.scheduledAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: VIEWER_TIME_ZONE
                    });
                    
                    return (
                      <button
                        key={item.scheduledAt}
                        onClick={() => void selectRun(item)}
                        className={`w-full flex items-center justify-between p-2 rounded-md text-[11px] transition-colors ${
                          isSelected 
                            ? "bg-primary/20 text-primary border border-primary/30" 
                            : "hover:bg-muted/50 border border-transparent"
                        }`}
                      >
                        <span className="font-medium text-[12px]">{time}</span>
                        <div className="flex items-center gap-2">
                          <span className="opacity-60">{(item.outputSize / 1024).toFixed(0)}KB</span>
                          {item.status === "failed" && (
                            <Badge variant="destructive" className="h-4 p-0 px-1 text-[8px]">Err</Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!selectedItems.length && selectedManifest.output && (
               <div className="flex items-center justify-between pt-2">
                <Badge variant="outline" className="text-[9px] uppercase tracking-wider opacity-60">
                  {selectedManifest.output.format}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {(selectedManifest.output.size / 1024).toFixed(1)} KB
                </span>
              </div>
            )}
          </div>
        </CardContent>
      ) : (
        <CardContent className="text-xs text-muted-foreground pt-4">
          Select a report to view.
        </CardContent>
      )}
    </Card>
  );
}
