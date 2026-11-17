// Share a stable team palette across badges and card tints.
const PALETTE = [
    "--color-rose-500",
    "--color-orange-500",
    "--color-amber-500",
    "--color-lime-500",
    "--color-emerald-500",
    "--color-cyan-500",
    "--color-blue-500",
    "--color-violet-500",
    "--color-fuchsia-500",
];

// Stable string hash (djb2-ish, kept in 32-bit space).
function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

export function teamAnchor(name: string): string {
    return `var(${PALETTE[hashString(name) % PALETTE.length]})`;
}
