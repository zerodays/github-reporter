"use client";

import { formatMonthLabel, useReportViewer } from "./context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

export function MonthSelector() {
  const { activeMonth, setActiveMonth, monthOptions } = useReportViewer();

  return (
    <Select value={activeMonth} onValueChange={setActiveMonth}>
      <SelectTrigger className="h-8 w-[180px] text-xs">
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent>
        {monthOptions.map((month) => (
          <SelectItem key={month} value={month}>
            {formatMonthLabel(month)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
