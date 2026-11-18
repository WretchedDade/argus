import { Label, ReferenceArea } from "recharts";
import { CompositeChart } from "@mantine/charts";
import type { InsightsLoadBucket, Period } from "../../lib/api";
import { localDate } from "./dates";
import { AccessibleChart } from "../AccessibleChart";

const LOAD_COLORS = {
    inflow: "var(--mantine-primary-color-filled)",
    reviewed: "var(--mantine-color-gray-6)",
    backlog: "var(--argus-load-backlog)",
};

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
    const chart = (
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
    return (
        <AccessibleChart
            summary={`Review load across ${data.length} ${granularity === "day" ? "days" : "weeks"}: ${data.reduce((sum, bucket) => sum + bucket.inflow, 0)} new PRs and ${data.reduce((sum, bucket) => sum + bucket.throughput, 0)} reviewed PRs.`}
            columns={[
                granularity === "day" ? "Date" : "Week of",
                "New PRs",
                "Reviewed PRs",
                backlogName,
                "Context",
            ]}
            rows={data.map((bucket) => [
                bucket.key,
                bucket.inflow,
                bucket.throughput,
                bucket.backlog,
                bands
                    .filter(
                        ({ span }) =>
                            bucket.key >= span.x1 && bucket.key <= span.x2,
                    )
                    .map(({ p }) => p.label)
                    .join(", "),
            ])}
        >
            {chart}
        </AccessibleChart>
    );
}
