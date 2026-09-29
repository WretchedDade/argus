import { useState } from "react";
import { nameColor } from "../lib/format";

// Deterministic initials from a display name: first letters of the first two
// name-like tokens (skips a trailing vendor "(...)" suffix).
function initials(name: string): string {
  const clean = name.replace(/\(.*?\)/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase();
}

// A colored initials circle keyed to the name — or a custom image when `imageUrl`
// is set (falls back to initials if the image fails to load). `ring` draws a
// peacock accent ring (used to mark the current user's items).
export function Avatar({
  name,
  imageUrl,
  size = 26,
  ring = false,
}: {
  name: string | null;
  imageUrl?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const label = name ?? "Unknown";
  const color = nameColor(label);
  const ringShadow = ring ? "0 0 0 2px var(--card-bg), 0 0 0 4px var(--peacock-teal)" : undefined;

  if (imageUrl && !broken) {
    return (
      <img
        src={imageUrl}
        alt={label}
        title={label}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: ringShadow }}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: color, boxShadow: ringShadow }}
      title={label}
    >
      {initials(label)}
    </span>
  );
}
