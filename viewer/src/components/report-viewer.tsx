"use client";

import { CalendarRowPanel } from "./report-viewer/calendar-row-panel";
import { ContentPreviewPanel } from "./report-viewer/content-preview-panel";
import { FilterPanel } from "./report-viewer/filter-panel";
import { ReportDetailsPanel } from "./report-viewer/report-details-panel";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function ReportViewer() {
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
        <CalendarRowPanel />

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <FilterPanel />
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
            <ContentPreviewPanel />
            <ReportDetailsPanel />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
