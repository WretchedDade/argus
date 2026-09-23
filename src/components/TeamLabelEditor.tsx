import { useState } from "react";

// A default friendly label guess: the last backslash-separated segment.
function guessLabel(name: string): string {
  const tail = name.split("\\").pop() ?? name;
  return tail.trim();
}

// Editor for the seen-teams label map: raw ADO team display name -> friendly
// label. Independent of ownership tracking; label any team discovery has seen.
export function TeamLabelEditor({
  value,
  options,
  onChange,
}: {
  value: Record<string, string>;
  options: string[];
  onChange: (v: Record<string, string>) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const entries = Object.entries(value);
  const unlabeled = options.filter((o) => !(o in value) && o.toLowerCase().includes(q.toLowerCase()));

  const addTeam = (name: string) => {
    if (!(name in value)) onChange({ ...value, [name]: guessLabel(name) });
    setQ("");
  };
  const setLabel = (name: string, label: string) => onChange({ ...value, [name]: label });
  const remove = (name: string) => {
    const next = { ...value };
    delete next[name];
    onChange(next);
  };

  return (
    <div className="border-line bg-canvas mt-1 rounded-md border p-1.5">
      {entries.length > 0 && (
        <div className="mb-1 flex flex-col gap-1">
          {entries.map(([name, label]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-muted min-w-0 flex-1 truncate text-xs" title={name}>
                {name}
              </span>
              <input
                value={label}
                onChange={(e) => setLabel(name, e.target.value)}
                placeholder="label"
                className="border-line bg-surface w-32 rounded border px-1.5 py-0.5 text-xs outline-none"
              />
              <button type="button" onClick={() => remove(name)} aria-label="Remove" className="text-muted px-1 text-sm">
                ×
              </button>
            </div>
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
        placeholder="Add a team to label…"
        className="w-full bg-transparent px-1 py-1 text-sm outline-none"
      />
      {open && unlabeled.length > 0 && (
        <div className="border-line mt-1 max-h-48 overflow-auto rounded-md border">
          {unlabeled.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTeam(o)}
              className="hover:bg-surface block w-full truncate px-2 py-1 text-left text-xs"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
