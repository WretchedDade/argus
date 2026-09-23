import type { PollRun } from "./api";

// Visual status for a run: still going, finished ok, or failed.
export function runStatusMeta(run: PollRun): { label: string; color: string } {
  if (!run.finishedAt) return { label: "running", color: "var(--peacock-teal)" };
  if (!run.ok) return { label: "failed", color: "var(--true-color-red, #cf222e)" };
  return { label: "ok", color: "var(--peacock-emerald)" };
}
