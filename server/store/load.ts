export function rollToBusinessDay(
    ms: number,
    work: { endHour: number; days: number[] },
): number {
    const dt = new Date(ms);
    const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    if (dt.getHours() >= work.endHour || !work.days.includes(dt.getDay()))
        day.setDate(day.getDate() + 1);
    let guard = 0;
    while (!work.days.includes(day.getDay()) && guard++ < 8)
        day.setDate(day.getDate() + 1);
    return day.getTime();
}

export function loadArrivalTime(pr: {
    role: string | null;
    dismissed: number;
    outOfScope: number;
    isDraft: number;
    addedAt: string;
}): number | null {
    if (pr.role === "author" || pr.dismissed || pr.outOfScope || pr.isDraft)
        return null;
    const start = Date.parse(pr.addedAt);
    return Number.isFinite(start) ? start : null;
}

export function loadEndTime(
    pr: {
        reviewState: string | null;
        updatedAt: string;
        reviewedAt: string | null;
    },
    {
        closedAt,
        staleAt,
        nowMs,
    }: { closedAt?: number; staleAt?: number; nowMs: number },
): number {
    const ends: number[] = [];
    if (closedAt !== undefined) ends.push(closedAt);
    if (pr.reviewState === "covered") ends.push(Date.parse(pr.updatedAt));
    else if (pr.reviewState && VERDICT_STATES.has(pr.reviewState)) {
        // A verdict keeps the PR on the plate through its local calendar day.
        const day = new Date(pr.reviewedAt || pr.updatedAt);
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() + 1);
        ends.push(day.getTime());
    }
    if (staleAt !== undefined) ends.push(staleAt);
    return ends.length ? Math.min(...ends) : nowMs;
}

const VERDICT_STATES = new Set([
    "approved",
    "suggestions",
    "waiting",
    "rejected",
]);
