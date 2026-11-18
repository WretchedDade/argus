import { ScatterChart as MantineScatterChart } from "@mantine/charts";
import { SimpleGrid, Stack, Text } from "@mantine/core";
import { shortRepo } from "../../lib/format";
import { countReviewSittings } from "../../lib/review-rhythm";
import { PIE_COLORS } from "./colors";
import { localDayKey } from "./dates";
import type { RhythmItem } from "./types";
import { AccessibleChart } from "../AccessibleChart";

function RhythmStat({ value, label }: { value: string; label: string }) {
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

export function ReviewRhythm({
    items,
    labels,
    workStartHour = 9,
    workEndHour = 17,
}: {
    items: RhythmItem[];
    labels: Record<string, string>;
    workStartHour?: number;
    workEndHour?: number;
}) {
    const parsed = items.map((it, pointId) => {
        const d = new Date(it.at);
        return {
            ...it,
            pointId,
            dayKey: localDayKey(d),
            dayMs: new Date(
                d.getFullYear(),
                d.getMonth(),
                d.getDate(),
            ).getTime(),
            min: d.getHours() * 60 + d.getMinutes(),
        };
    });
    const byDay = new Map<string, typeof parsed>();
    for (const p of parsed)
        (byDay.get(p.dayKey) ?? byDay.set(p.dayKey, []).get(p.dayKey)!).push(p);
    const dayStats = [...byDay.values()]
        .map((evs) => {
            const sorted = evs.slice().sort((a, b) => a.min - b.min);
            return {
                dayMs: sorted[0].dayMs,
                evs: sorted,
                repos: new Set(sorted.map((e) => e.repo)).size,
                sittings: countReviewSittings(sorted.map((event) => event.min)),
            };
        })
        .sort((a, b) => b.dayMs - a.dayMs);
    const totalReviews = parsed.length;
    const totalSittings = dayStats.reduce((a, d) => a + d.sittings, 0);
    const avgContexts = dayStats.length
        ? dayStats.reduce((a, d) => a + d.repos, 0) / dayStats.length
        : 0;
    const busiest = dayStats
        .slice()
        .sort((a, b) => b.repos - a.repos || b.evs.length - a.evs.length)[0];
    const mins = parsed.map((p) => p.min);
    const lo = Math.min(workStartHour * 60, ...mins);
    const hi = Math.max(workEndHour * 60, ...mins);
    const span = Math.max(60, hi - lo);
    const rows = dayStats.slice(0, 10);
    const teamsList = [
        ...new Set(rows.flatMap((day) => day.evs.map((event) => event.team))),
    ];
    const teamLabel = (t: string | null) =>
        t === null ? "Individual" : (labels[t] ?? t);
    const dayLabel = (ms: number) =>
        new Date(ms).toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
        });
    const fmtTime = (m: number) => {
        const h = Math.floor(m / 60);
        const ap = h < 12 ? "a" : "p";
        const hh = ((h + 11) % 12) + 1;
        return `${hh}:${String(m % 60).padStart(2, "0")}${ap}`;
    };
    const chartData = teamsList.map((team, index) => ({
        name: teamLabel(team),
        color: team === null ? "gray.6" : PIE_COLORS[index % PIE_COLORS.length],
        data: rows.flatMap((day, dayIndex) =>
            day.evs
                .filter((event) => event.team === team)
                .map((event) => ({
                    min: event.min,
                    day: dayIndex,
                    pointId: event.pointId,
                })),
        ),
    }));
    const formatDay = (index: number) =>
        rows[index] ? dayLabel(rows[index].dayMs) : "";
    const chart = (
        <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="lg">
                <RhythmStat
                    value={String(totalReviews)}
                    label="Recorded reviews"
                />
                <RhythmStat
                    value={String(totalSittings)}
                    label="Review sessions"
                />
                <RhythmStat
                    value={avgContexts.toFixed(1)}
                    label="Repos / active day"
                />
            </SimpleGrid>
            {busiest && (
                <Text size="sm" c="dimmed">
                    Most repos in one day: {dayLabel(busiest.dayMs)},{" "}
                    {busiest.evs.length} reviews across {busiest.repos} repos.
                </Text>
            )}
            <Text size="sm" c="dimmed">
                Totals cover all recorded history. Dots show up to 10 recent
                days with reviews, in local time. Color identifies the PR's
                first listed team, or Individual.
            </Text>
            <MantineScatterChart
                h={Math.max(200, rows.length * 30 + 90)}
                data={chartData}
                dataKey={{ x: "min", y: "day" }}
                labels={{ x: "Local time", y: "Day" }}
                withLegend
                legendProps={{ verticalAlign: "bottom" }}
                tickLine="none"
                gridAxis="y"
                valueFormatter={{ x: fmtTime, y: formatDay }}
                xAxisProps={{
                    domain: [lo, lo + span],
                    allowDecimals: false,
                    tickFormatter: fmtTime,
                }}
                yAxisProps={{
                    reversed: true,
                    domain: [-0.5, Math.max(0.5, rows.length - 0.5)],
                    ticks: rows.map((_, index) => index),
                    width: 100,
                    tickFormatter: formatDay,
                }}
                scatterProps={{ fillOpacity: 0.65 }}
                tooltipProps={{
                    labelFormatter: (_label, payload) => {
                        const value: unknown = payload[0]?.payload;
                        if (
                            !value ||
                            typeof value !== "object" ||
                            !("pointId" in value) ||
                            typeof value.pointId !== "number"
                        )
                            return null;
                        const event = parsed[value.pointId];
                        return event ? (
                            <Text
                                size="sm"
                                maw={300}
                                style={{ overflowWrap: "anywhere" }}
                            >
                                {shortRepo(event.repo)} #{event.number}:{" "}
                                {event.title}
                            </Text>
                        ) : null;
                    },
                }}
            />
            <Text size="sm" c="dimmed">
                Reviews no more than 45 minutes apart on the same day form one
                session. Repos per active day counts distinct repos, not
                measured interruptions.
            </Text>
        </Stack>
    );
    return (
        <AccessibleChart
            summary={`Review rhythm: ${rows.reduce((sum, day) => sum + day.evs.length, 0)} reviews across ${rows.length} recent active days, in local time. Totals cover all recorded history.`}
            columns={[
                "Date",
                "Local time",
                "Repository",
                "PR",
                "Title",
                "Team",
            ]}
            rows={rows.flatMap((day) =>
                day.evs.map((event) => [
                    event.dayKey,
                    fmtTime(event.min),
                    event.repo,
                    event.number,
                    event.title,
                    teamLabel(event.team),
                ]),
            )}
        >
            {chart}
        </AccessibleChart>
    );
}
