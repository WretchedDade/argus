// Parse a date-only key ("YYYY-MM-DD") as a LOCAL date. Using `new Date(key)`
// would parse it as UTC midnight and shift the day in negative-offset zones.
export function localDate(key: string): Date {
    const [y, m, d] = key.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function localDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
