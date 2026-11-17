import {
    Accordion,
    Container,
    Group,
    Paper,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Table,
    Text,
    Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { configQuery, insightsQuery, type InsightsCount } from "../lib/api";
import {
    AuthorTreemap,
    CoverageWaffle,
    Donut,
    HBars,
    LatencyScatter,
    LoadChart,
    ReviewCalendar,
    ReviewRhythm,
    VoteBars,
} from "../components/Charts";
import { authorType, fmtHours, shortRepo } from "../lib/format";

export const Route = createFileRoute("/insights")({
    loader: ({ context }) => context.queryClient.ensureQueryData(insightsQuery),
    component: InsightsPage,
});

function Kpi({ label, value }: { label: string; value: string }) {
    return (
        <Stack gap={4}>
            <Text size="xl" fw={600}>
                {value}
            </Text>
            <Text size="sm" c="dimmed">
                {label}
            </Text>
        </Stack>
    );
}

// Collapse a long count list to the top `n` plus an aggregated "Other" slice,
// so pie charts stay legible when there are many categories (e.g. repos).
function topWithOther(counts: InsightsCount[], n: number): InsightsCount[] {
    if (counts.length <= n) return counts;
    const top = counts.slice(0, n);
    const other = counts.slice(n).reduce((sum, c) => sum + c.count, 0);
    return other > 0 ? [...top, { label: "Other", count: other }] : top;
}

type ReachItem = {
    at: string;
    author: string;
    vendor: boolean;
    repo: string;
    teams: string[];
};

// A short calendar date, and a rough human span from a date to now — used by the
// all-time review summary so you can see the window the totals cover.
function fmtDate(iso: string | null): string {
    return iso
        ? new Date(iso).toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
          })
        : "—";
}
function humanSpan(fromIso: string | null): string {
    if (!fromIso) return "";
    const days = Math.max(
        1,
        Math.round((Date.now() - Date.parse(fromIso)) / 86_400_000),
    );
    if (days < 14) return `${days} days`;
    if (days < 70) return `${Math.round(days / 7)} weeks`;
    if (days < 365) return `${Math.round(days / 30)} months`;
    return `${(days / 365).toFixed(1)} years`;
}

// Aggregate reach footprint records for a rolling window (days), or all-time when
// days is null. Runs on the client so the recency selector switches instantly.
function computeReach(items: ReachItem[], days: number | null) {
    const cutoff = days ? Date.now() - days * 86_400_000 : 0;
    const authorMap = new Map<string, number>();
    const repoMap = new Map<string, number>();
    const teamSet = new Set<string>();
    const typeCount = { FTE: 0, Vendor: 0, Automated: 0 };
    let vendor = 0;
    let prs = 0;
    for (const i of items) {
        if (days && Date.parse(i.at) < cutoff) continue;
        prs++;
        authorMap.set(i.author, (authorMap.get(i.author) ?? 0) + 1);
        repoMap.set(i.repo, (repoMap.get(i.repo) ?? 0) + 1);
        typeCount[authorType(i.author, i.vendor)]++;
        if (i.vendor) vendor++;
        for (const t of i.teams) teamSet.add(t);
    }
    const byAuthor = [...authorMap.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, c) => c.count - a.count);
    const byRepo = [...repoMap.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, c) => c.count - a.count);
    const byType = (["FTE", "Vendor", "Automated"] as const).map((label) => ({
        label,
        count: typeCount[label],
    }));
    return {
        prs,
        authors: authorMap.size,
        teams: teamSet.size,
        vendorShare: prs ? vendor / prs : 0,
        byAuthor,
        byRepo,
        byType,
    };
}

function InsightsPage() {
    const data = useQuery(insightsQuery).data;
    const cfg = useQuery(configQuery).data;
    const labels = cfg?.teamLabels ?? {};
    const [gran, setGran] = useState<"day" | "week">("week");
    const [latView, setLatView] = useState<"scatter" | "distribution">(
        "scatter",
    );
    const [reachWin, setReachWin] = useState<"7" | "30" | "90" | "all">("30");
    const [loadWin, setLoadWin] = useState<"7" | "30" | "90" | "all">("30");
    const [rhythmView, setRhythmView] = useState<"day" | "calendar">("day");
    const [calendarMonths, setCalendarMonths] = useState<3 | 6 | 12>(3);
    if (!data) return <p className="text-muted text-sm">Loading…</p>;

    const {
        summary,
        latency,
        throughput,
        backlog,
        distribution,
        load,
        reach,
        votePattern,
        reviewDepth,
        reviewCoverage,
        reviewRhythm,
    } = data;
    const activeTotal = distribution.byAuthorType.reduce(
        (sum, c) => sum + c.count,
        0,
    );
    const reachDays = reachWin === "all" ? null : Number(reachWin);
    const r = computeReach(reach.items, reachDays);
    const rl = computeReach(
        reach.items,
        loadWin === "all" ? null : Number(loadWin),
    );
    const loadData = gran === "day" ? load.daily : load.weekly;
    const hasLoad = load.weekly.some(
        (b) => b.inflow > 0 || b.throughput > 0 || b.backlog > 0,
    );

    return (
        <Container size="md" px={0}>
            <Stack gap="lg">
                <Stack gap={4}>
                    <Title order={1} size="h3">
                        Insights
                    </Title>
                    {summary.reviewsAllTime > 0 && (
                        <Text size="sm" c="dimmed">
                            <Text span inherit fw={600} c="text">
                                {summary.reviewsAllTime}
                            </Text>{" "}
                            PRs reviewed over {humanSpan(summary.firstReviewAt)}{" "}
                            · since {fmtDate(summary.firstReviewAt)}
                            {summary.trackingSince
                                ? ` · tracking since ${fmtDate(summary.trackingSince)}`
                                : ""}
                        </Text>
                    )}
                </Stack>
                <Paper
                    component="section"
                    aria-label="Review summary"
                    withBorder
                    p="md"
                >
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
                        <Kpi
                            label="Median review latency"
                            value={fmtHours(latency.medianHours)}
                        />
                        <Kpi
                            label="PRs reviewed (8 wks)"
                            value={String(throughput.total)}
                        />
                        <Kpi
                            label="Waiting on you"
                            value={String(backlog.waitingCount)}
                        />
                        <Kpi
                            label="Active reviews"
                            value={String(activeTotal)}
                        />
                    </SimpleGrid>
                </Paper>

                <Paper
                    component="section"
                    withBorder
                    p="md"
                    aria-labelledby="load-capacity-heading"
                >
                    <Stack gap="md">
                        <Group justify="space-between">
                            <Title
                                id="load-capacity-heading"
                                order={2}
                                size="h4"
                            >
                                Load & capacity
                            </Title>
                            <SegmentedControl
                                aria-label="Load granularity"
                                value={gran}
                                onChange={(value) => {
                                    if (value === "day" || value === "week")
                                        setGran(value);
                                }}
                                data={[
                                    { value: "week", label: "Week" },
                                    { value: "day", label: "Day" },
                                ]}
                            />
                        </Group>
                        {hasLoad ? (
                            <>
                                <LoadChart
                                    data={loadData}
                                    granularity={gran}
                                    periods={cfg?.periods ?? []}
                                />
                                <Text size="sm" c="dimmed">
                                    Bars show new and reviewed PRs. The area
                                    shows{" "}
                                    {gran === "week"
                                        ? "the peak daily load in each week."
                                        : "PRs on your plate that day."}
                                </Text>
                            </>
                        ) : (
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                No review activity captured yet.
                            </Text>
                        )}
                    </Stack>
                </Paper>

                <Paper
                    component="section"
                    withBorder
                    p="md"
                    aria-labelledby="responsiveness-heading"
                >
                    <Stack gap="md">
                        <Group justify="space-between">
                            <Title
                                id="responsiveness-heading"
                                order={2}
                                size="h4"
                            >
                                Review responsiveness
                            </Title>
                            {latency.count > 0 && (
                                <SegmentedControl
                                    aria-label="Responsiveness view"
                                    value={latView}
                                    onChange={(value) => {
                                        if (
                                            value === "scatter" ||
                                            value === "distribution"
                                        )
                                            setLatView(value);
                                    }}
                                    data={[
                                        {
                                            value: "scatter",
                                            label: "Over time",
                                        },
                                        {
                                            value: "distribution",
                                            label: "Distribution",
                                        },
                                    ]}
                                />
                            )}
                        </Group>
                        <Text size="sm" c="dimmed">
                            Time from the reviewed commit's author timestamp to
                            your recorded verdict.
                        </Text>
                        {latency.count === 0 ? (
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                {latency.pending > 0
                                    ? `Resolving ${latency.pending} recorded review${latency.pending === 1 ? "" : "s"}… check back after the next sync.`
                                    : "No recorded reviews yet. This fills in as you record verdicts."}
                            </Text>
                        ) : (
                            <>
                                <SimpleGrid
                                    cols={{ base: 2, sm: 4 }}
                                    spacing="lg"
                                >
                                    <Kpi
                                        label="Median"
                                        value={fmtHours(latency.medianHours)}
                                    />
                                    <Kpi
                                        label="90th percentile"
                                        value={fmtHours(latency.p90Hours)}
                                    />
                                    <Kpi
                                        label="Fastest"
                                        value={fmtHours(latency.fastestHours)}
                                    />
                                    <Kpi
                                        label="Slowest"
                                        value={fmtHours(latency.slowestHours)}
                                    />
                                </SimpleGrid>
                                <Text size="sm" c="dimmed">
                                    {latency.count} measured
                                    {latency.pending
                                        ? ` · ${latency.pending} pending`
                                        : ""}
                                </Text>
                                {latView === "scatter" ? (
                                    <LatencyScatter points={latency.points} />
                                ) : (
                                    <HBars data={latency.distribution} />
                                )}
                            </>
                        )}
                    </Stack>
                </Paper>

                <Paper
                    component="section"
                    withBorder
                    p="md"
                    aria-labelledby="reach-heading"
                >
                    <Stack gap="md">
                        <Group justify="space-between">
                            <Title id="reach-heading" order={2} size="h4">
                                Review reach
                            </Title>
                            <SegmentedControl
                                aria-label="Review reach window"
                                size="xs"
                                value={reachWin}
                                onChange={(value) => {
                                    if (
                                        value === "7" ||
                                        value === "30" ||
                                        value === "90" ||
                                        value === "all"
                                    )
                                        setReachWin(value);
                                }}
                                data={[
                                    { value: "7", label: "7 days" },
                                    { value: "30", label: "30 days" },
                                    { value: "90", label: "90 days" },
                                    { value: "all", label: "All time" },
                                ]}
                            />
                        </Group>
                        <Text size="sm" c="dimmed">
                            Review-queue PRs first tracked by Argus in this
                            window, including those you have not reviewed. PRs
                            without a known author are excluded.
                        </Text>
                        {r.prs === 0 ? (
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                No tracked review PRs in this window.
                            </Text>
                        ) : (
                            <>
                                <SimpleGrid
                                    cols={{ base: 2, sm: 4 }}
                                    spacing="lg"
                                >
                                    <Kpi label="PRs" value={String(r.prs)} />
                                    <Kpi
                                        label="Authors"
                                        value={String(r.authors)}
                                    />
                                    <Kpi
                                        label="Teams"
                                        value={String(r.teams)}
                                    />
                                    <Kpi
                                        label="Vendor share"
                                        value={`${Math.round(r.vendorShare * 100)}%`}
                                    />
                                </SimpleGrid>
                                <Title order={3} size="h5">
                                    PRs by author
                                </Title>
                                <AuthorTreemap
                                    authors={topWithOther(r.byAuthor, 12)}
                                />
                                {r.byAuthor.length > 12 && (
                                    <Accordion>
                                        <Accordion.Item value="other-authors">
                                            <Accordion.Control>
                                                Other authors (
                                                {r.byAuthor.length - 12})
                                            </Accordion.Control>
                                            <Accordion.Panel>
                                                <Table>
                                                    <Table.Thead>
                                                        <Table.Tr>
                                                            <Table.Th>
                                                                Author
                                                            </Table.Th>
                                                            <Table.Th ta="right">
                                                                PRs
                                                            </Table.Th>
                                                        </Table.Tr>
                                                    </Table.Thead>
                                                    <Table.Tbody>
                                                        {r.byAuthor
                                                            .slice(12)
                                                            .map((author) => (
                                                                <Table.Tr
                                                                    key={
                                                                        author.label
                                                                    }
                                                                >
                                                                    <Table.Td
                                                                        style={{
                                                                            overflowWrap:
                                                                                "anywhere",
                                                                        }}
                                                                    >
                                                                        {
                                                                            author.label
                                                                        }
                                                                    </Table.Td>
                                                                    <Table.Td ta="right">
                                                                        {
                                                                            author.count
                                                                        }
                                                                    </Table.Td>
                                                                </Table.Tr>
                                                            ))}
                                                    </Table.Tbody>
                                                </Table>
                                            </Accordion.Panel>
                                        </Accordion.Item>
                                    </Accordion>
                                )}
                            </>
                        )}
                    </Stack>
                </Paper>

                <Paper withBorder p="lg">
                    <Stack gap="lg">
                        <Group justify="space-between" align="baseline">
                            <Title order={2} size="h4">
                                How you vote
                            </Title>
                            <Text size="sm" c="dimmed">
                                All time
                                {votePattern.total > 0 &&
                                    ` · ${votePattern.total} PR${votePattern.total === 1 ? "" : "s"}`}
                            </Text>
                        </Group>
                        <Text size="sm" c="dimmed">
                            Latest recorded vote per PR, grouped by author type.
                            Each bar totals 100%; counts in parentheses are PRs.
                        </Text>
                        {votePattern.total === 0 ? (
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                No recorded verdicts yet.
                            </Text>
                        ) : (
                            <VoteBars data={votePattern.byType} />
                        )}
                        <Text size="sm" c="dimmed">
                            Your PRs, manually dismissed PRs, and PRs without a
                            known author are excluded.
                        </Text>
                    </Stack>
                </Paper>

                {reviewDepth.measured > 0 && (
                    <Paper withBorder p="lg">
                        <Stack gap="lg">
                            <Group justify="space-between" align="baseline">
                                <Title order={2} size="h4">
                                    Review thoroughness
                                </Title>
                                <Text size="sm" c="dimmed">
                                    All time · {reviewDepth.measured} PR
                                    {reviewDepth.measured === 1
                                        ? ""
                                        : "s"} · {reviewDepth.totalComments}{" "}
                                    comment
                                    {reviewDepth.totalComments === 1 ? "" : "s"}
                                </Text>
                            </Group>
                            <Text size="sm" c="dimmed">
                                PRs grouped by the number of comments you left.
                                Each PR is counted once.
                            </Text>
                            <Donut
                                data={reviewDepth.histogram.map((bucket) => ({
                                    label: `${bucket.label} comments`,
                                    count: bucket.count,
                                }))}
                            />
                            <Text size="sm" c="dimmed">
                                Includes PRs with a recorded vote and a known
                                comment count. Comment volume is not a review
                                quality score: a review without comments can
                                still be thorough.
                            </Text>
                        </Stack>
                    </Paper>
                )}

                <Paper withBorder p="lg">
                    <Stack gap="lg">
                        <Title order={2} size="h4">
                            Review load & coverage by team
                        </Title>
                        <Text size="sm" c="dimmed">
                            Each square is one PR. Hover for its title and
                            coverage. A PR in multiple teams appears in each
                            team.
                        </Text>
                        {reviewCoverage.origins.length === 0 ? (
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                No tracked review coverage yet.
                            </Text>
                        ) : (
                            <CoverageWaffle
                                data={reviewCoverage.origins}
                                labels={labels}
                            />
                        )}
                        <Text size="sm" c="dimmed">
                            Includes closed PRs. Archived, dismissed,
                            out-of-scope, and stale open PRs are excluded.
                            Individual contains reviews without a team.
                        </Text>
                    </Stack>
                </Paper>

                {reviewRhythm.items.length > 0 && (
                    <Paper withBorder p="lg">
                        <Stack gap="lg">
                            <Group justify="space-between" align="center">
                                <Title order={2} size="h4">
                                    Review rhythm & context-switching
                                </Title>
                                <SegmentedControl
                                    aria-label="Review rhythm view"
                                    value={rhythmView}
                                    onChange={(value) => {
                                        if (
                                            value === "day" ||
                                            value === "calendar"
                                        )
                                            setRhythmView(value);
                                    }}
                                    data={[
                                        { value: "day", label: "By day" },
                                        {
                                            value: "calendar",
                                            label: "Calendar",
                                        },
                                    ]}
                                />
                            </Group>
                            {rhythmView === "day" ? (
                                <ReviewRhythm
                                    items={reviewRhythm.items}
                                    labels={labels}
                                    workStartHour={cfg?.workStartHour ?? 9}
                                    workEndHour={cfg?.workEndHour ?? 17}
                                />
                            ) : (
                                <Stack gap="md">
                                    <Group justify="flex-end">
                                        <SegmentedControl
                                            aria-label="Review calendar range"
                                            value={String(calendarMonths)}
                                            onChange={(value) => {
                                                const months = Number(value);
                                                if (
                                                    months === 3 ||
                                                    months === 6 ||
                                                    months === 12
                                                )
                                                    setCalendarMonths(months);
                                            }}
                                            data={[
                                                {
                                                    value: "3",
                                                    label: "3 months",
                                                },
                                                {
                                                    value: "6",
                                                    label: "6 months",
                                                },
                                                {
                                                    value: "12",
                                                    label: "1 year",
                                                },
                                            ]}
                                        />
                                    </Group>
                                    <ReviewCalendar
                                        items={reviewRhythm.items}
                                        months={calendarMonths}
                                    />
                                </Stack>
                            )}
                        </Stack>
                    </Paper>
                )}

                <Stack gap="lg">
                    <Group justify="space-between" align="center">
                        <Title order={2} size="h4">
                            Review load
                        </Title>
                        <SegmentedControl
                            aria-label="Review load window"
                            size="xs"
                            value={loadWin}
                            onChange={(value) => {
                                if (
                                    value === "7" ||
                                    value === "30" ||
                                    value === "90" ||
                                    value === "all"
                                )
                                    setLoadWin(value);
                            }}
                            data={[
                                { value: "7", label: "7 days" },
                                { value: "30", label: "30 days" },
                                { value: "90", label: "90 days" },
                                { value: "all", label: "All time" },
                            ]}
                        />
                    </Group>
                    <Text size="sm" c="dimmed">
                        Review-queue PRs first tracked by Argus in this window,
                        including those you have not reviewed. PRs without a
                        known author are excluded.
                    </Text>
                    {rl.prs === 0 ? (
                        <Paper withBorder p="lg">
                            <Text size="sm" c="dimmed" ta="center" py="xl">
                                No tracked review PRs in this window.
                            </Text>
                        </Paper>
                    ) : (
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                            <Paper withBorder p="lg">
                                <Stack gap="lg">
                                    <Group
                                        justify="space-between"
                                        align="baseline"
                                    >
                                        <Title order={3} size="h5">
                                            PRs by repository
                                        </Title>
                                        <Text size="sm" c="dimmed">
                                            {rl.prs} PR{rl.prs === 1 ? "" : "s"}
                                        </Text>
                                    </Group>
                                    <Text size="sm" c="dimmed">
                                        Top five repositories, with the rest
                                        combined as Other.
                                    </Text>
                                    <Donut
                                        data={topWithOther(
                                            rl.byRepo.map((c) => ({
                                                label: shortRepo(c.label),
                                                count: c.count,
                                            })),
                                            5,
                                        )}
                                    />
                                </Stack>
                            </Paper>
                            <Paper withBorder p="lg">
                                <Stack gap="lg">
                                    <Group
                                        justify="space-between"
                                        align="baseline"
                                    >
                                        <Title order={3} size="h5">
                                            PRs by author type
                                        </Title>
                                        <Text size="sm" c="dimmed">
                                            {rl.prs} PR{rl.prs === 1 ? "" : "s"}
                                        </Text>
                                    </Group>
                                    <Text size="sm" c="dimmed">
                                        FTE, vendor, and automated authors in
                                        the same window.
                                    </Text>
                                    <Donut data={rl.byType} />
                                </Stack>
                            </Paper>
                        </SimpleGrid>
                    )}
                </Stack>

                {reviewDepth.byType.length > 0 && (
                    <Paper withBorder p="lg">
                        <Stack gap="lg">
                            <Group justify="space-between" align="baseline">
                                <Title order={2} size="h4">
                                    Comments by author type
                                </Title>
                                <Text size="sm" c="dimmed">
                                    All time · {reviewDepth.totalComments}{" "}
                                    comment
                                    {reviewDepth.totalComments === 1 ? "" : "s"}
                                </Text>
                            </Group>
                            <Text size="sm" c="dimmed">
                                Your comments on voted PRs across all tracked
                                history. Not affected by the window above.
                            </Text>
                            {reviewDepth.totalComments === 0 ? (
                                <Text size="sm" c="dimmed" ta="center" py="xl">
                                    No recorded comments yet.
                                </Text>
                            ) : (
                                <Donut
                                    data={reviewDepth.byType.map((t) => ({
                                        label: t.label,
                                        count: t.total,
                                    }))}
                                    unit="comment"
                                />
                            )}
                        </Stack>
                    </Paper>
                )}
            </Stack>
        </Container>
    );
}
