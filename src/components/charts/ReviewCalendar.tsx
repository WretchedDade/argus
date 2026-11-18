import { Heatmap } from "@mantine/charts";
import { ScrollArea, Stack, Text } from "@mantine/core";
import { localDate, localDayKey } from "./dates";
import type { RhythmItem } from "./types";

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
