import type { ActivityEntry, PollRun, RunEvent } from "./api.ts";

export type TraceLevel = "all" | "issues" | "errors";

export function activityLevelColor(level: string): "red" | "yellow" | "gray" {
    switch (level.toLowerCase()) {
        case "error":
        case "fatal":
            return "red";
        case "warn":
        case "warning":
            return "yellow";
        default:
            return "gray";
    }
}

export function filterTraceEntries(
    entries: ActivityEntry[],
    level: TraceLevel,
    search: string,
): ActivityEntry[] {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
        const color = activityLevelColor(entry.level);
        if (level === "errors" && color !== "red") return false;
        if (level === "issues" && color !== "red" && color !== "yellow")
            return false;
        return (
            !needle ||
            `${entry.ts} ${entry.level} ${entry.msg} ${JSON.stringify(entry.data)}`
                .toLowerCase()
                .includes(needle)
        );
    });
}

export function runChangeSummary(run: PollRun): string {
    const counts = [
        ["added", run.added],
        ["updated", run.updated],
        ["events", run.events],
        ["closed", run.closed],
    ] as const;
    if (counts.every(([, value]) => value === null))
        return "No change counts recorded.";
    return counts
        .map(([label, value]) =>
            value === null ? `${label}: not recorded` : `${value} ${label}`,
        )
        .join(" · ");
}

export function runChangeLabel(change: RunEvent): string {
    switch (change.type) {
        case "added":
            return "Added to queue";
        case "commit_pushed": {
            const sha = change.payload?.sha;
            return typeof sha === "string" && sha
                ? `New commit ${sha}`
                : "New commit";
        }
        case "vote_changed": {
            const vote = Number(change.payload?.vote);
            if (!Number.isFinite(vote)) return "Vote changed";
            if (vote >= 10) return "Approved";
            if (vote >= 5) return "Approved with suggestions";
            if (vote <= -10) return "Rejected";
            if (vote <= -5) return "Waiting on author";
            return "Vote reset";
        }
        case "draft_changed":
            return change.payload?.is_draft ? "Marked draft" : "Marked ready";
        case "closed": {
            const reason = change.payload?.reason;
            return typeof reason === "string" && reason
                ? `Closed (${reason})`
                : "Closed";
        }
        case "removed":
            return "Removed";
        default:
            return change.type;
    }
}
