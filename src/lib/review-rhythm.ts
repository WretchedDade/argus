// Minutes within one local day; a gap of exactly 45 minutes stays in one sitting.
export function countReviewSittings(minutes: readonly number[]): number {
    const sorted = [...minutes].sort((a, b) => a - b);
    let count = sorted.length ? 1 : 0;
    for (let i = 1; i < sorted.length; i++)
        if (sorted[i] - sorted[i - 1] > 45) count++;
    return count;
}
