import { useState } from "react";

// Strip surrounding glob asterisks for a tidier chip label.
function tidy(pattern: string): string {
  return pattern.replace(/^\*+|\*+$/g, "") || pattern;
}

// A searchable multi-select for team reviewer patterns. Options are the teams
// seen during discovery; a typed value that isn't in the list can be added as a
// custom glob pattern.
export function TeamMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const available = options.filter((o) => !value.includes(o) && o.toLowerCase().includes(q.toLowerCase()));
  const canAddCustom = q.trim() && !options.includes(q.trim()) && !value.includes(q.trim());

  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setQ("");
  };

  return (
    <div className="border-line bg-canvas mt-1 rounded-md border p-1.5">
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((t) => (
            <span key={t} className="lane-review flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
              {tidy(t)}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label="Remove">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search teams…"
        className="w-full bg-transparent px-1 py-1 text-sm outline-none"
      />
      {open && (available.length > 0 || canAddCustom) && (
        <div className="border-line mt-1 max-h-48 overflow-auto rounded-md border">
          {available.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(o)}
              className="hover:bg-surface block w-full truncate px-2 py-1 text-left text-xs"
            >
              {o}
            </button>
          ))}
          {canAddCustom && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(q)}
              className="hover:bg-surface block w-full px-2 py-1 text-left text-xs"
              style={{ color: "var(--peacock-teal)" }}
            >
              Add pattern “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
