import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { runQuery, type ActivityEntry, type RunEvent } from "../lib/api";
import { clockTime, durationMs } from "../lib/format";
import { runStatusMeta } from "../lib/runStatus";
import { StatChip } from "../components/StatChip";

export const Route = createFileRoute("/activity/$runId")({
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(runQuery(Number(params.runId))),
    component: RunDetail,
});

function voteLabel(v: number): string {
    if (v >= 10) return "approved";
    if (v >= 5) return "approved w/ suggestions";
    if (v <= -10) return "rejected";
    if (v <= -5) return "waiting on author";
    return "vote reset";
}

function changeLabel(c: RunEvent): string {
    switch (c.type) {
        case "added":
            return "added to queue";
        case "commit_pushed":
            return `new commit ${String(c.payload?.sha ?? "").slice(0, 8)}`;
        case "vote_changed":
            return voteLabel(Number(c.payload?.vote ?? 0));
        case "draft_changed":
            return c.payload?.is_draft ? "marked draft" : "marked ready";
        case "closed":
            return `closed (${String(c.payload?.reason ?? "")})`;
        case "removed":
            return "removed";
        default:
            return c.type;
    }
}

function ChangeRow({ c, color }: { c: RunEvent; color: string }) {
    return (
        <a
            href={c.canonical}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-3 py-1.5 text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--peacock-teal)_9%,transparent)]"
        >
            <span className="text-muted shrink-0 tabular-nums">
                {c.repo} #{c.number}
            </span>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span
                className="shrink-0"
                style={{
                    color: `color-mix(in srgb, ${color} 60%, var(--color-fg))`,
                }}
            >
                {changeLabel(c)}
            </span>
        </a>
    );
}

function ChangeSection({
    title,
    color,
    items,
}: {
    title: string;
    color: string;
    items: RunEvent[];
}) {
    if (items.length === 0) return null;
    return (
        <div className="mt-4">
            <div className="text-muted mb-1.5 text-xs font-medium uppercase tracking-wide">
                {title} ({items.length})
            </div>
            <div className="divide-line border-line divide-y overflow-hidden rounded-lg border">
                {items.map((c) => (
                    <ChangeRow key={c.id} c={c} color={color} />
                ))}
            </div>
        </div>
    );
}

function TraceItem({ entry, last }: { entry: ActivityEntry; last: boolean }) {
    const err = entry.level === "error";
    const dot = err ? "var(--true-color-red, #cf222e)" : "var(--peacock-teal)";
    return (
        <li className="relative pb-2.5 pl-6 last:pb-0">
            {!last && (
                <span className="bg-line absolute top-3 left-[5px] h-full w-px" />
            )}
            <span
                className="absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full"
                style={{ background: dot }}
            />
            <span className="text-muted mr-2 text-xs tabular-nums">
                {clockTime(entry.ts)}
            </span>
            <span
                className={`text-xs ${err ? "text-[var(--true-color-red,#cf222e)]" : ""}`}
            >
                {entry.msg}
            </span>
        </li>
    );
}

function RunDetail() {
    const { runId } = Route.useParams();
    const q = useQuery(runQuery(Number(runId)));
    const run = q.data?.run;
    const entries = q.data?.entries ?? [];
    const changes = q.data?.changes ?? [];
    const running = !!run && !run.finishedAt;

    const added = changes.filter((c) => c.type === "added");
    const updated = changes.filter((c) =>
        ["commit_pushed", "vote_changed", "draft_changed"].includes(c.type),
    );
    const closed = changes.filter((c) =>
        ["closed", "removed"].includes(c.type),
    );

    return (
        <div className="mx-auto max-w-3xl">
            <Link
                to="/activity"
                className="text-muted hover:text-fg mb-3 inline-flex items-center gap-1 text-sm"
            >
                <span>←</span> Runs
            </Link>

            {run ? (
                <>
                    <div className="border-line bg-surface rounded-lg border p-4">
                        <div className="flex items-center gap-2">
                            <span
                                className={`inline-block h-2.5 w-2.5 rounded-full ${running ? "watch-pulse" : ""}`}
                                style={{ background: runStatusMeta(run).color }}
                            />
                            <span className="font-medium">Run #{run.id}</span>
                            <span className="text-muted text-sm">
                                {clockTime(run.startedAt)}
                                {run.finishedAt
                                    ? ` · ${durationMs(run.startedAt, run.finishedAt)}`
                                    : ""}
                            </span>
                            {running && (
                                <span
                                    className="ml-auto text-xs"
                                    style={{ color: "var(--peacock-teal)" }}
                                >
                                    live
                                </span>
                            )}
                        </div>
                        {run.error ? (
                            <p className="mt-2 text-sm text-[var(--true-color-red,#cf222e)]">
                                {run.error}
                            </p>
                        ) : run.finishedAt ? (
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <span className="text-muted text-xs">
                                    {run.mine ?? "–"} matched ·{" "}
                                    {run.tracked ?? "–"} tracked
                                </span>
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
                            </div>
                        ) : null}
                    </div>

                    <ChangeSection
                        title="Added"
                        color="var(--peacock-gold)"
                        items={added}
                    />
                    <ChangeSection
                        title="Updated"
                        color="var(--peacock-teal)"
                        items={updated}
                    />
                    <ChangeSection
                        title="Closed"
                        color="var(--peacock-blue)"
                        items={closed}
                    />
                    {run.finishedAt && changes.length === 0 && (
                        <p className="text-muted mt-4 text-sm">
                            No PR changes this run.
                        </p>
                    )}

                    <div className="text-muted mt-5 mb-1.5 text-xs font-medium uppercase tracking-wide">
                        Trace
                    </div>
                    <ol className="border-line bg-surface rounded-lg border px-4 py-3">
                        {entries.map((e, i) => (
                            <TraceItem
                                key={e.id}
                                entry={e}
                                last={i === entries.length - 1 && !running}
                            />
                        ))}
                        {running && (
                            <li className="relative pl-6">
                                <span
                                    className="watch-pulse absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full"
                                    style={{
                                        background: "var(--peacock-teal)",
                                    }}
                                />
                                <span
                                    className="text-xs"
                                    style={{ color: "var(--peacock-teal)" }}
                                >
                                    watching…
                                </span>
                            </li>
                        )}
                        {entries.length === 0 && !running && (
                            <p className="text-muted text-sm">No trace.</p>
                        )}
                    </ol>
                </>
            ) : (
                <p className="text-muted text-sm">Run not found.</p>
            )}
        </div>
    );
}
