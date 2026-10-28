import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { runsQuery, type PollRun } from "../lib/api";
import { clockTime, durationMs, timeAgo } from "../lib/format";
import { runStatusMeta } from "../lib/runStatus";
import { StatChip } from "../components/StatChip";

export const Route = createFileRoute("/activity/")({
    loader: ({ context }) => context.queryClient.ensureQueryData(runsQuery),
    component: RunsList,
});

function RunRow({ run }: { run: PollRun }) {
    const status = runStatusMeta(run);
    const running = !run.finishedAt;
    return (
        <Link
            to="/activity/$runId"
            params={{ runId: String(run.id) }}
            className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--peacock-teal)_9%,transparent)]"
        >
            <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${running ? "watch-pulse" : ""}`}
                style={{ background: status.color }}
            />
            <span className="text-muted shrink-0 text-xs tabular-nums">
                {clockTime(run.startedAt)} · {timeAgo(run.startedAt)}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {run.error ? (
                    <span className="truncate text-sm text-[var(--true-color-red,#cf222e)]">
                        {run.error}
                    </span>
                ) : running ? (
                    <span
                        className="text-sm"
                        style={{ color: "var(--peacock-teal)" }}
                    >
                        watching…
                    </span>
                ) : (
                    <>
                        <StatChip
                            label="added"
                            value={run.added ?? 0}
                            color="var(--peacock-gold)"
                        />
                        <StatChip
                            label="updated"
                            value={run.updated ?? 0}
                            color="var(--peacock-teal)"
                        />
                        <StatChip
                            label="events"
                            value={run.events ?? 0}
                            color="var(--peacock-emerald)"
                        />
                        <StatChip
                            label="closed"
                            value={run.closed ?? 0}
                            color="var(--peacock-blue)"
                        />
                    </>
                )}
            </div>
            <span className="text-muted shrink-0 text-xs tabular-nums">
                {run.finishedAt
                    ? durationMs(run.startedAt, run.finishedAt)
                    : ""}
            </span>
            <span className="text-muted shrink-0 text-xs">›</span>
        </Link>
    );
}

function RunsList() {
    const runs = useQuery(runsQuery);
    const active = runs.data?.find((r) => !r.finishedAt);

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">Poll runs</h2>
                {active && (
                    <Link
                        to="/activity/$runId"
                        params={{ runId: String(active.id) }}
                        className="flex items-center gap-1.5 text-xs"
                        style={{ color: "var(--peacock-teal)" }}
                    >
                        <span
                            className="watch-pulse inline-block h-2 w-2 rounded-full"
                            style={{ background: "var(--peacock-teal)" }}
                        />
                        watching now
                    </Link>
                )}
            </div>
            {runs.data && runs.data.length > 0 ? (
                <div className="divide-line border-line divide-y overflow-hidden rounded-lg border">
                    {runs.data.map((r) => (
                        <RunRow key={r.id} run={r} />
                    ))}
                </div>
            ) : (
                <p className="text-muted text-sm">
                    No runs yet. Hit Refresh to start one.
                </p>
            )}
        </div>
    );
}
