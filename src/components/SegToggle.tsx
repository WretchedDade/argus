// Small segmented control (a horizontal row of mutually-exclusive options).
// Shared by the insights views and the tracked-PRs view.
export function SegToggle<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="border-line inline-flex overflow-hidden rounded-md border text-xs">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2 py-0.5 ${value === o.v ? "text-fg" : "text-muted"}`}
          style={value === o.v ? { background: "color-mix(in srgb, var(--color-fg) 10%, transparent)" } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
