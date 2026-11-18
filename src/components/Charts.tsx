import { Label, ReferenceArea } from "recharts";
import {
    BarChart as MantineBarChart,
    CompositeChart,
    DonutChart,
    Heatmap,
    ScatterChart as MantineScatterChart,
    Treemap,
    WaffleChart,
} from "@mantine/charts";
import {
    ColorSwatch,
    getContrastColor,
    Group,
    ScrollArea,
    SimpleGrid,
    Stack,
    Text,
    useMantineTheme,
} from "@mantine/core";
import type { InsightsLoadBucket, Period } from "../lib/api";
import { fmtHours, shortRepo } from "../lib/format";

type LatPoint = {
    at: string;
    hours: number;
    repo: string;
    number: number;
    verdict: string | null;
};

export const LOAD_COLORS = {
    inflow: "var(--mantine-primary-color-filled)",
    reviewed: "var(--mantine-color-gray-6)",
    backlog: "var(--argus-load-backlog)",
};

// Parse a date-only key ("YYYY-MM-DD") as a LOCAL date. Using `new Date(key)`
// would parse it as UTC midnight and shift the day in negative-offset zones.
function localDate(key: string): Date {
    const [y, m, d] = key.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
}

function localDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekLabel(iso: string): string {
    return localDate(iso).toLocaleDateString([], {
        month: "numeric",
        day: "numeric",
    });
}

// Load & capacity: New PRs vs Reviewed as grouped bars, with the "on your plate"
// level as an area — all on one shared axis so their heights are comparable.
export function LoadChart({
    data,
    granularity,
    periods = [],
}: {
    data: InsightsLoadBucket[];
    granularity: "day" | "week";
    periods?: Period[];
}) {
    const fmt = (k: string) => {
        if (granularity !== "day") return weekLabel(k);
        const d = localDate(k);
        return `${d.toLocaleDateString([], { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
    };
    const backlogName =
        granularity === "day" ? "On your plate" : "Peak daily load";
    // Map each named period to the span of visible x-axis keys it covers, so it
    // can render as a shaded context band. Day keys are exact dates; week keys are
    // Mondays covering that whole week.
    const keys = data.map((d) => d.key);
    const bandFor = (p: Period): { x1: string; x2: string } | null => {
        const hit = keys.filter((k) => {
            if (granularity === "day") return k >= p.start && k <= p.end;
            const wStart = localDate(k);
            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);
            return localDate(p.start) <= wEnd && localDate(p.end) >= wStart;
        });
        return hit.length ? { x1: hit[0], x2: hit[hit.length - 1] } : null;
    };
    const bands = periods
        .map((p) => ({ p, span: bandFor(p) }))
        .filter(
            (b): b is { p: Period; span: { x1: string; x2: string } } =>
                b.span !== null,
        );
    return (
        <CompositeChart
            h={240}
            data={data}
            dataKey="key"
            withLegend
            withDots={false}
            tickLine="none"
            series={[
                {
                    name: "backlog",
                    label: backlogName,
                    type: "area",
                    color: LOAD_COLORS.backlog,
                },
                {
                    name: "inflow",
                    label: "New PRs",
                    type: "bar",
                    color: LOAD_COLORS.inflow,
                },
                {
                    name: "throughput",
                    label: "Reviewed",
                    type: "bar",
                    color: LOAD_COLORS.reviewed,
                },
            ]}
            xAxisProps={{
                tickFormatter: fmt,
                interval: "preserveStartEnd",
                minTickGap: 8,
            }}
            yAxisProps={{ allowDecimals: false, width: 30 }}
            tooltipProps={{
                labelFormatter: (key) =>
                    typeof key !== "string"
                        ? key
                        : granularity === "day"
                          ? fmt(key)
                          : `Week of ${weekLabel(key)}`,
            }}
            barProps={{ radius: [3, 3, 0, 0] }}
            areaProps={{ fillOpacity: 0.14 }}
            composedChartProps={{
                margin: { top: 8, right: 4, bottom: 0, left: 0 },
            }}
        >
            {bands.map(({ p, span }) => (
                <ReferenceArea
                    key={p.label + span.x1}
                    x1={span.x1}
                    x2={span.x2}
                    yAxisId="left"
                    ifOverflow="extendDomain"
                    fill="var(--mantine-color-violet-6)"
                    fillOpacity={0.12}
                    stroke="var(--mantine-color-violet-6)"
                    strokeOpacity={0.25}
                >
                    <Label
                        value={p.label}
                        position="insideTop"
                        fill="var(--mantine-color-text)"
                        fontSize={10}
                        offset={4}
                    />
                </ReferenceArea>
            ))}
        </CompositeChart>
    );
}

// Horizontal bar list, e.g. aging buckets.
export function HBars({
    data,
    color = "var(--mantine-primary-color-filled)",
}: {
    data: { label: string; count: number }[];
    color?: string;
}) {
    return (
        <MantineBarChart
            h={Math.max(60, data.length * 30 + 8)}
            data={data}
            dataKey="label"
            series={[{ name: "count", label: "PRs", color }]}
            orientation="vertical"
            withXAxis={false}
            gridAxis="none"
            tickLine="none"
            yAxisProps={{ width: 120 }}
            barProps={{ barSize: 14, radius: [0, 4, 4, 0] }}
            barChartProps={{
                margin: { top: 0, right: 24, bottom: 0, left: 0 },
            }}
            withBarValueLabel
        />
    );
}

// Shared verdict labels and colors.
const VERDICT_BARS: [string, string, string][] = [
    ["approved", "Approved", "#009E73"],
    ["suggestions", "Suggestions", "#E69F00"],
    ["waiting", "Waiting", "#D55E00"],
    ["rejected", "Rejected", "#CC79A7"],
];
export function VoteBars({
    data,
}: {
    data: {
        label: string;
        approved: number;
        suggestions: number;
        waiting: number;
        rejected: number;
    }[];
}) {
    const chartData = data.map((row) => ({
        ...row,
        label: `${row.label} (${row.approved + row.suggestions + row.waiting + row.rejected})`,
    }));
    return (
        <MantineBarChart
            h={Math.max(180, data.length * 52 + 80)}
            data={chartData}
            dataKey="label"
            series={VERDICT_BARS.map(([name, label, color]) => ({
                name,
                label,
                color,
            }))}
            orientation="vertical"
            type="percent"
            gridAxis="none"
            tickLine="none"
            xAxisProps={{
                domain: [0, 1],
                ticks: [0, 0.5, 1],
                tickFormatter: (value: number) => `${Math.round(value * 100)}%`,
            }}
            yAxisProps={{ width: 116 }}
            barProps={{ barSize: 26 }}
            withLegend
            legendProps={{ verticalAlign: "bottom" }}
            valueFormatter={(value) => `${value} PR${value === 1 ? "" : "s"}`}
        />
    );
}

// Okabe-Ito colorblind-safe qualitative palette (distinguishable across the
// common CVD types), plus a neutral gray for overflow ("Other").
const PIE_COLORS = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#F0E442",
    "#999999",
];

const COVERAGE_STATUS = {
    me: { label: "Covered by me", color: "#0072B2" },
    teammate: { label: "By teammate", color: "#56B4E9" },
    needs: { label: "Still needs", color: "#B0B0B0" },
} as const;
export function CoverageWaffle({
    data,
    labels,
}: {
    data: {
        team: string;
        total: number;
        me: number;
        teammate: number;
        needs: number;
        prs: {
            number: number;
            repo: string;
            title: string;
            coverage: keyof typeof COVERAGE_STATUS;
        }[];
    }[];
    labels: Record<string, string>;
}) {
    return (
        <Stack gap="lg">
            <Group gap="lg">
                {Object.entries(COVERAGE_STATUS).map(([key, status]) => (
                    <Group key={key} gap="xs" wrap="nowrap">
                        <ColorSwatch color={status.color} size={10} />
                        <Text size="sm" c="dimmed">
                            {status.label}
                        </Text>
                    </Group>
                ))}
            </Group>
            {data.map((origin) => {
                const columns = Math.min(16, Math.max(1, origin.prs.length));
                const rows = Math.max(
                    1,
                    Math.ceil(origin.prs.length / columns),
                );
                const team =
                    origin.team === "Individual"
                        ? origin.team
                        : (labels[origin.team] ?? origin.team);
                return (
                    <Stack key={origin.team} gap="xs">
                        <Group gap="sm" align="baseline">
                            <Text
                                size="sm"
                                fw={500}
                                style={{ overflowWrap: "anywhere" }}
                            >
                                {team}
                            </Text>
                            <Text size="sm" c="dimmed">
                                {origin.total} PR{origin.total === 1 ? "" : "s"}
                            </Text>
                        </Group>
                        <ScrollArea.Autosize mah={200} type="auto">
                            <WaffleChart
                                data={origin.prs.map((pr, index) => ({
                                    key: index,
                                    name: `${shortRepo(pr.repo)} #${pr.number}: ${pr.title} (${COVERAGE_STATUS[pr.coverage].label})`,
                                    value: 1,
                                    color: COVERAGE_STATUS[pr.coverage].color,
                                }))}
                                rows={rows}
                                columns={columns}
                                total={rows * columns}
                                size={columns * 14 + (columns - 1) * 3}
                                gap={3}
                                cellRadius={3}
                                emptyColor="transparent"
                                withLegend={false}
                                withTooltip
                                getTooltipLabel={({ name }) => (
                                    <Text
                                        size="sm"
                                        maw={300}
                                        style={{
                                            whiteSpace: "normal",
                                            overflowWrap: "anywhere",
                                        }}
                                    >
                                        {name}
                                    </Text>
                                )}
                            />
                        </ScrollArea.Autosize>
                    </Stack>
                );
            })}
        </Stack>
    );
}

// One event per recorded review, including repeat verdicts.
type RhythmItem = {
    at: string;
    repo: string;
    team: string | null;
    number: number;
    title: string;
};
const SITTING_GAP_MIN = 45; // reviews within this gap count as one "sitting"
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
            let sittings = sorted.length ? 1 : 0;
            for (let i = 1; i < sorted.length; i++)
                if (sorted[i].min - sorted[i - 1].min > SITTING_GAP_MIN)
                    sittings++;
            return {
                dayMs: sorted[0].dayMs,
                evs: sorted,
                repos: new Set(sorted.map((e) => e.repo)).size,
                sittings,
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
    return (
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
}

export function ReviewCalendar({
    items,
    months = 3,
}: {
    items: RhythmItem[];
    months?: 3 | 6 | 12;
}) {
    const byDay = new Map<string, { count: number; repos: Set<string> }>();
    for (const it of items) {
        const key = localDayKey(new Date(it.at));
        const e =
            byDay.get(key) ??
            byDay.set(key, { count: 0, repos: new Set() }).get(key)!;
        e.count++;
        e.repos.add(it.repo);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = localDayKey(
        new Date(today.getFullYear(), today.getMonth() - months + 1, 1),
    );
    const endDate = localDayKey(today);
    const isWeekday = (key: string) => {
        const day = localDate(key).getDay();
        return day >= 1 && day <= 5;
    };
    const data = Object.fromEntries(
        [...byDay]
            .filter(
                ([key]) => key >= startDate && key <= endDate && isWeekday(key),
            )
            .map(([key, day]): [string, number] => [key, day.count]),
    );
    const dateLabel = (key: string) =>
        localDate(key).toLocaleDateString([], { dateStyle: "medium" });
    const tooltipLabel = (date: string, value: number | null) => {
        const count = value ?? 0;
        const repos = byDay.get(date)?.repos.size ?? 0;
        return `${dateLabel(date)}: ${count} review${count === 1 ? "" : "s"} across ${repos} repo${repos === 1 ? "" : "s"}`;
    };
    return (
        <Stack gap="sm">
            <Text size="sm" c="dimmed">
                {dateLabel(startDate)} to {dateLabel(endDate)}. Weekdays only,
                using local dates.
            </Text>
            <ScrollArea type="auto">
                <Heatmap
                    data={data}
                    startDate={startDate}
                    endDate={endDate}
                    withOutsideDates={false}
                    withMonthLabels
                    withWeekdayLabels
                    weekdayLabels={["", "Mon", "Tue", "Wed", "Thu", "Fri", ""]}
                    rectSize={14}
                    gap={3}
                    colors={[2, 4, 6, 8].map(
                        (shade) => `var(--mantine-primary-color-${shade})`,
                    )}
                    domain={[0, Math.max(1, ...Object.values(data))]}
                    withLegend
                    withTooltip
                    getTooltipLabel={({ date, value }) =>
                        tooltipLabel(date, value)
                    }
                    getRectProps={({ date, value }) => {
                        return !isWeekday(date)
                            ? {
                                  style: { visibility: "hidden" },
                                  "aria-hidden": true,
                              }
                            : {
                                  role: "img",
                                  tabIndex: value ? 0 : -1,
                                  "aria-label": tooltipLabel(date, value),
                              };
                    }}
                />
            </ScrollArea>
        </Stack>
    );
}

export function Donut({
    data,
    unit = "PR",
}: {
    data: { label: string; count: number }[];
    unit?: "PR" | "comment";
}) {
    const segments = data.map((item, index) => ({
        name: item.label,
        value: item.count,
        color: PIE_COLORS[index % PIE_COLORS.length],
    }));
    return (
        <Group gap="lg" justify="center">
            <DonutChart
                data={segments.filter((segment) => segment.value > 0)}
                size={136}
                thickness={28}
                paddingAngle={2}
                chartLabel={data.reduce((sum, item) => sum + item.count, 0)}
                tooltipDataSource="segment"
                valueFormatter={(count) =>
                    `${count} ${unit}${count === 1 ? "" : "s"}`
                }
                styles={{
                    tooltip: { width: 200 },
                    tooltipItemBody: { minWidth: 0 },
                    tooltipItemName: { overflowWrap: "anywhere" },
                    tooltipItemData: {
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                    },
                    tooltipLabel: {
                        maxWidth: 280,
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                    },
                }}
            />
            <Stack gap="xs" miw={120} style={{ flex: 1 }}>
                {segments.map((segment, index) => (
                    <Group key={index} gap="xs" wrap="nowrap">
                        <ColorSwatch
                            color={segment.color}
                            size={10}
                            style={{ flexShrink: 0 }}
                        />
                        <Text
                            size="sm"
                            truncate
                            title={segment.name}
                            style={{ flex: 1 }}
                        >
                            {segment.name}
                        </Text>
                        <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                            {segment.value}
                        </Text>
                    </Group>
                ))}
            </Stack>
        </Group>
    );
}

// One dot per review: when you reviewed (x) vs how long it took (y).
export function LatencyScatter({ points }: { points: LatPoint[] }) {
    const data = points.map((p, pointId) => ({
        ts: Date.parse(p.at),
        hours: p.hours,
        pointId,
    }));
    const series = VERDICT_BARS.map(([verdict, name, color]) => ({
        name,
        color,
        data: data.filter((p) => points[p.pointId].verdict === verdict),
    }));
    const other = data.filter(
        (p) =>
            !VERDICT_BARS.some(
                ([verdict]) => points[p.pointId].verdict === verdict,
            ),
    );
    if (other.length > 0)
        series.push({ name: "Other", color: "gray.6", data: other });
    return (
        <MantineScatterChart
            h={260}
            data={series.filter((s) => s.data.length > 0)}
            dataKey={{ x: "ts", y: "hours" }}
            withLegend
            tickLine="none"
            labels={{ x: "Reviewed", y: "Latency" }}
            valueFormatter={{
                x: (ts) =>
                    new Date(ts).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                    }),
                y: fmtHours,
            }}
            xAxisProps={{
                domain: ["dataMin", "dataMax"],
                tickFormatter: (ts) =>
                    new Date(Number(ts)).toLocaleDateString([], {
                        month: "numeric",
                        day: "numeric",
                    }),
            }}
            yAxisProps={{ width: 60 }}
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
                    const point = points[value.pointId];
                    if (!point) return null;
                    const verdict =
                        VERDICT_BARS.find(
                            ([key]) => key === point.verdict,
                        )?.[1] ??
                        point.verdict ??
                        "No verdict";
                    return `${shortRepo(point.repo)} #${point.number} · ${verdict}`;
                },
            }}
        />
    );
}

function AuthorTreemapTile({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    depth = 0,
    name = "",
}: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    index?: number;
    depth?: number;
    name?: string;
}) {
    const theme = useMantineTheme();
    if (depth === 0) return null;
    const color = PIE_COLORS[index % PIE_COLORS.length];
    // Estimate available characters instead of measuring SVG text.
    const maxChars = Math.floor((width - 16) / 8);
    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={color}
                stroke="var(--chart-stroke-color, var(--mantine-color-body))"
            />
            {maxChars >= 2 && height >= 24 && (
                <text
                    x={x + width / 2}
                    y={y + height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={getContrastColor({
                        color,
                        theme,
                        autoContrast: true,
                    })}
                    fontSize={12}
                    fontFamily="var(--mantine-font-family)"
                >
                    {name.length > maxChars
                        ? `${name.slice(0, maxChars - 1)}…`
                        : name}
                </text>
            )}
        </g>
    );
}

export function AuthorTreemap({
    authors,
}: {
    authors: { label: string; count: number }[];
}) {
    return (
        <Treemap
            height={260}
            data={authors.map((author, index) => ({
                name: author.label,
                value: author.count,
                color: PIE_COLORS[index % PIE_COLORS.length],
            }))}
            autoContrast
            treemapProps={{ content: <AuthorTreemapTile /> }}
            valueFormatter={(count) => `${count} PR${count === 1 ? "" : "s"}`}
        />
    );
}
