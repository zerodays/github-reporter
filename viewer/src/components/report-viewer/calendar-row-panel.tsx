"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getDateForDayKey, listDaysInMonth, useReportViewer, VIEWER_TIME_ZONE } from "./context";

export function CalendarRowPanel() {
  const { activeMonth, itemsByDay, selectedDayKey, selectDay } =
    useReportViewer();
  const [todayKey, setTodayKey] = useState("");
  const [weekdayFormatter, setWeekdayFormatter] = useState<Intl.DateTimeFormat | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayKey(new Intl.DateTimeFormat("en-CA", {
      timeZone: VIEWER_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()));

    setWeekdayFormatter(new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      timeZone: VIEWER_TIME_ZONE,
    }));
  }, []);

  return (
    <Card className="border-border/60 bg-background/70 shadow-sm backdrop-blur p-0 sm:p-0">
      <CardContent className="p-0">
        <ScrollArea className="w-full" scrollBar="horizontal">
          <div className="flex min-w-max gap-2 p-4">
            {listDaysInMonth(activeMonth).map((day) => {
              const date = getDateForDayKey(day, VIEWER_TIME_ZONE);
              const dayItems = itemsByDay.get(day) ?? [];
              const mostRecent = dayItems[0];
              const status = mostRecent?.summary?.status ?? "success";
              const isEmpty = mostRecent?.summary?.empty ?? false;
              const hasReports = dayItems.length > 0;
              const isSelected = selectedDayKey === day;
              const isWeekend = isWeekendInTimeZone(date, VIEWER_TIME_ZONE);
              const isToday = day === todayKey;
              return (
                <Button
                  key={day}
                  variant={hasReports ? "outline" : "ghost"}
                  className={cn(
                    "relative h-16 w-12 shrink-0 flex-col items-center justify-center gap-0.5 text-xs",
                    hasReports && !isWeekend && "!bg-primary/10 border-border hover:!bg-primary/30",
                    hasReports && isWeekend && "!bg-primary/5 border-dashed border-muted-foreground/50 hover:!bg-primary/35",
                    !hasReports && "opacity-40",
                    isWeekend && !hasReports && "border-dashed border-muted-foreground/50 bg-muted/30 text-foreground hover:bg-muted/40 data-[state=active]:bg-muted/50",
                    isSelected && "border-primary ring-2 ring-primary/40"
                  )}
                  disabled={!hasReports}
                  onClick={() => void selectDay(day)}
                >
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {weekdayFormatter?.format(date) ?? "--"}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      isToday
                        ? "text-sky-500"
                        : ""
                    }`}
                  >
                    {day.slice(8, 10)}
                  </span>
                  {hasReports ? (
                    <Badge
                      variant={
                        status === "failed"
                          ? "destructive"
                          : isEmpty
                          ? "outline"
                          : "secondary"
                      }
                      className="px-1.5 text-[9px]"
                    >
                      {dayItems.length > 1
                        ? `${dayItems.length}x`
                        : status === "failed"
                        ? "Failed"
                        : isEmpty
                        ? "Empty"
                        : "Ready"}
                    </Badge>
                  ) : (
                    <span className="text-[9px] text-muted-foreground">--</span>
                  )}
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function isWeekendInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  });
  const weekday = formatter.format(date);
  return weekday === "Sat" || weekday === "Sun";
}
