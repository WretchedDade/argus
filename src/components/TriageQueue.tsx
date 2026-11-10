import { ActionIcon, Collapse, Tooltip, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { ErrorBanner, LoadErrorPage } from "./ErrorBanner";
import {
    AlarmClock,
    AlertTriangle,
    Ban,
    ChevronDown,
    ChevronRight,
    FileEdit,
    Hourglass,
    ListChecks,
    UserCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, configQuery, healthQuery, prsQuery, type Pr } from "../lib/api";
import { PrCard } from "./PrCard";
import { pushToast } from "../lib/toast";
import {
    byQueuePriority,
    byRecent,
    isSnoozed,
    isStale,
    needsAction,
} from "../lib/triage";
import { QueueFilters } from "./QueueFilters";
import {
    matchesQueueFilters,
    type QueueFilters as Filters,
} from "../lib/queue-filters";

function CollapsedSection({
    id,
    label,
    hint,
    items,
    labels,
    onRestore,
    collapsible = true,
}: {
    id: string;
    label: string;
    hint?: string;
    items: Pr[];
    labels: Record<string, string>;
    onRestore?: (canonical: string) => void | Promise<void>;
    collapsible?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const shown = collapsible ? open : true;
    return (
        <section id={id} className="scroll-mt-20 flex flex-col gap-2">
            {collapsible ? (
                <UnstyledButton
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="text-muted hover:text-fg flex w-full items-center gap-2 py-1 text-left transition-colors"
                >
                    {open ? (
                        <ChevronDown size={14} />
                    ) : (
                        <ChevronRight size={14} />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-wide">
                        {label}
                    </span>
                    <span className="text-xs opacity-70">{items.length}</span>
                    {hint && (
                        <span className="text-xs opacity-60">· {hint}</span>
                    )}
                </UnstyledButton>
            ) : (
                <div className="flex items-baseline gap-2">
                    <h2 className="text-fg text-sm font-semibold">{label}</h2>
                    <span className="text-muted text-xs">{items.length}</span>
                    {hint && (
                        <span className="text-muted text-xs opacity-70">
                            · {hint}
                        </span>
                    )}
                </div>
            )}
            <Collapse in={shown}>
                <div
                    className={
                        collapsible
                            ? "mt-1.5 flex flex-col gap-1"
                            : "flex flex-col gap-3"
                    }
                >
                    {items.sort(byRecent).map((pr) => (
                        <PrCard
                            key={pr.canonical}
                            pr={pr}
                            labels={labels}
                            variant="compact"
                            onRestore={
                                onRestore
                                    ? () => onRestore(pr.canonical)
                                    : undefined
                            }
                        />
                    ))}
                </div>
            </Collapse>
        </section>
    );
}

interface RailEntry {
    id: string;
    label: string;
    Icon: typeof ListChecks;
}

function SectionRail({ entries }: { entries: RailEntry[] }) {
    if (entries.length < 2) return null;
    const jump = (id: string) =>
        document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return (
        <nav className="fixed left-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5">
            {entries.map((e) => (
                <Tooltip key={e.id} label={e.label} position="right" withArrow>
                    <ActionIcon
                        variant="subtle"
                        type="button"
                        aria-label={e.label}
                        onClick={() => jump(e.id)}
                        className="relative"
                    >
                        <e.Icon size={16} />
                    </ActionIcon>
                </Tooltip>
            ))}
        </nav>
    );
}

function BoardSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="pr-card border-line h-[150px] animate-pulse rounded-xl border opacity-60"
                />
            ))}
        </div>
    );
}

function PollBanner({
    authOk,
    error,
}: {
    authOk: boolean;
    error: string | null;
}) {
    const msg = !authOk
        ? "Not signed in to Azure DevOps. Sign in (or run `az login`), then Refresh."
        : `Last poll failed: ${error}`;
    return (
        <div
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            style={{
                borderColor:
                    "color-mix(in srgb, #d64545 45%, var(--color-line))",
                background: "color-mix(in srgb, #d64545 10%, transparent)",
                color: "color-mix(in srgb, #d64545 60%, var(--color-fg))",
            }}
        >
            <AlertTriangle size={15} className="shrink-0" />
            <span>{msg}</span>
        </div>
    );
}

export function TriageQueue({
    filters,
    onFiltersChange,
}: {
    filters: Filters;
    onFiltersChange: (filters: Filters) => void;
}) {
    const prs = useQuery(prsQuery);
    const cfg = useQuery(configQuery);
    const health = useQuery(healthQuery);
    const qc = useQueryClient();
    const labels = cfg.data?.teamLabels ?? {};
    const recencyDays = cfg.data?.recencyDays ?? 7;
    const poller = health.data?.poller;

    const restore = async (canonical: string) => {
        try {
            await api.setScope(canonical, false);
            pushToast("Back to review");
            void qc.invalidateQueries({ queryKey: ["prs"] });
        } catch {
            pushToast("Couldn't update scope", "error");
        }
    };

    const unsnooze = async (canonical: string) => {
        try {
            await api.setSnooze(canonical, null);
            pushToast("Unsnoozed");
            void qc.invalidateQueries({ queryKey: ["prs"] });
        } catch {
            pushToast("Couldn't unsnooze", "error");
        }
    };

    // First load, before the poller has returned anything.
    if (prs.isLoading && !prs.data) return <BoardSkeleton />;
    if (prs.isError && !prs.data) {
        return (
            <LoadErrorPage
                what="your pull requests"
                error={prs.error}
                onRetry={() => void prs.refetch()}
            />
        );
    }

    const pollBanner =
        poller && (!poller.authOk || poller.lastError) ? (
            <PollBanner authOk={poller.authOk} error={poller.lastError} />
        ) : null;
    const banner = (
        <>
            {prs.isError && (
                <ErrorBanner
                    title="Couldn't load PRs"
                    error={prs.error}
                    onRetry={() => void prs.refetch()}
                />
            )}
            {pollBanner}
        </>
    );

    const allReview = (prs.data ?? []).filter((p: Pr) => p.role !== "author");
    const filterControls = (
        <QueueFilters
            prs={allReview}
            value={filters}
            labels={labels}
            onChange={onFiltersChange}
        />
    );
    const review = allReview.filter((pr) => matchesQueueFilters(pr, filters));

    const now = Date.now();
    const inScope = review.filter((p) => !p.outOfScope);
    const outOfScope = review.filter((p) => p.outOfScope);
    const snoozed = inScope.filter((p) => isSnoozed(p, now));
    const awake = inScope.filter((p) => !isSnoozed(p, now));
    const drafts = awake.filter((p) => p.isDraft);
    const ready = awake.filter((p) => !p.isDraft);
    const covered = ready.filter((p) => p.reviewState === "covered");
    const notCovered = ready.filter((p) => p.reviewState !== "covered");
    const active = notCovered.filter((p) => !isStale(p, recencyDays));
    const stale = notCovered.filter((p) => isStale(p, recencyDays));
    const needs = active.filter((p) => needsAction(p)).length;
    const rail: RailEntry[] = [];
    if (active.length > 0)
        rail.push({
            id: "sec-review",
            label: "Review queue",
            Icon: ListChecks,
        });
    if (covered.length > 0)
        rail.push({ id: "sec-covered", label: "Covered", Icon: UserCheck });
    if (drafts.length > 0)
        rail.push({ id: "sec-drafts", label: "Drafts", Icon: FileEdit });
    if (snoozed.length > 0)
        rail.push({ id: "sec-snoozed", label: "Snoozed", Icon: AlarmClock });
    if (stale.length > 0)
        rail.push({ id: "sec-stale", label: "Stale", Icon: Hourglass });
    if (outOfScope.length > 0)
        rail.push({ id: "sec-scope", label: "Out of scope", Icon: Ban });

    return (
        <div className="flex flex-col gap-6">
            <SectionRail entries={rail} />
            {banner}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="status" className="text-muted text-sm tabular-nums">
                    {review.length === 0 ? (
                        allReview.length === 0 ? (
                            "Nothing to review right now."
                        ) : (
                            "No PRs match these filters. Change or clear the filters to see more PRs."
                        )
                    ) : (
                        <>
                            {needs > 0 ? (
                                <>
                                    <span className="text-fg font-semibold">
                                        {needs}
                                    </span>{" "}
                                    need{needs === 1 ? "s" : ""} you
                                </>
                            ) : (
                                "nothing needs you"
                            )}
                            <span className="mx-1.5">·</span>
                            {active.length} open
                        </>
                    )}
                </div>
                {filterControls}
            </div>

            {active.length > 0 && (
                <section
                    id="sec-review"
                    aria-label="Review queue"
                    className="flex scroll-mt-20 flex-col gap-3"
                >
                    {[...active].sort(byQueuePriority).map((pr) => (
                        <PrCard
                            key={pr.canonical}
                            pr={pr}
                            labels={labels}
                            variant={needsAction(pr) ? "full" : "compact"}
                        />
                    ))}
                </section>
            )}

            {covered.length > 0 && (
                <CollapsedSection
                    id="sec-covered"
                    label="Covered"
                    hint="a teammate already reviewed these for you"
                    items={covered}
                    labels={labels}
                    collapsible={false}
                />
            )}

            {drafts.length > 0 && (
                <CollapsedSection
                    id="sec-drafts"
                    label="Drafts"
                    hint="not ready for review"
                    items={drafts}
                    labels={labels}
                    collapsible={false}
                />
            )}

            {snoozed.length > 0 && (
                <CollapsedSection
                    id="sec-snoozed"
                    label="Snoozed"
                    hint="hidden until later"
                    items={snoozed}
                    labels={labels}
                    onRestore={unsnooze}
                    collapsible={false}
                />
            )}

            {stale.length > 0 && (
                <CollapsedSection
                    id="sec-stale"
                    label="Stale"
                    hint="outside the recency window"
                    items={stale}
                    labels={labels}
                />
            )}

            {outOfScope.length > 0 && (
                <CollapsedSection
                    id="sec-scope"
                    label="Out of scope"
                    hint="you don't need to review these"
                    items={outOfScope}
                    labels={labels}
                    onRestore={restore}
                />
            )}
        </div>
    );
}
