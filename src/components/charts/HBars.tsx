import { BarChart as MantineBarChart } from "@mantine/charts";
import { AccessibleChart } from "../AccessibleChart";

// Horizontal bar list, e.g. aging buckets.
export function HBars({
    data,
    color = "var(--mantine-primary-color-filled)",
}: {
    data: { label: string; count: number }[];
    color?: string;
}) {
    const chart = (
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
    return (
        <AccessibleChart
            summary={`PR counts: ${data.reduce((sum, item) => sum + item.count, 0)} PRs across ${data.length} categories.`}
            columns={["Category", "PRs"]}
            rows={data.map((item) => [item.label, item.count])}
        >
            {chart}
        </AccessibleChart>
    );
}
