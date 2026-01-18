export type SlotWindow = {
  slotKey: string;
  slotType: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  scheduledAt: string;
  window: { start: string; end: string };
};

export type WindowRunResult = SlotWindow & {
  status: "success" | "failed" | "skipped";
  reason?: string;
  durationMs?: number;
  manifestKey?: string;
  outputUri?: string;
  error?: string;
};

export type JobRunResult = {
  jobId: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
  slots: WindowRunResult[];
};
