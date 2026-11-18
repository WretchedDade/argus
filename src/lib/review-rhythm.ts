// Minutes within one local day; a gap of exactly 45 minutes stays in one sitting.
export function countReviewSittings(minutes: readonly number[]): number {
    const sorted = [...minutes].sort((a, b) => a - b);
    let count = sorted.length ? 1 : 0;
    for (let i = 1; i < sorted.length; i++)
        if (sorted[i] - sorted[i - 1] > 45) count++;
    return count;
}

type RhythmItem = {
    at: string;
};
type BalanceDay = {
    key: string;
    inflow: number;
    throughput: number;
    level: number;
};

function dayKey(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function computeRhythm(
    items: RhythmItem[],
    days: BalanceDay[],
    heavyLine: number,
    win: { start: number; end: number },
) {
    const inWindow = items.filter((item) => {
        const time = Date.parse(item.at);
        return time >= win.start && time < win.end;
    });
    const byDay = new Map<string, number[]>();
    for (const item of inWindow) {
        const date = new Date(item.at);
        const key = dayKey(date.getTime());
        (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(
            date.getHours() * 60 + date.getMinutes(),
        );
    }
    let sittings = 0;
    let busiest: { key: string; count: number } | null = null;
    for (const [key, minutes] of byDay) {
        sittings += countReviewSittings(minutes);
        if (!busiest || minutes.length > busiest.count)
            busiest = { key, count: minutes.length };
    }
    const startKey = dayKey(win.start);
    const endKey = dayKey(win.end);
    const windowDays = days.filter(
        (day) => day.key >= startKey && day.key < endKey,
    );
    const activeDays = windowDays.filter(
        (day) => day.inflow > 0 || day.throughput > 0 || day.level > 0,
    );
    return {
        sittings,
        busiest,
        activeDays: activeDays.length,
        behind: activeDays.filter((day) => day.inflow > day.throughput).length,
        overload: windowDays.filter((day) => day.level >= heavyLine).length,
    };
}
