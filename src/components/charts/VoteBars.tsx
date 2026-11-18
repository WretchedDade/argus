import { BarChart as MantineBarChart } from "@mantine/charts";
import { VERDICT_BARS } from "./colors";

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
