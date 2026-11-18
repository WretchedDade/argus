// Shared verdict labels and colors.
export const VERDICT_BARS: [string, string, string][] = [
    ["approved", "Approved", "#009E73"],
    ["suggestions", "Suggestions", "#E69F00"],
    ["waiting", "Waiting", "#D55E00"],
    ["rejected", "Rejected", "#CC79A7"],
];

// Okabe-Ito colorblind-safe qualitative palette (distinguishable across the
// common CVD types), plus a neutral gray for overflow ("Other").
export const PIE_COLORS = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#F0E442",
    "#999999",
];
