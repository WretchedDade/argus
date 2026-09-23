// A small tinted stat pill (e.g. "3 added"). Text mixes toward the theme
// foreground so it stays legible in light and dark. Renders nothing for 0.
export function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  if (!value) return null;
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium tabular-nums"
      style={{
        color: `color-mix(in srgb, ${color} 60%, var(--color-fg))`,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {value} {label}
    </span>
  );
}
