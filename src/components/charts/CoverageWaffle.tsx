import { WaffleChart } from "@mantine/charts";
import { ColorSwatch, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { shortRepo } from "../../lib/format";

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
