export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function durationMs(startIso: string, endIso: string): string {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Compact age like "3d" / "5h" / "2w" from a timestamp to now.
export function shortAge(iso: string): string {  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d`;
  return `${Math.floor(s / 604_800)}w`;
}

// Friendly future time like "in 45m" / "in 3h" / "tomorrow" / "in 5d".
export function timeUntil(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s <= 0) return "now";
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `in ${Math.round(s / 3600)}h`;
  if (s < 172_800) return "tomorrow";
  return `in ${Math.round(s / 86_400)}d`;
}

// Friendly label for a team display name, from the user's seen-teams label map.
// Falls back to the raw name when no mapping exists.
export function resolveTeamLabel(name: string, labels: Record<string, string>): string {
  return labels[name] ?? name;
}

// Compact duration from a number of hours: "—" / "<1h" / "6h" / "2.5d".
export function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return "<1h";
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(h / 24 < 10 ? 1 : 0)}d`;
}

// Drop the LPE.* / LPE.Starfleet.* repo prefix for compact display, matching the
// subproject folder-naming convention.
export function shortRepo(name: string): string {
  return name.replace(/^LPE\.Starfleet\./, "").replace(/^LPE\./, "");
}

// Deterministic avatar-style hue from a string (repo/author name), so each repo
// gets a stable, distinct accent color without a lookup table.
export function hashHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

// A stable accent color for a name (mid saturation/lightness reads on both themes).
export function nameColor(name: string): string {
  return `hsl(${hashHue(name)} 62% 52%)`;
}

