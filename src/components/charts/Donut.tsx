import { DonutChart } from "@mantine/charts";
import { ColorSwatch, Group, Stack, Text } from "@mantine/core";
import { PIE_COLORS } from "./colors";

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
