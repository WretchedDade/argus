import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { configQuery, insightsQuery } from "../lib/api";
import { shortRepo } from "../lib/format";
import { pushToast } from "../lib/toast";

export const Route = createFileRoute("/recap")({
  loader: ({ context }) => context.queryClient.ensureQueryData(insightsQuery),
  component: RecapPage,
});

type RhythmItem = { at: string; repo: string; team: string | null; number: number; title: string; verdict: string | null };
type BalanceDay = { key: string; inflow: number; throughput: number; level: number };

const VERDICT_LABEL: Record<string, string> = {
  approved: "Approved",
  suggestions: "Approved with suggestions",
  waiting: "Waiting on author",
  rejected: "Rejected",
};
const VERDICT_ORDER = ["approved", "suggestions", "waiting", "rejected"];
const SITTING_GAP_MIN = 45;

// Monday-anchored week window. offset 0 = this week, -1 = last week.
function weekRange(offset: number): { start: number; end: number; label: string } {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon = 0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
  const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const fri = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
  const fmt = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  return { start: monday.getTime(), end: end.getTime(), label: `${fmt(monday)} – ${fmt(fri)}` };
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeRecap(items: RhythmItem[], days: BalanceDay[], heavyLine: number, win: { start: number; end: number }) {
  const inWin = items.filter((it) => {
    const t = Date.parse(it.at);
    return t >= win.start && t < win.end;
  });
  const verdicts: Record<string, number> = {};
  const repoCount = new Map<string, number>();
  const teams = new Set<string>();
  const byDay = new Map<string, number[]>(); // dayKey -> minutes-of-day list
  for (const it of inWin) {
    if (it.verdict) verdicts[it.verdict] = (verdicts[it.verdict] ?? 0) + 1;
    repoCount.set(it.repo, (repoCount.get(it.repo) ?? 0) + 1);
    if (it.team) teams.add(it.team);
    const d = new Date(it.at);
    const k = dayKey(d.getTime());
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(d.getHours() * 60 + d.getMinutes());
  }
  let sittings = 0;
  let busiest: { key: string; n: number } | null = null;
  for (const [k, mins] of byDay) {
    const sorted = mins.slice().sort((a, b) => a - b);
    let s = sorted.length ? 1 : 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > SITTING_GAP_MIN) s++;
    sittings += s;
    if (!busiest || sorted.length > busiest.n) busiest = { key: k, n: sorted.length };
  }
  const winDays = days.filter((d) => {
    const t = Date.parse(d.key);
    return t >= win.start && t < win.end;
  });
  const activeDays = winDays.filter((d) => d.inflow > 0 || d.throughput > 0 || d.level > 0);
  const behind = activeDays.filter((d) => d.inflow > d.throughput).length;
  const overload = winDays.filter((d) => d.level >= heavyLine).length;
  const topRepos = [...repoCount.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return {
    total: inWin.length,
    verdicts,
    repos: repoCount.size,
    contexts: repoCount.size,
    teams: teams.size,
    sittings,
    busiest,
    behind,
    activeDays: activeDays.length,
    overload,
    topRepos,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex flex-col rounded-xl border p-4 shadow-sm" style={{ background: "var(--card-bg)" }}>
      <span className="text-fg text-2xl font-semibold leading-tight">{value}</span>
      <span className="text-muted mt-0.5 text-xs">{label}</span>
    </div>
  );
}

function RecapPage() {
  const data = useQuery(insightsQuery).data;
  const labels = useQuery(configQuery).data?.teamLabels ?? {};
  const [offset, setOffset] = useState(0);

  if (!data) return <p className="text-muted p-4 text-sm">Loading…</p>;
  const win = weekRange(offset);
  const r = computeRecap(data.reviewRhythm.items, data.balance.days, data.balance.heavyLine, win);

  const dayName = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long" });
  };

  const markdown = (() => {
    const lines: string[] = [];
    lines.push(`## Review recap — ${win.label}`);
    lines.push("");
    lines.push(`**${r.total} review${r.total === 1 ? "" : "s"}** across ${r.repos} repo${r.repos === 1 ? "" : "s"}, ${r.contexts} context${r.contexts === 1 ? "" : "s"}.`);
    const vlines = VERDICT_ORDER.filter((v) => r.verdicts[v]).map((v) => `- ${VERDICT_LABEL[v]}: ${r.verdicts[v]}`);
    if (vlines.length) {
      lines.push("");
      lines.push(...vlines);
    }
    lines.push("");
    const busiest = r.busiest ? `; busiest ${dayName(r.busiest.key)} (${r.busiest.n})` : "";
    lines.push(`**Rhythm:** ${r.sittings} sitting${r.sittings === 1 ? "" : "s"}${busiest}.`);
    lines.push(`**Balance:** ${r.behind} of ${r.activeDays} active day${r.activeDays === 1 ? "" : "s"} fell behind; ${r.overload} overload day${r.overload === 1 ? "" : "s"}.`);
    if (r.topRepos.length) {
      lines.push("");
      lines.push(`**Top repos:** ${r.topRepos.slice(0, 5).map((t) => `${shortRepo(t.label)} (${t.count})`).join(", ")}`);
    }
    return lines.join("\n");
  })();

  const copy = () => {
    navigator.clipboard
      .writeText(markdown)
      .then(() => pushToast("Recap copied to clipboard"))
      .catch(() => pushToast("Couldn't copy", "error"));
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-fg text-lg font-semibold">Weekly recap</h1>
          <p className="text-muted text-xs">{win.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="border-line inline-flex overflow-hidden rounded-md border text-xs">
            {[
              { v: 0, label: "This week" },
              { v: -1, label: "Last week" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setOffset(o.v)}
                className={`px-2.5 py-1 ${offset === o.v ? "text-fg" : "text-muted"}`}
                style={offset === o.v ? { background: "color-mix(in srgb, var(--color-fg) 10%, transparent)" } : undefined}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: "var(--peacock-teal)" }}
          >
            <Copy size={14} /> Copy markdown
          </button>
        </div>
      </div>

      {r.total === 0 ? (
        <p className="text-muted py-10 text-center text-sm">No reviews recorded this week.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="reviews" value={String(r.total)} />
            <Stat label="repos touched" value={String(r.repos)} />
            <Stat label="sittings" value={String(r.sittings)} />
            <Stat label="fell behind" value={`${r.behind}/${r.activeDays}d`} />
          </div>

          <div className="border-line rounded-xl border p-5 shadow-sm" style={{ background: "var(--card-bg)" }}>
            <h2 className="text-fg mb-3 text-sm font-semibold">Verdict mix</h2>
            <div className="flex flex-col gap-1.5">
              {VERDICT_ORDER.filter((v) => r.verdicts[v]).map((v) => (
                <div key={v} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{VERDICT_LABEL[v]}</span>
                  <span className="text-fg font-semibold">{r.verdicts[v]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-line rounded-xl border p-5 shadow-sm" style={{ background: "var(--card-bg)" }}>
            <h2 className="text-fg mb-3 text-sm font-semibold">Where the time went</h2>
            <div className="flex flex-col gap-1.5">
              {r.topRepos.slice(0, 6).map((t) => (
                <div key={t.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{shortRepo(t.label)}</span>
                  <span className="text-fg font-semibold">{t.count}</span>
                </div>
              ))}
            </div>
            {r.teams > 0 && (
              <p className="text-muted mt-3 text-[11px]">
                Across {r.teams} team{r.teams === 1 ? "" : "s"}
                {Object.keys(labels).length > 0 ? ` (${Object.values(labels).slice(0, 3).join(", ")})` : ""}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
