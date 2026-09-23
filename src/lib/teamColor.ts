import type { CSSProperties } from "react";

// Fluent-style deterministic color: hash the name into a fixed palette so a
// given team always gets the same badge color, with no stored map. Entries are
// Tailwind palette CSS variables (perceptually tuned, theme-consistent) chosen
// to spread around the wheel and avoid the blue-green cluster that made teams
// hard to tell apart. Each is mixed against the live theme tokens so the chip
// adapts to light/dark instead of using fixed, mode-blind colors.
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

// Soft tinted background, stronger border, hue-biased text that keeps contrast
// by mixing toward the theme's foreground token.
export function teamBadgeStyle(name: string): CSSProperties {
  const c = teamAnchor(name);
  return {
    background: `color-mix(in srgb, ${c} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 40%, var(--color-line))`,
    color: `color-mix(in srgb, ${c} 60%, var(--color-fg))`,
  };
}
