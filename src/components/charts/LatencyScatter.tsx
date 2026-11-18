import { ScatterChart as MantineScatterChart } from "@mantine/charts";
import { fmtHours, shortRepo } from "../../lib/format";
import { VERDICT_BARS } from "./colors";
import { AccessibleChart } from "../AccessibleChart";

type LatPoint = {
    at: string;
    hours: number;
    repo: string;
    number: number;
    verdict: string | null;
};

// One dot per review: when you reviewed (x) vs how long it took (y).
export function LatencyScatter({ points }: { points: LatPoint[] }) {
    const verdictLabel = (verdict: string | null) =>
        VERDICT_BARS.find(([key]) => key === verdict)?.[1] ??
        verdict ??
        "No verdict";
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
    const chart = (
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
                    return `${shortRepo(point.repo)} #${point.number} · ${verdictLabel(point.verdict)}`;
                },
            }}
        />
    );
    return (
        <AccessibleChart
            summary={`Review latency: ${points.length} reviews. Latency is measured in hours.`}
            columns={[
                "Reviewed",
                "Repository",
                "PR",
                "Verdict",
                "Latency (hours)",
            ]}
            rows={points.map((point) => [
                new Date(point.at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                }),
                point.repo,
                point.number,
                verdictLabel(point.verdict),
                point.hours,
            ])}
        >
            {chart}
        </AccessibleChart>
    );
}
