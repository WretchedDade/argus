import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Label, LabelList, Legend, Pie, PieChart, ReferenceArea, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis } from "recharts";
import { useState } from "react";
import type { InsightsLoadBucket, Period } from "../lib/api";
import { fmtHours, nameColor, shortRepo } from "../lib/format";

type StreamItem = { at: string; author: string | null; isVendor: boolean; verdict: string | null };

type LatPoint = { at: string; hours: number; repo: string; number: number; verdict: string | null };

// Verdict → color (Okabe-Ito), for dot/bar coloring in the responsiveness views.
const VERDICT_COLOR: Record<string, string> = {
  approved: "#009E73",
  suggestions: "#E69F00",
  waiting: "#D55E00",
  rejected: "#CC79A7",
};
const latColor = (v: string | null) => VERDICT_COLOR[v ?? ""] ?? "#0072B2";

// Recharts is intentionally confined to this file. The rest of the app depends
// only on these thin wrappers, so swapping charting libraries later is local.

const AXIS = "#94a3b8"; // slate-400, legible on both light and dark surfaces
const GRID = "rgba(148,163,184,0.18)";
const TOOLTIP = {
  background: "var(--card-bg)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-fg)",
} as const;

// Parse a date-only key ("YYYY-MM-DD") as a LOCAL date. Using `new Date(key)`
// would parse it as UTC midnight and shift the day in negative-offset zones.
function localDate(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Monday-anchored week key (YYYY-MM-DD) for a timestamp, matching the recap/load
// week convention.
function mondayKey(iso: string): string {
  const dt = new Date(iso);
  const dow = (dt.getDay() + 6) % 7; // Mon = 0
  const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - dow);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

function weekLabel(iso: string): string {
  return localDate(iso).toLocaleDateString([], { month: "numeric", day: "numeric" });
}

// Weekly review throughput, quick + full lanes stacked.
export function ThroughputChart({ data }: { data: { week: string; quick: number; review: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={TOOLTIP} labelFormatter={(w) => `Week of ${weekLabel(String(w))}`} />
        <Bar dataKey="review" stackId="a" fill="#14b8a6" name="Full" />
        <Bar dataKey="quick" stackId="a" fill="#38bdf8" name="Quick" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Load & capacity: New PRs vs Reviewed as grouped bars, with the "on your plate"
// level as an area — all on one shared axis so their heights are comparable.
export function LoadChart({ data, granularity, periods = [], onSelectDay }: { data: InsightsLoadBucket[]; granularity: "day" | "week"; periods?: Period[]; onSelectDay?: (key: string) => void }) {
  const fmt = (k: string) => {
    if (granularity !== "day") return weekLabel(k);
    const d = localDate(k);
    return `${d.toLocaleDateString([], { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
  };
  const backlogName = granularity === "day" ? "On your plate" : "Peak on plate";
  // Map each named period to the span of visible x-axis keys it covers, so it
  // can render as a shaded context band. Day keys are exact dates; week keys are
  // Mondays covering that whole week.
  const keys = data.map((d) => d.key);
  const bandFor = (p: Period): { x1: string; x2: string } | null => {
    const hit = keys.filter((k) => {
      if (granularity === "day") return k >= p.start && k <= p.end;
      const wStart = localDate(k);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);
      return localDate(p.start) <= wEnd && localDate(p.end) >= wStart;
    });
    return hit.length ? { x1: hit[0], x2: hit[hit.length - 1] } : null;
  };
  const bands = periods
    .map((p) => ({ p, span: bandFor(p) }))
    .filter((b): b is { p: Period; span: { x1: string; x2: string } } => b.span !== null);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
        onClick={(s: { activeLabel?: string | number }) => {
          if (granularity === "day" && onSelectDay && s?.activeLabel != null) onSelectDay(String(s.activeLabel));
        }}
        style={granularity === "day" && onSelectDay ? { cursor: "pointer" } : undefined}
      >
        {bands.map(({ p, span }) => (
          <ReferenceArea
            key={p.label + span.x1}
            x1={span.x1}
            x2={span.x2}
            ifOverflow="extendDomain"
            fill="#7C4DFF"
            fillOpacity={0.12}
            stroke="#7C4DFF"
            strokeOpacity={0.25}
          >
            <Label value={p.label} position="insideTop" fill="#9575ff" fontSize={10} offset={4} />
          </ReferenceArea>
        ))}
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="key" tickFormatter={fmt} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} interval={granularity === "day" ? 0 : "preserveStartEnd"} minTickGap={8} />
        <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.08)" }}
          contentStyle={TOOLTIP}
          itemStyle={{ color: "var(--color-fg)" }}
          labelFormatter={(k) => (granularity === "day" ? fmt(String(k)) : `Week of ${weekLabel(String(k))}`)}
        />
        <Area type="monotone" dataKey="backlog" name={backlogName} stroke="#E69F00" strokeWidth={2} fill="#E69F00" fillOpacity={0.14} dot={false} isAnimationActive={false} />
        <Bar dataKey="inflow" name="New PRs" fill="#0072B2" radius={[3, 3, 0, 0]} />
        <Bar dataKey="throughput" name="Reviewed" fill="#009E73" radius={[3, 3, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Whose PRs you review, over time. A streamgraph (silhouette-stacked areas): each
// band is an author (or FTE/vendor in "type" mode), thickness = reviews that week.
// Overlays the same named context bands as the load chart.
export function ReviewStreamChart({
  items,
  periods = [],
  mode,
}: {
  items: StreamItem[];
  periods?: Period[];
  mode: "person" | "type";
}) {
  const TOP_N = 10;
  const OTHER = "#94a3b8";
  const weeks = recentWeekKeys(10);
  const weekSet = new Set(weeks);

  const keyOf = (it: StreamItem) => (mode === "type" ? (it.isVendor ? "Vendor" : "FTE") : it.author ?? "Unknown");
  const totals = new Map<string, number>();
  const perWeek = new Map<string, Map<string, number>>();
  for (const w of weeks) perWeek.set(w, new Map());
  for (const it of items) {
    if (!it.verdict) continue;
    const w = mondayKey(it.at);
    if (!weekSet.has(w)) continue;
    const k = keyOf(it);
    totals.set(k, (totals.get(k) ?? 0) + 1);
    const wk = perWeek.get(w)!;
    wk.set(k, (wk.get(k) ?? 0) + 1);
  }

  let series: { key: string; color: string }[];
  let collapse: (k: string) => string;
  if (mode === "type") {
    series = [
      { key: "FTE", color: "#0f9b8e" },
      { key: "Vendor", color: "#E69F00" },
    ];
    collapse = (k) => k;
  } else {
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const top = new Set(ranked.slice(0, TOP_N));
    series = ranked.slice(0, TOP_N).map((k) => ({ key: k, color: nameColor(k) }));
    if (ranked.length > TOP_N) series.push({ key: "Others", color: OTHER });
    collapse = (k) => (top.has(k) ? k : "Others");
  }

  const data = weeks.map((w) => {
    const row: Record<string, string | number> = { key: w };
    for (const s of series) row[s.key] = 0;
    for (const [k, n] of perWeek.get(w)!) {
      const sk = collapse(k);
      row[sk] = ((row[sk] as number) ?? 0) + n;
    }
    return row;
  });

  const bandFor = (p: Period): { x1: string; x2: string } | null => {
    const hit = weeks.filter((k) => {
      const wStart = localDate(k);
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);
      return localDate(p.start) <= wEnd && localDate(p.end) >= wStart;
    });
    return hit.length ? { x1: hit[0], x2: hit[hit.length - 1] } : null;
  };
  const bands = periods
    .map((p) => ({ p, span: bandFor(p) }))
    .filter((b): b is { p: Period; span: { x1: string; x2: string } } => b.span !== null);

  if (![...totals.values()].some((n) => n > 0)) return <p className="text-muted py-8 text-center text-sm">No reviews recorded yet.</p>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} stackOffset="silhouette" margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        {bands.map(({ p, span }) => (
          <ReferenceArea key={p.label + span.x1} x1={span.x1} x2={span.x2} ifOverflow="extendDomain" fill="#7C4DFF" fillOpacity={0.1} stroke="#7C4DFF" strokeOpacity={0.22}>
            <Label value={p.label} position="insideTop" fill="#9575ff" fontSize={10} offset={4} />
          </ReferenceArea>
        ))}
        <XAxis dataKey="key" tickFormatter={weekLabel} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={8} />
        <Tooltip contentStyle={TOOLTIP} itemStyle={{ color: "var(--color-fg)" }} labelFormatter={(k) => `Week of ${weekLabel(String(k))}`} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={mode === "person" ? shortName(s.key) : s.key} stackId="1" stroke={s.color} fill={s.color} fillOpacity={0.72} strokeWidth={0.5} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// The last `n` Monday-anchored week keys, oldest first, ending with this week.
function recentWeekKeys(n: number): string[] {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(thisMon);
    d.setDate(d.getDate() - i * 7);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

// Trim a display name to first name + last initial for a compact legend/tooltip.
function shortName(name: string): string {
  if (name === "Others" || name === "Unknown") return name;
  const clean = name.replace(/\(.*?\)/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Single horizontal 100%-wide segmented bar for an ordered distribution
// (e.g. review depth: silent -> deep). Pure CSS so it stays light next to the
// Recharts pieces. Shows a labeled legend with per-segment share.
export function DepthMeter({ segments }: { segments: { label: string; count: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.count, 0) || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 w-full overflow-hidden rounded-md">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.count} (${pct(s.count)}%)`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="text-muted inline-flex items-center gap-1.5 text-[11px]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="text-fg font-medium">{pct(s.count)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Horizontal bar list of an average (decimal) value per group, with the sample
// size shown in the tooltip. Used by Review depth (avg comments by type/repo/latency).
export function DepthBars({
  data,
  color = "#0072B2",
  width = 120,
}: {
  data: { label: string; avg: number | null; count: number }[];
  color?: string;
  width?: number;
}) {
  const rows = data.filter((d) => d.avg != null).map((d) => ({ ...d, avg: d.avg as number }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(60, rows.length * 30 + 8)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={width} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "rgba(148,163,184,0.08)" }}
          contentStyle={TOOLTIP}
          formatter={(v, _n, p) => [`${Number(v).toFixed(1)} avg · ${(p?.payload as { count?: number })?.count ?? 0} PRs`, "Comments"]}
        />
        <Bar dataKey="avg" fill={color} radius={[0, 4, 4, 0]} barSize={14}>
          <LabelList dataKey="avg" position="right" fill={AXIS} fontSize={11} formatter={(v) => Number(v).toFixed(1)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Horizontal bar list, e.g. aging buckets.
export function HBars({ data, color = "#14b8a6" }: { data: { label: string; count: number }[]; color?: string }) {  return (
    <ResponsiveContainer width="100%" height={Math.max(60, data.length * 30 + 8)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={120} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={TOOLTIP} />
        <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} barSize={14}>
          <LabelList dataKey="count" position="right" fill={AXIS} fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 100%-stacked verdict mix per author type, so you can compare how much you push
// back on FTE vs Vendor code regardless of volume.
const VERDICT_BARS: [string, string, string][] = [
  ["approved", "Approved", "#009E73"],
  ["suggestions", "Suggestions", "#E69F00"],
  ["waiting", "Waiting", "#D55E00"],
  ["rejected", "Rejected", "#CC79A7"],
];
export function VoteBars({
  data,
}: {
  data: { label: string; approved: number; suggestions: number; waiting: number; rejected: number; avg?: number | null }[];
}) {
  const avgByLabel = new Map(data.map((d) => [d.label, d.avg ?? null]));
  const hasAvg = data.some((d) => d.avg != null);
  const tick = (props: { x?: number | string; y?: number | string; payload?: { value?: string } }) => {
    const label = props.payload?.value ?? "";
    const avg = avgByLabel.get(label);
    return (
      <text x={Number(props.x)} y={Number(props.y)} dy={4} textAnchor="end" fontSize={12} fill={AXIS}>
        {label}
        {avg != null && (
          <tspan fill="var(--color-fg)" fontWeight={500}>{`  ·  ${avg.toFixed(1)}`}</tspan>
        )}
        {avg != null && <tspan fill={AXIS}>{" 💬"}</tspan>}
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 48 + 44)}>
      <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={hasAvg ? 104 : 64} tick={tick} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={TOOLTIP} itemStyle={{ color: "var(--color-fg)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: "var(--color-fg)" }}>{v}</span>} />
        {VERDICT_BARS.map(([key, name, color], i) => (
          <Bar key={key} dataKey={key} stackId="v" fill={color} name={name} barSize={26} radius={i === VERDICT_BARS.length - 1 ? [0, 3, 3, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Okabe-Ito colorblind-safe qualitative palette (distinguishable across the
// common CVD types), plus a neutral gray for overflow ("Other").
const PIE_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"];

const RAD = Math.PI / 180;

interface SliceProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  value: number;
  percent: number;
}

// Draw the count inside each slice; skip slivers too small to hold text.
function renderSliceValue(p: SliceProps) {
  if (p.percent < 0.05) return null;
  const r = p.innerRadius + (p.outerRadius - p.innerRadius) * 0.5;
  const x = p.cx + r * Math.cos(-p.midAngle * RAD);
  const y = p.cy + r * Math.sin(-p.midAngle * RAD);
  return (
    <text x={x} y={y} fill="#0b1220" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central">
      {p.value}
    </text>
  );
}

function legendLabel(value: unknown, entry: unknown) {
  const s = String(value);
  const t = s.length > 26 ? `${s.slice(0, 25)}…` : s;
  const count = (entry as { payload?: { count?: number } } | undefined)?.payload?.count;
  return (
    <span style={{ color: "var(--color-fg)" }}>
      {t}
      {count != null && <span style={{ opacity: 0.6 }}> · {count}</span>}
    </span>
  );
}

// Part-to-whole donut. Counts sit on the slices; a vertical legend on the right
// uses the card's horizontal room to map color to (possibly long) names.
// Team review coverage as a unit/waffle grid: one small square per PR, grouped
// in a labeled row per origin and ordered so coverage reads left→right (you →
// teammate → still needs). At unit=1 each square is a real PR (title on hover);
// when a row would get too long, squares scale up and show a generic tooltip.
// Pure CSS, no chart lib.
const COVERAGE_WAFFLE = [
  ["me", "Covered by me", "#0072B2"],
  ["teammate", "By teammate", "#56B4E9"],
  ["needs", "Still needs", "#B0B0B0"],
] as const;
const COVERAGE_COLOR: Record<string, string> = { me: "#0072B2", teammate: "#56B4E9", needs: "#B0B0B0" };
const COVERAGE_NAME: Record<string, string> = { me: "Covered by me", teammate: "By teammate", needs: "Still needs" };
type CovPr = { number: number; repo: string; title: string; coverage: "me" | "teammate" | "needs" };
export function CoverageWaffle({
  data,
  labels,
}: {
  data: { team: string; total: number; me: number; teammate: number; needs: number; prs: CovPr[] }[];
  labels: Record<string, string>;
}) {
  const [hover, setHover] = useState<{ pr: CovPr; team: string; x: number; y: number } | null>(null);
  const rows = data.map((o) => ({
    label: o.team === "Individual" ? "Individual" : (labels[o.team] ?? o.team),
    total: o.total,
    me: o.me,
    teammate: o.teammate,
    needs: o.needs,
    prs: o.prs,
  }));
  // Scale so the biggest row stays legible: one square represents `unit` PRs,
  // chosen from nice steps so no row exceeds ~TARGET squares. Non-zero slices
  // keep at least one square so a small coverage sliver never vanishes.
  const TARGET = 72;
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));
  const unit = [1, 2, 5, 10, 25, 50, 100].find((u) => maxTotal / u <= TARGET) ?? Math.ceil(maxTotal / TARGET);
  const squares = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round(n / unit)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-fg text-xs font-medium">{r.label}</span>
            <span className="text-muted text-[11px]">{r.total} PRs</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {unit === 1
              ? r.prs.map((pr) => (
                  <span
                    key={`${pr.repo}-${pr.number}`}
                    onMouseEnter={(e) => setHover({ pr, team: r.label, x: e.clientX, y: e.clientY })}
                    onMouseMove={(e) => setHover({ pr, team: r.label, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                    className="h-3.5 w-3.5 rounded-[3px] transition-transform hover:scale-125"
                    style={{ background: COVERAGE_COLOR[pr.coverage] }}
                  />
                ))
              : COVERAGE_WAFFLE.flatMap(([key, name, color]) =>
                  Array.from({ length: squares(r[key]) }, (_, i) => (
                    <span
                      key={`${key}-${i}`}
                      title={`${r.label} · ${name}`}
                      className="h-3.5 w-3.5 rounded-[3px]"
                      style={{ background: color }}
                    />
                  )),
                )}
          </div>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {COVERAGE_WAFFLE.map(([key, name, color]) => (
          <span key={key} className="text-muted inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {name}
          </span>
        ))}
        {unit > 1 && <span className="text-muted italic">· each square ≈ {unit} PRs</span>}
      </div>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border p-2.5 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14, background: "var(--card-bg)", borderColor: "var(--color-line)" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COVERAGE_COLOR[hover.pr.coverage] }} />
            <span className="text-fg text-xs font-semibold">
              {shortRepo(hover.pr.repo)} #{hover.pr.number}
            </span>
          </div>
          <div className="text-fg text-xs leading-snug">{hover.pr.title}</div>
          <div className="text-muted mt-1 text-[11px]">
            {COVERAGE_NAME[hover.pr.coverage]} · {hover.team}
          </div>
        </div>
      )}
    </div>
  );
}

// Review rhythm / context-switching punchcard. Rows = days, x = time of day,
// each recorded review a tick colored by team. Density shows volume, clustering
// vs scatter shows batching, color variety shows breadth of contexts. Paired
// with headline stats: total pickups, sittings (interruptions), avg contexts/day.
type RhythmItem = { at: string; repo: string; team: string | null; number: number; title: string };
const SITTING_GAP_MIN = 45; // reviews within this gap count as one "sitting"
function RhythmStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-fg text-2xl font-semibold leading-tight">{value}</span>
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
export function ReviewRhythm({
  items,
  labels,
  workStartHour = 9,
  workEndHour = 17,
}: {
  items: RhythmItem[];
  labels: Record<string, string>;
  workStartHour?: number;
  workEndHour?: number;
}) {
  const [hover, setHover] = useState<{ it: RhythmItem; min: number; x: number; y: number } | null>(null);
  const parsed = items.map((it) => {
    const d = new Date(it.at);
    return {
      ...it,
      dayKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      dayMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
      min: d.getHours() * 60 + d.getMinutes(),
    };
  });
  const byDay = new Map<string, typeof parsed>();
  for (const p of parsed) (byDay.get(p.dayKey) ?? byDay.set(p.dayKey, []).get(p.dayKey)!).push(p);
  const dayStats = [...byDay.values()]
    .map((evs) => {
      const sorted = evs.slice().sort((a, b) => a.min - b.min);
      let sittings = sorted.length ? 1 : 0;
      for (let i = 1; i < sorted.length; i++) if (sorted[i].min - sorted[i - 1].min > SITTING_GAP_MIN) sittings++;
      return { dayMs: sorted[0].dayMs, evs: sorted, repos: new Set(sorted.map((e) => e.repo)).size, sittings };
    })
    .sort((a, b) => b.dayMs - a.dayMs);
  const totalReviews = parsed.length;
  const totalSittings = dayStats.reduce((a, d) => a + d.sittings, 0);
  const avgContexts = dayStats.length ? dayStats.reduce((a, d) => a + d.repos, 0) / dayStats.length : 0;
  const busiest = dayStats.slice().sort((a, b) => b.repos - a.repos || b.evs.length - a.evs.length)[0];
  const mins = parsed.map((p) => p.min);
  const lo = Math.min(workStartHour * 60, ...mins);
  const hi = Math.max(workEndHour * 60, ...mins);
  const span = Math.max(60, hi - lo);
  const pct = (m: number) => ((m - lo) / span) * 100;
  const teamsList = [...new Set(parsed.map((p) => p.team).filter((t): t is string => !!t))];
  const teamColor = (t: string | null) => (t === null ? "#94a3b8" : PIE_COLORS[teamsList.indexOf(t) % PIE_COLORS.length]);
  const teamLabel = (t: string | null) => (t === null ? "Individual" : (labels[t] ?? t));
  const dayLabel = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (m: number) => {
    const h = Math.floor(m / 60);
    const ap = h < 12 ? "a" : "p";
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m % 60).padStart(2, "0")}${ap}`;
  };
  const rows = dayStats.slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <RhythmStat value={String(totalReviews)} label="review pickups" />
        <RhythmStat value={String(totalSittings)} label="separate sittings" />
        <RhythmStat value={avgContexts.toFixed(1)} label="contexts / day" />
      </div>
      {busiest && (
        <div className="text-muted text-[11px]">
          Most draining day: <span className="text-fg font-medium">{dayLabel(busiest.dayMs)}</span> — {busiest.evs.length}{" "}
          reviews across {busiest.repos} repos.
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {rows.map((d) => (
          <div key={d.dayMs} className="flex items-center gap-2">
            <span className="text-muted w-20 shrink-0 text-[11px]">{dayLabel(d.dayMs)}</span>
            <div className="relative h-6 flex-1 rounded" style={{ background: "rgba(148,163,184,0.10)" }}>
              {d.evs.map((e, i) => (
                <span
                  key={i}
                  onMouseEnter={(ev) => setHover({ it: e, min: e.min, x: ev.clientX, y: ev.clientY })}
                  onMouseMove={(ev) => setHover({ it: e, min: e.min, x: ev.clientX, y: ev.clientY })}
                  onMouseLeave={() => setHover(null)}
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125"
                  style={{ left: `${pct(e.min)}%`, background: teamColor(e.team), opacity: 0.62 }}
                />
              ))}
            </div>
            <span className="text-muted w-16 shrink-0 text-right text-[11px]">
              {d.evs.length}r · {d.repos} ctx
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0" />
        <div className="text-muted flex flex-1 justify-between text-[10px]">
          <span>{fmtTime(lo)}</span>
          <span>{fmtTime(hi)}</span>
        </div>
        <span className="w-16 shrink-0" />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {[...teamsList, null].map((t) => (
          <span key={t ?? "ind"} className="text-muted inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: teamColor(t) }} /> {teamLabel(t)}
          </span>
        ))}
      </div>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border p-2.5 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14, background: "var(--card-bg)", borderColor: "var(--color-line)" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: teamColor(hover.it.team) }} />
            <span className="text-fg text-xs font-semibold">
              {shortRepo(hover.it.repo)} #{hover.it.number}
            </span>
          </div>
          <div className="text-fg text-xs leading-snug">{hover.it.title}</div>
          <div className="text-muted mt-1 text-[11px]">
            {fmtTime(hover.min)} · {teamLabel(hover.it.team)}
          </div>
        </div>
      )}
    </div>
  );
}

// Calendar heatmap of review load: one cell per weekday, columns = weeks, color
// intensity = review pickups that day. A months-long "how heavy have I been"
// view — the long-horizon companion to the day punchcard.
const CAL_STEPS = ["rgba(148,163,184,0.14)", "#a8d5ef", "#5cb3e0", "#1f8fce", "#0072B2"];
function calColor(count: number): string {
  if (count <= 0) return CAL_STEPS[0];
  if (count <= 1) return CAL_STEPS[1];
  if (count <= 2) return CAL_STEPS[2];
  if (count <= 4) return CAL_STEPS[3];
  return CAL_STEPS[4];
}
export function ReviewCalendar({ items }: { items: RhythmItem[] }) {
  const [hover, setHover] = useState<{ label: string; count: number; contexts: number; x: number; y: number } | null>(null);
  const [months, setMonths] = useState(3);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const byDay = new Map<string, { count: number; repos: Set<string> }>();
  for (const it of items) {
    const key = ymd(new Date(it.at));
    const e = byDay.get(key) ?? byDay.set(key, { count: 0, repos: new Set() }).get(key)!;
    e.count++;
    e.repos.add(it.repo);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthList = Array.from({ length: months }, (_, i) => {
    const d = new Date(base);
    d.setMonth(base.getMonth() - (months - 1 - i));
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const CELL = 16;
  const GAP = 3;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WD = ["M", "T", "W", "T", "F"];
  const fmtDay = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const ranges: [string, number][] = [["3m", 3], ["6m", 6], ["1y", 12]];
  // Weekday cells of one month, placed on a (week-row × Mon–Fri-col) grid.
  const monthCells = (year: number, month: number) => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { row: number; col: number; d: Date; count: number; contexts: number; future: boolean }[] = [];
    let rows = 1;
    for (let dm = 1; dm <= daysInMonth; dm++) {
      const d = new Date(year, month, dm);
      const wd = (d.getDay() + 6) % 7;
      if (wd > 4) continue; // weekdays only
      const row = Math.floor((dm - 1 + firstDow) / 7);
      rows = Math.max(rows, row + 1);
      const e = byDay.get(ymd(d));
      cells.push({ row, col: wd, d, count: e?.count ?? 0, contexts: e ? e.repos.size : 0, future: d.getTime() > today.getTime() });
    }
    return { rows, cells };
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="border-line inline-flex overflow-hidden rounded-md border text-xs">
          {ranges.map(([label, m]) => (
            <button
              key={label}
              type="button"
              onClick={() => setMonths(m)}
              className={`px-2 py-0.5 ${months === m ? "text-fg" : "text-muted"}`}
              style={months === m ? { background: "color-mix(in srgb, var(--color-fg) 10%, transparent)" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-4">
        {monthList.map(({ year, month }) => {
          const { rows, cells } = monthCells(year, month);
          return (
            <div key={`${year}-${month}`} className="flex flex-col gap-1">
              <span className="text-fg text-[11px] font-medium">
                {MONTHS[month]}
                {year !== today.getFullYear() ? ` '${String(year).slice(2)}` : ""}
              </span>
              <div className="grid" style={{ gridTemplateColumns: `repeat(5, ${CELL}px)`, gap: GAP }}>
                {WD.map((l, i) => (
                  <span key={i} className="text-muted text-center text-[8px] leading-none">
                    {l}
                  </span>
                ))}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(5, ${CELL}px)`, gridTemplateRows: `repeat(${rows}, ${CELL}px)`, gap: GAP }}>
                {cells.map((c, i) =>
                  c.future ? (
                    <span key={i} style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }} />
                  ) : (
                    <span
                      key={i}
                      onMouseEnter={(ev) => setHover({ label: fmtDay(c.d), count: c.count, contexts: c.contexts, x: ev.clientX, y: ev.clientY })}
                      onMouseMove={(ev) => setHover({ label: fmtDay(c.d), count: c.count, contexts: c.contexts, x: ev.clientX, y: ev.clientY })}
                      onMouseLeave={() => setHover(null)}
                      className="rounded-[3px]"
                      style={{ gridColumn: c.col + 1, gridRow: c.row + 1, background: calColor(c.count) }}
                    />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-muted flex items-center gap-1 text-[11px]">
        <span>less</span>
        {CAL_STEPS.map((c, i) => (
          <span key={i} className="inline-block rounded-[2px]" style={{ width: 11, height: 11, background: c }} />
        ))}
        <span>more</span>
      </div>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border p-2.5 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14, background: "var(--card-bg)", borderColor: "var(--color-line)" }}
        >
          <div className="text-fg text-xs font-semibold">{hover.label}</div>
          <div className="text-muted mt-0.5 text-[11px]">
            {hover.count === 0 ? "No reviews" : `${hover.count} review${hover.count === 1 ? "" : "s"} · ${hover.contexts} context${hover.contexts === 1 ? "" : "s"}`}
          </div>
        </div>
      )}
    </div>
  );
}

// Balance / sustainability strip: one column per weekday over the load window.
// Bar diverges from a center line — up + orange = you fell behind that day
// (took on more than you cleared), down + teal = you caught up. Columns behind
// an "overload" day (concurrent load at/above the heavy line) get a shaded band,
// so a sustained overload stretch reads as a continuous highlighted run.
type BalanceDay = { key: string; inflow: number; throughput: number; level: number };
export function BalanceStrip({ days, heavyLine }: { days: BalanceDay[]; heavyLine: number }) {
  const [hover, setHover] = useState<{ d: BalanceDay; net: number; x: number; y: number } | null>(null);
  const maxNet = Math.max(1, ...days.map((d) => Math.abs(d.inflow - d.throughput)));
  const fmt = (k: string) => localDate(k).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  // Every day gets a background tint scaled to its load, so calm and busy days
  // are distinguishable — faint slate when light, ramping to orange once the
  // concurrent load reaches the heavy line (overload).
  const tint = (level: number): string => {
    const ratio = heavyLine > 0 ? level / heavyLine : 0;
    if (ratio >= 1) return `rgba(230,159,0,${(0.2 + Math.min(1, ratio - 1) * 0.25).toFixed(3)})`;
    return `rgba(148,163,184,${(0.05 + Math.max(0, ratio) * 0.16).toFixed(3)})`;
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-24 items-stretch gap-[2px]">
        {days.map((d) => {
          const net = d.inflow - d.throughput;
          const mag = Math.abs(net) / maxNet;
          return (
            <div
              key={d.key}
              onMouseEnter={(e) => setHover({ d, net, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHover({ d, net, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              className="relative min-w-0 flex-1 rounded-sm"
              style={{ background: tint(d.level) }}
            >
              <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "rgba(148,163,184,0.35)" }} />
              {net !== 0 && (
                <div
                  className="absolute left-1/2 w-[6px] -translate-x-1/2 rounded-sm"
                  style={{
                    height: `${Math.max(3, mag * 46)}%`,
                    [net > 0 ? "bottom" : "top"]: "50%",
                    background: net > 0 ? "#D55E00" : "#0072B2",
                    opacity: 0.9,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted">{days.length ? fmt(days[0].key) : ""}</span>
        <span className="text-muted flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "#D55E00" }} /> fell behind
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "#0072B2" }} /> caught up
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(230,159,0,0.4)" }} /> heavier load
          </span>
        </span>
        <span className="text-muted">{days.length ? fmt(days[days.length - 1].key) : ""}</span>
      </div>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border p-2.5 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14, background: "var(--card-bg)", borderColor: "var(--color-line)" }}
        >
          <div className="text-fg text-xs font-semibold">{fmt(hover.d.key)}</div>
          <div className="text-muted mt-0.5 text-[11px]">
            +{hover.d.inflow} in · {hover.d.throughput} reviewed ·{" "}
            <span style={{ color: hover.net > 0 ? "#D55E00" : hover.net < 0 ? "#0072B2" : undefined }}>
              {hover.net > 0 ? `+${hover.net} behind` : hover.net < 0 ? `${hover.net} ahead` : "even"}
            </span>
          </div>
          <div className="text-muted mt-0.5 text-[11px]">
            {hover.d.level} on your plate{hover.d.level >= heavyLine ? " · heavy" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

export function Donut({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="label"
          cx="34%"
          innerRadius={40}
          outerRadius={68}
          paddingAngle={2}
          stroke="none"
          labelLine={false}
          label={renderSliceValue as unknown as (props: unknown) => React.ReactNode}
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} itemStyle={{ color: "var(--color-fg)" }} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="circle"
          iconSize={9}
          wrapperStyle={{ fontSize: 11, lineHeight: "17px", maxWidth: "50%" }}
          formatter={legendLabel}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// One dot per repo: how many of its PRs you reviewed (x) vs how many comments
// you leave on average (y). Bottom-right = high volume, low engagement
// ("wave-through" repos); top-left = low volume, deep engagement.
export function RepoScatter({ data }: { data: { label: string; count: number; avg: number }[] }) {
  const rows = data.map((d) => ({ x: d.count, y: d.avg, label: d.label }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ScatterChart margin={{ top: 8, right: 24, bottom: 20, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="x"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          domain={[0, "dataMax + 1"]}
        >
          <Label value="reviews" position="bottom" offset={4} fill={AXIS} fontSize={11} />
        </XAxis>
        <YAxis
          type="number"
          dataKey="y"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          domain={[0, "dataMax + 0.5"]}
        >
          <Label value="avg comments" angle={-90} position="insideLeft" offset={12} fill={AXIS} fontSize={11} style={{ textAnchor: "middle" }} />
        </YAxis>
        <Tooltip
          cursor={{ stroke: GRID }}
          contentStyle={TOOLTIP}
          itemStyle={{ color: "var(--color-fg)" }}
          labelStyle={{ color: "var(--color-fg)", fontWeight: 600 }}
          separator=""
          labelFormatter={(_v, p) => (p?.[0]?.payload as { label?: string })?.label ?? ""}
          formatter={(v, n) => [n === "y" ? `${Number(v).toFixed(1)} avg comments` : `${v} reviews`, ""]}
        />
        <Scatter data={rows} fill="#0072B2">
          <LabelList dataKey="label" position="right" fill={AXIS} fontSize={10} offset={6} />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const VERDICT_Y = ["rejected", "waiting", "suggestions", "approved"] as const;
const verdictLabel = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

// Bubble grid of your vote journey: x = which vote turn on the PR (1st, 2nd…),
// y = what verdict you cast, bubble size = how many PRs. Aggregating ties into
// bubble area keeps overlapping votes as signal instead of a hidden stack.
export function VoteTurnBubbles({ data }: { data: { turn: number; verdict: string; count: number }[] }) {
  const rows = data
    .filter((d) => VERDICT_Y.includes(d.verdict as (typeof VERDICT_Y)[number]))
    .map((d) => ({ x: d.turn, y: VERDICT_Y.indexOf(d.verdict as (typeof VERDICT_Y)[number]), count: d.count, verdict: d.verdict }));
  const maxTurn = Math.max(1, ...data.map((d) => d.turn));
  const ticks = Array.from({ length: maxTurn }, (_, i) => i + 1);
  const tip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: { x: number; verdict: string; count: number } }[] }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    if (!d) return null;
    return (
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12, color: "var(--color-fg)", padding: "6px 9px" }}>
        <div style={{ fontWeight: 600 }}>{verdictLabel(d.verdict)}</div>
        <div style={{ color: AXIS }}>{`vote #${d.x} · ${d.count} ${d.count === 1 ? "PR" : "PRs"}`}</div>
      </div>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ScatterChart margin={{ top: 8, right: 20, bottom: 20, left: 8 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="x"
          domain={[0.5, maxTurn + 0.5]}
          ticks={ticks}
          allowDecimals={false}
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        >
          <Label value="vote # on the PR" position="bottom" offset={4} fill={AXIS} fontSize={11} />
        </XAxis>
        <YAxis
          type="number"
          dataKey="y"
          domain={[-0.5, 3.5]}
          ticks={[0, 1, 2, 3]}
          width={92}
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => verdictLabel(VERDICT_Y[Number(v)] ?? "")}
        />
        <ZAxis type="number" dataKey="count" range={[70, 520]} />
        <Tooltip cursor={{ stroke: GRID }} content={tip} />
        <Scatter data={rows}>
          {rows.map((d, i) => (
            <Cell key={i} fill={VERDICT_COLOR[d.verdict] ?? "#0072B2"} fillOpacity={0.75} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// One dot per review: when you reviewed (x) vs how long it took (y).
export function LatencyScatter({ points }: { points: LatPoint[] }) {
  const data = points.map((p) => ({ ts: Date.parse(p.at), hours: p.hours, label: `${p.repo} #${p.number}`, color: latColor(p.verdict) }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -6 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="ts"
          domain={["dataMin", "dataMax"]}
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => new Date(Number(v)).toLocaleDateString([], { month: "numeric", day: "numeric" })}
        />
        <YAxis
          type="number"
          dataKey="hours"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={42}
          tickFormatter={(v) => fmtHours(Number(v))}
        />
        <Tooltip
          cursor={{ stroke: GRID }}
          contentStyle={TOOLTIP}
          itemStyle={{ color: "var(--color-fg)" }}
          formatter={(v, n) => (n === "hours" ? [fmtHours(Number(v)), "turnaround"] : [new Date(Number(v)).toLocaleDateString(), "reviewed"])}
        />
        <Scatter data={data}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// Treemap of review breadth: one tile per author, sized by PRs of theirs you
// reviewed. Each tile carries a soft label chip (first name; full name in the
// tooltip). The "Other" tile's tooltip breaks down who it rolls up.
interface AuthorMember {
  label: string;
  count: number;
}
interface TreemapDatum {
  name: string;
  size: number;
  members?: AuthorMember[];
  otherCount?: number;
  moreCount?: number;
  [key: string]: unknown;
}
interface TreemapCellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
}
function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "", value = 0 }: TreemapCellProps) {
  const color = PIE_COLORS[index % PIE_COLORS.length];
  const label = `${name.split(" ")[0]} · ${value}`;
  const chipW = label.length * 6.2 + 12;
  const fits = width > chipW + 8 && height > 24;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} fill={color} stroke="var(--card-bg)" strokeWidth={2} />
      {fits && (
        <>
          <rect x={x + 5} y={y + 5} width={chipW} height={17} rx={4} fill="rgba(15,23,42,0.72)" stroke="none" />
          <text x={x + 10} y={y + 16.5} fontSize={11} style={{ fill: "#fff", fontWeight: 400 }}>
            {label}
          </text>
        </>
      )}
    </g>
  );
}

function ReachTooltip({ active, payload }: { active?: boolean; payload?: { payload: TreemapDatum }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.members) {
    return (
      <div style={{ ...TOOLTIP, padding: "8px 10px" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Other — {p.otherCount} authors</div>
        {p.members.map((m) => (
          <div key={m.label}>
            {m.label} · {m.count}
          </div>
        ))}
        {p.moreCount ? <div style={{ opacity: 0.6, marginTop: 2 }}>+{p.moreCount} more</div> : null}
      </div>
    );
  }
  return (
    <div style={{ ...TOOLTIP, padding: "8px 10px" }}>
      {p.name} · {p.size} PR{p.size === 1 ? "" : "s"}
    </div>
  );
}

export function AuthorTreemap({ authors }: { authors: AuthorMember[] }) {
  const TOP = 12;
  const data: TreemapDatum[] = authors.slice(0, TOP).map((a) => ({ name: a.label, size: a.count }));
  const tail = authors.slice(TOP);
  if (tail.length) {
    data.push({
      name: "Other",
      size: tail.reduce((s, a) => s + a.count, 0),
      members: tail.slice(0, 6),
      otherCount: tail.length,
      moreCount: Math.max(0, tail.length - 6),
    });
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <Treemap
        data={data}
        dataKey="size"
        nameKey="name"
        stroke="var(--card-bg)"
        isAnimationActive={false}
        content={(props) => <TreemapCell {...(props as unknown as TreemapCellProps)} />}
      >
        <Tooltip content={<ReachTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
