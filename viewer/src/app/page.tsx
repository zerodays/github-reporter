import ReportViewer from "@/components/report-viewer";
import { ReportViewerProvider } from "@/components/report-viewer/context";
import { MonthSelector } from "@/components/report-viewer/month-selector";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_500px_at_15%_-10%,rgba(148,163,184,0.25),transparent_60%)]" />
      <ReportViewerProvider>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-background/70 px-4 backdrop-blur">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">GitHub Reporter</h1>
            <Badge variant="outline" className="text-xs">
              Private proxy mode
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <MonthSelector />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ReportViewer />
        </main>
      </ReportViewerProvider>
    </div>
  );
}
