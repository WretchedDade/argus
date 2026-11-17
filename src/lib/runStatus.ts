import type { PollRun } from "./api";

export function runStatusMeta(run: PollRun): {
    label: "Running" | "Failed" | "Completed";
    color: "blue" | "red" | "green";
} {
    if (!run.finishedAt)
        return {
            label: "Running",
            color: "blue",
        };
    if (!run.ok) return { label: "Failed", color: "red" };
    return { label: "Completed", color: "green" };
}
