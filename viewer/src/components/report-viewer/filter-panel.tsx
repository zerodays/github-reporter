"use client";

import { useReportViewer } from "./context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function FilterPanel() {
  const {
    ownerType,
    owner,
    setOwnerType,
    setOwner,
    jobs,
    jobId,
    setJobId,
    baseIndex
  } = useReportViewer();

  return (
    <Card className="flex w-80 shrink-0 flex-col gap-0 border-border/60 bg-background/70 py-0 shadow-sm backdrop-blur">
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="grid gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Owner Type
              </span>
              <Select
                value={ownerType}
                onValueChange={(value) => setOwnerType(value as "user" | "org")}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="Select owner type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="org">Org</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Owner
              </span>
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="vucinatim"
                className="h-8 text-xs"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Job
              </span>
              <Select
                value={jobId}
                onValueChange={(value) => setJobId(value)}
                disabled={jobs.length === 0}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="No jobs found" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Tooltip>
              <TooltipTrigger className="text-left text-[10px] text-muted-foreground">
                Data source
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                {baseIndex || "No job selected"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
