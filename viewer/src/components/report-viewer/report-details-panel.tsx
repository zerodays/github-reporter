"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReportViewer } from "./context";

function formatWindowLabel(window: { days: number; hours?: number }) {
  if (window.hours && window.hours > 0) {
    return `${window.hours} hour window`;
  }
  return `${window.days} day window`;
}

export function ReportDetailsPanel() {
  const { selectedManifest, activeTemplateId, selectTemplate } =
    useReportViewer();

  return (
    <Card className="order-1 border-border/60 bg-background/70 shadow-sm backdrop-blur lg:order-2">
      {selectedManifest ? (
        <CardContent className="space-y-2">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="text-[10px]">
                {selectedManifest.job?.name ?? "Report"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {selectedManifest.window.start.slice(0, 10)}
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
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground border-b border-border/40 pb-2">
              <span>{selectedManifest.stats?.commits ?? 0} commits</span>
              <span>{selectedManifest.stats?.prs ?? 0} PRs</span>
              <span>{selectedManifest.stats?.issues ?? 0} issues</span>
              <span>{selectedManifest.stats?.repos ?? 0} repos</span>
            </div>
            
            <div className="space-y-2 pt-1">
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

            {selectedManifest.output ? (
              <div className="flex items-center justify-between pt-2">
                <Badge variant="outline" className="text-[9px] uppercase tracking-wider opacity-60">
                  {selectedManifest.output.format}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {(selectedManifest.output.size / 1024).toFixed(1)} KB
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground pt-2">
                No output artifact available.
              </p>
            )}
          </div>
        </CardContent>
      ) : (
        <CardContent className="text-xs text-muted-foreground">
          Select a report to view.
        </CardContent>
      )}
    </Card>
  );
}
