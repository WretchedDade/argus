import {
    Alert,
    Collapse,
    Group,
    Skeleton,
    Stack,
    Text,
    Title,
    UnstyledButton,
    VisuallyHidden,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { ErrorBanner, LoadErrorPage } from "./ErrorBanner";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
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

function SectionHeading({
    id,
    label,
    count,
    hint,
    expanded,
    onToggle,
}: {
    id: string;
    label: string;
    count: number;
    hint?: string;
    expanded?: boolean;
    onToggle?: () => void;
}) {
    const heading = (
        <Group component="span" gap="xs" wrap="nowrap">
            {onToggle &&
                (expanded ? (
                    <ChevronDown size={14} aria-hidden />
                ) : (
                    <ChevronRight size={14} aria-hidden />
                ))}
            <Text component="span" inherit>
                {label}
            </Text>
            <Text component="span" size="xs" c="dimmed" fw={400}>
                {count}
            </Text>
        </Group>
    );
    return (
        <Group component="header" gap="xs" align="baseline" py={4}>
            <Title id={`${id}-heading`} order={2} size="sm" fw={600}>
                {onToggle ? (
                    <UnstyledButton
                        type="button"
                        onClick={onToggle}
                        aria-expanded={expanded}
                        aria-controls={`${id}-content`}
                    >
                        {heading}
                    </UnstyledButton>
                ) : (
                    heading
                )}
            </Title>
            {hint && (
                <Text size="xs" c="dimmed">
                    {hint}
                </Text>
            )}
        </Group>
    );
}

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
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="scroll-mt-20 flex flex-col gap-2"
        >
            <SectionHeading
                id={id}
                label={label}
                count={items.length}
                hint={hint}
                expanded={shown}
                onToggle={collapsible ? () => setOpen((v) => !v) : undefined}
            />
            <Collapse id={`${id}-content`} expanded={shown}>
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

function BoardSkeleton() {
    return (
        <Stack role="status" aria-busy="true" gap="sm">
            <VisuallyHidden>Loading pull requests…</VisuallyHidden>
            {[0, 1, 2].map((i) => (
                <Skeleton key={i} h={150} radius="md" />
            ))}
        </Stack>
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
        <Alert color="red" icon={<AlertTriangle size={16} />}>
            {msg}
        </Alert>
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

    useEffect(() => {
        if (poller?.lastRunAt) void qc.invalidateQueries({ queryKey: ["prs"] });
    }, [poller?.lastRunAt, qc]);

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
    const checkingEmpty = allReview.length === 0 && !!poller?.running;
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
    return (
        <div className="flex flex-col gap-6">
            {banner}
            <section
                id="sec-review"
                aria-labelledby="sec-review-heading"
                aria-busy={checkingEmpty || undefined}
                className="flex scroll-mt-20 flex-col gap-3"
            >
                <Group component="header" justify="space-between" gap="sm">
                    <Group gap="xs" align="baseline">
                        <Title
                            id="sec-review-heading"
                            order={2}
                            size="sm"
                            fw={600}
                        >
                            Review queue
                        </Title>
                        <Text
                            role="status"
                            size="sm"
                            c="dimmed"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                            {review.length === 0 ? (
                                allReview.length === 0 ? (
                                    checkingEmpty ? (
                                        "Checking Azure DevOps for pull requests…"
                                    ) : (
                                        "Nothing to review right now."
                                    )
                                ) : (
                                    "No PRs match these filters. Change or clear the filters to see more PRs."
                                )
                            ) : (
                                <>
                                    {active.length} in queue
                                    <Text component="span" mx="xs" aria-hidden>
                                        ·
                                    </Text>
                                    <Text component="span" c="text">
                                        {needs} awaiting your review
                                    </Text>
                                </>
                            )}
                        </Text>
                    </Group>
                    {filterControls}
                </Group>
                {checkingEmpty && <BoardSkeleton />}
                {[...active].sort(byQueuePriority).map((pr) => (
                    <PrCard
                        key={pr.canonical}
                        pr={pr}
                        labels={labels}
                        variant={needsAction(pr) ? "full" : "compact"}
                    />
                ))}
            </section>

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
