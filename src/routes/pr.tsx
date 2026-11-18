import { Button, Stack, Text, Timeline, Title } from "@mantine/core";
import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
    api,
    configQuery,
    prDetailQuery,
    type PrEvent,
    type PrReviewState,
} from "../lib/api";
import { PrDetailCard } from "../components/PrCard";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";
import { timeAgo, voteLabel } from "../lib/format";
import { claimPrRefresh, releasePrRefresh } from "../lib/query-defaults";
import { REVIEW_STATE_META } from "../lib/triage";

export const Route = createFileRoute("/pr")({
    validateSearch: (s: Record<string, unknown>): { c: string } => ({
        c: String(s.c ?? ""),
    }),
    loaderDeps: ({ search }) => ({ c: search.c }),
    loader: ({ context, deps }) =>
        deps.c
            ? context.queryClient.ensureQueryData(prDetailQuery(deps.c))
            : null,
    component: PrDetailPage,
});

function eventLabel(e: PrEvent): string {
    const p = e.payload ?? {};
    switch (e.type) {
        case "added":
            return "Added to the queue";
        case "refreshed":
            return "Metadata refreshed";
        case "lane_changed":
            return `Review mode: ${p.lane === "quick" ? "Review for me" : "Review with me"}`;
        case "state_changed":
            return `State changed to ${String(p.state ?? "")}`;
        case "reviewed":
            return "Reviewed";
        case "review_provisional":
            return "Delegate found issues; no vote cast";
        case "vote_changed": {
            const who = p.name ? String(p.name) : "A reviewer";
            return `${who} ${voteLabel(Number(p.vote ?? 0)).toLowerCase()}`;
        }
        case "review_state": {
            const to = p.to
                ? (REVIEW_STATE_META[p.to as PrReviewState]?.label ??
                  String(p.to))
                : "no standing";
            return `Your review state \u2192 ${to}`;
        }
        case "commit_pushed":
            return `New commit ${String(p.sha ?? "").slice(0, 8)}`;
        case "draft_changed":
            return p.isDraft ? "Marked as draft" : "Draft published";
        case "comment_posted":
            return "Comment posted";
        case "snoozed":
            if (p.cleared) return "Snooze cleared";
            if (p.mode === "fte") return "Snoozed until an FTE approves";
            return `Snoozed until ${p.until ? new Date(String(p.until)).toLocaleString() : "later"}`;
        case "fte_woke":
            return p.by
                ? `${String(p.by)} approved — snooze cleared`
                : "An FTE approved — snooze cleared";
        case "dismissed":
            return "Dismissed";
        case "out_of_scope":
            return "Marked out of scope";
        case "in_scope":
            return "Restored to review";
        case "archived":
            return `Archived (${String(p.reason ?? "")})`;
        case "revived":
            return "Restored to the board";
        case "removed":
            return "Removed";
        case "closed":
            return `Closed (${String(p.reason ?? "")})`;
        default:
            return e.type;
    }
}

function PrDetailPage() {
    const { c } = Route.useSearch();
    const q = useQuery(prDetailQuery(c));
    const labels = useQuery(configQuery).data?.teamLabels ?? {};
    const qc = useQueryClient();
    const router = useRouter();

    const goBack = () => {
        // Prefer a real history back so scroll position on the board is restored;
        // fall back to a fresh navigation when opened directly (no history).
        if (window.history.length > 1) router.history.back();
        else void router.navigate({ to: "/" });
    };

    // Fetch the full description once per PR per page load: the bulk poll
    // truncates it, but `az pr show` (via refreshPr) returns the full text.
    useEffect(() => {
        if (!c || !claimPrRefresh(c)) return;
        api.refreshPr(c)
            .then(() => qc.invalidateQueries({ queryKey: ["pr", c] }))
            .catch(() => releasePrRefresh(c));
    }, [c, qc]);

    const pr = q.data?.pr;
    // Show individual reviewer votes (now recorded with a name); hide the legacy
    // nameless/container vote rows and internal refresh events.
    const HIDDEN = new Set(["refreshed"]);
    const events = [...(q.data?.events ?? [])]
        .filter(
            (e) =>
                !HIDDEN.has(e.type) &&
                !(e.type === "vote_changed" && !e.payload?.name),
        )
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

    if (q.isPending) return <PendingPage />;
    if (q.isError && !pr) {
        return (
            <LoadErrorPage
                what="this pull request"
                error={q.error}
                onRetry={() => void q.refetch()}
            />
        );
    }

    return (
        <Stack maw={1024} mx="auto" gap="lg">
            <Button
                variant="default"
                type="button"
                onClick={goBack}
                w="fit-content"
                leftSection={<ArrowLeft size={14} />}
            >
                Board
            </Button>

            {q.isError && (
                <ErrorBanner
                    title="Could not refresh this pull request"
                    error={q.error}
                    onRetry={() => void q.refetch()}
                />
            )}
            {!pr ? (
                <Text size="sm" c="dimmed">
                    PR not found.
                </Text>
            ) : (
                <>
                    <PrDetailCard pr={pr} labels={labels} />

                    <Stack
                        component="section"
                        gap="sm"
                        aria-labelledby="pr-history-heading"
                    >
                        <Title
                            id="pr-history-heading"
                            order={2}
                            size="sm"
                            fw={600}
                        >
                            History
                        </Title>
                        {events.length === 0 ? (
                            <Text size="sm" c="dimmed">
                                No recorded events yet.
                            </Text>
                        ) : (
                            <Timeline
                                active={events.length - 1}
                                bulletSize={10}
                                lineWidth={1}
                                role="list"
                                aria-label="PR history"
                            >
                                {events.map((e) => (
                                    <Timeline.Item
                                        key={e.id}
                                        role="listitem"
                                        title={
                                            <Text size="sm">
                                                {eventLabel(e)}
                                            </Text>
                                        }
                                    >
                                        <Text
                                            component="time"
                                            dateTime={e.ts}
                                            size="xs"
                                            c="dimmed"
                                            title={new Date(
                                                e.ts,
                                            ).toLocaleString()}
                                        >
                                            {timeAgo(e.ts)}
                                        </Text>
                                    </Timeline.Item>
                                ))}
                            </Timeline>
                        )}
                    </Stack>
                </>
            )}
        </Stack>
    );
}
