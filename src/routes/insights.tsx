import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, GitPullRequest, Inbox, Timer, X } from "lucide-react";
import { api, configQuery, insightsQuery, type InsightsCount, type LoadDayPr } from "../lib/api";
import { AuthorTreemap, BalanceStrip, CoverageWaffle, DepthMeter, Donut, HBars, LatencyScatter, LoadChart, RepoScatter, ReviewCalendar, ReviewRhythm, VoteBars, VoteTurnBubbles } from "../components/Charts";
import { fmtHours, shortRepo } from "../lib/format";
import { REVIEW_STATE_META } from "../lib/triage";
import type { PrReviewState } from "../lib/api";

export const Route = createFileRoute("/insights")({
  loader: ({ context }) => context.queryClient.ensureQueryData(insightsQuery),
  component: InsightsPage,
});

function Section({ title, desc, meta, children }: { title: string; desc?: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-line rounded-xl border p-5 shadow-sm" style={{ background: "var(--card-bg)" }}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-fg text-sm font-semibold">{title}</h2>
          {desc && <p className="text-muted mt-0.5 text-xs">{desc}</p>}
        </div>
        {meta && <div className="text-muted shrink-0 text-xs">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, anchor }: { icon: typeof Timer; label: string; value: string; anchor: string }) {
  return (
    <div className="border-line flex items-center gap-3 rounded-xl border p-4 shadow-sm" style={{ background: "var(--card-bg)" }}>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, var(${anchor}) 16%, transparent)`, color: `color-mix(in srgb, var(${anchor}) 70%, var(--color-fg))` }}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-fg text-lg font-semibold leading-tight">{value}</div>
        <div className="text-muted truncate text-xs">{label}</div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted py-6 text-center text-sm">{children}</p>;
}

// A single stat cell for the responsiveness readout.
function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`text-fg font-semibold leading-tight ${big ? "text-2xl" : "text-lg"}`}>{value}</span>
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}

// Small segmented control.
function SegToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
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

// Day / Week granularity switch for the load section.
function GranToggle({ value, onChange }: { value: "day" | "week"; onChange: (v: "day" | "week") => void }) {
  return (
    <SegToggle
      value={value}
      onChange={onChange}
      options={[
        { v: "week", label: "Week" },
        { v: "day", label: "Day" },
      ]}
    />
  );
}

// A colored key + term + plain-language description, used as the load chart's
// legend-and-explanation in one.
function LegendKey({ color, term, desc }: { color: string; term: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-[11px] leading-tight">
        <span className="text-fg font-medium">{term}</span>
        <span className="text-muted"> — {desc}</span>
      </span>
    </div>
  );
}

// One PR row inside the load drawer. Not clickable; PR title is the headline,
// repo #num + review-state pill sit on a secondary line, age on the right.
function LoadPrCard({ p }: { p: LoadDayPr }) {
  const meta = p.state ? REVIEW_STATE_META[p.state as PrReviewState] : null;
  return (
    <div
      className="border-line flex flex-col rounded-md border border-l-4 px-3 py-2"
      style={meta ? { borderLeftColor: `var(${meta.anchor})` } : { borderLeftColor: "var(--color-line)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-fg text-sm font-medium">{p.title}</span>
        <span className="text-muted shrink-0 text-[11px]" title="Days on your plate as of this day">
          {p.ageDays}d
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-muted text-xs">
          {shortRepo(p.repo)} #{p.number}
        </span>
        {meta && (
          <span
            className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: `color-mix(in srgb, var(${meta.anchor}) 14%, transparent)`,
              borderColor: `color-mix(in srgb, var(${meta.anchor}) 40%, var(--color-line))`,
              color: `color-mix(in srgb, var(${meta.anchor}) 60%, var(--color-fg))`,
            }}
          >
            {meta.label}
          </span>
        )}
      </div>
    </div>
  );
}

// Right slide-out panel showing which PRs fall into each of the three load
// buckets on a clicked day. Tabbed (arrived / reviewed / on plate) so one list
// gets the full panel width; sorted oldest-first. Fetched from /api/load/day.
function LoadDayDrawer({ dayKey, onClose }: { dayKey: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["loadDay", dayKey], queryFn: () => api.loadDay(dayKey) });
  const d = q.data;
  const [tab, setTab] = useState<"arrived" | "reviewed" | "onPlate">("onPlate");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [y, m, dd] = dayKey.split("-").map(Number);
  const label = new Date(y, m - 1, dd).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const tabs: { id: "arrived" | "reviewed" | "onPlate"; title: string; color: string; prs: LoadDayPr[] }[] = [
    { id: "arrived", title: "New PRs", color: "#0072B2", prs: d?.arrived ?? [] },
    { id: "reviewed", title: "Reviewed", color: "#009E73", prs: d?.reviewed ?? [] },
    { id: "onPlate", title: "On your plate", color: "#E69F00", prs: d?.onPlate ?? [] },
  ];
  const active = tabs.find((t) => t.id === tab)!;

  // On the "On your plate" tab, split the list the same way the chart counts it:
  // New PRs (arrived that day), Reviewed (reviewed that day but not new), and
  // Existing (carried over, neither new nor reviewed today). Mutually exclusive.
  const arrivedSet = new Set((d?.arrived ?? []).map((p) => p.canonical));
  const reviewedSet = new Set((d?.reviewed ?? []).map((p) => p.canonical));
  const onPlateGroups = [
    { key: "new", title: "New PRs", color: "#0072B2", prs: (d?.onPlate ?? []).filter((p) => arrivedSet.has(p.canonical)) },
    { key: "reviewed", title: "Reviewed", color: "#009E73", prs: (d?.onPlate ?? []).filter((p) => !arrivedSet.has(p.canonical) && reviewedSet.has(p.canonical)) },
    { key: "existing", title: "Existing", color: "#8E8E8E", prs: (d?.onPlate ?? []).filter((p) => !arrivedSet.has(p.canonical) && !reviewedSet.has(p.canonical)) },
  ].filter((g) => g.prs.length > 0);

  // Lock the underlying page scroll while the panel is open so we don't get two
  // side-by-side scrollbars (page + panel).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div
        className="border-line fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l shadow-2xl"
        style={{ background: "var(--card-bg)" }}
      >
        <div className="border-line flex items-center justify-between border-b px-5 py-3">
          <div className="flex flex-col">
            <span className="text-fg text-sm font-semibold">{label}</span>
            <span className="text-muted text-[11px]">Load breakdown</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-fg rounded-md p-1">
            <X size={16} />
          </button>
        </div>

        <div className="border-line flex border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium"
              style={{ color: tab === t.id ? "var(--color-fg)" : "var(--color-muted)" }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
              {t.title}
              <span className="text-muted">{t.prs.length}</span>
              {tab === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: t.color }} />}
            </button>
          ))}
        </div>

        <div className="pretty-scroll flex-1 overflow-y-auto px-3 pb-3">
          {!d ? (
            <div className="text-muted py-8 text-center text-sm">Loading…</div>
          ) : active.prs.length === 0 ? (
            <div className="text-muted py-8 text-center text-sm">None</div>
          ) : tab === "onPlate" ? (
            <div className="flex flex-col gap-4">
              {onPlateGroups.map((g) => {
                const isCollapsed = collapsed[g.key];
                return (
                  <div key={g.key} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                      className="sticky top-0 z-10 -mx-3 flex items-center gap-1.5 border-b px-3 py-2"
                      style={{ background: "var(--card-bg)", borderColor: "var(--color-line)" }}
                    >
                      <ChevronRight
                        size={13}
                        className="text-muted shrink-0 transition-transform"
                        style={{ transform: isCollapsed ? "none" : "rotate(90deg)" }}
                      />
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />
                      <span className="text-fg text-xs font-semibold">{g.title}</span>
                      <span className="text-muted text-[11px]">{g.prs.length}</span>
                    </button>
                    {!isCollapsed && g.prs.map((p) => <LoadPrCard key={p.canonical} p={p} />)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pt-3">
              {active.prs.map((p) => (
                <LoadPrCard key={p.canonical} p={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Collapse a long count list to the top `n` plus an aggregated "Other" slice,
// so pie charts stay legible when there are many categories (e.g. repos).
function topWithOther(counts: InsightsCount[], n: number): InsightsCount[] {
  if (counts.length <= n) return counts;
  const top = counts.slice(0, n);
  const other = counts.slice(n).reduce((sum, c) => sum + c.count, 0);
  return other > 0 ? [...top, { label: "Other", count: other }] : top;
}

type ReachItem = { at: string; author: string; vendor: boolean; teams: string[] };

// Streak stats over a balance-day window. "Falling behind" = inflow > throughput;
// "overload" = concurrent load at/above the heavy line. current = trailing run.
function balanceStreaks(days: { inflow: number; throughput: number; level: number }[], heavyLine: number) {
  const run = (flags: boolean[]) => {
    let longest = 0;
    let r = 0;
    for (const f of flags) {
      if (f) {
        r++;
        if (r > longest) longest = r;
      } else r = 0;
    }
    let current = 0;
    for (let i = flags.length - 1; i >= 0 && flags[i]; i--) current++;
    return { longest, current };
  };
  return {
    fallingBehind: run(days.map((d) => d.inflow > d.throughput)),
    overload: run(days.map((d) => d.level >= heavyLine)),
  };
}

// Aggregate reach footprint records for a rolling window (days), or all-time when
// days is null. Runs on the client so the recency selector switches instantly.
function computeReach(items: ReachItem[], days: number | null) {
  const cutoff = days ? Date.now() - days * 86_400_000 : 0;
  const authorMap = new Map<string, number>();
  const teamSet = new Set<string>();
  let vendor = 0;
  let prs = 0;
  for (const i of items) {
    if (days && Date.parse(i.at) < cutoff) continue;
    prs++;
    authorMap.set(i.author, (authorMap.get(i.author) ?? 0) + 1);
    if (i.vendor) vendor++;
    for (const t of i.teams) teamSet.add(t);
  }
  const byAuthor = [...authorMap.entries()].map(([label, count]) => ({ label, count })).sort((a, c) => c.count - a.count);
  return { prs, authors: authorMap.size, teams: teamSet.size, vendorShare: prs ? vendor / prs : 0, byAuthor };
}

function InsightsPage() {
  const data = useQuery(insightsQuery).data;
  const cfg = useQuery(configQuery).data;
  const labels = cfg?.teamLabels ?? {};
  if (!data) return <p className="text-muted text-sm">Loading…</p>;

  const { latency, throughput, backlog, distribution, load, reach, votePattern, reviewDepth, votePath, reviewCoverage, reviewRhythm, balance } = data;
  const activeTotal = distribution.byAuthorType.reduce((sum, c) => sum + c.count, 0);
  const [gran, setGran] = useState<"day" | "week">("week");
  const [latView, setLatView] = useState<"scatter" | "distribution">("scatter");
  const [reachWin, setReachWin] = useState<"7" | "30" | "90" | "all">("30");
  const [rhythmView, setRhythmView] = useState<"day" | "calendar">("day");
  const [loadDay, setLoadDay] = useState<string | null>(null);
  const [balanceWin, setBalanceWin] = useState<4 | 8 | 12>(8);
  const reachDays = reachWin === "all" ? null : Number(reachWin);
  const r = computeReach(reach.items, reachDays);
  const loadData = gran === "day" ? load.daily : load.weekly;
  const hasLoad = load.weekly.some((b) => b.inflow > 0 || b.throughput > 0 || b.backlog > 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={Timer} label="Median review latency" value={fmtHours(latency.medianHours)} anchor="--color-teal-500" />
        <Kpi icon={CheckCircle2} label="Reviews (8 wks)" value={String(throughput.total)} anchor="--color-green-500" />
        <Kpi icon={Inbox} label="Waiting on you" value={String(backlog.waitingCount)} anchor="--color-amber-500" />
        <Kpi icon={GitPullRequest} label="Active reviews" value={String(activeTotal)} anchor="--color-sky-500" />
      </div>

      <Section
        title="Load & capacity"
        meta={
          <div className="flex items-center gap-3">
            {load.peak.count > 0 && (
              <span className="text-muted">
                peak {load.peak.count} on your plate
                {load.peak.at ? ` · ${new Date(load.peak.at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
              </span>
            )}
            <GranToggle value={gran} onChange={setGran} />
          </div>
        }
      >
        {!hasLoad ? (
          <Empty>No review activity captured yet.</Empty>
        ) : (
          <div>
            <LoadChart data={loadData} granularity={gran} periods={cfg?.periods ?? []} onSelectDay={setLoadDay} />
            <div className="border-line mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3">
              <LegendKey color="#0072B2" term="New PRs" desc="landed on your plate" />
              <LegendKey color="#009E73" term="Reviewed" desc="reviews you finished" />
              <LegendKey
                color="#E69F00"
                term="On your plate"
                desc={gran === "week" ? "peak # of PRs live that week" : "# of PRs live that day"}
              />
            </div>
            {gran === "day" && (
              <p className="text-muted/70 mt-2 text-[11px]">Click a day to see which PRs are in each bucket.</p>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Review responsiveness"
        meta={
          latency.count > 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-muted">
                {latency.count} measured{latency.pending ? ` · ${latency.pending} pending` : ""}
              </span>
              <SegToggle
                value={latView}
                onChange={setLatView}
                options={[
                  { v: "scatter", label: "Scatter" },
                  { v: "distribution", label: "Spread" },
                ]}
              />
            </div>
          ) : undefined
        }
      >
        {latency.count === 0 ? (
          <Empty>
            {latency.pending > 0
              ? `Resolving ${latency.pending} recorded review${latency.pending === 1 ? "" : "s"}… check back after the next sync.`
              : "No recorded reviews yet. This fills in as you record verdicts."}
          </Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Median" value={fmtHours(latency.medianHours)} big />
              <Stat label="p90" value={fmtHours(latency.p90Hours)} big />
              <Stat label="Fastest" value={fmtHours(latency.fastestHours)} big />
              <Stat label="Slowest" value={fmtHours(latency.slowestHours)} big />
            </div>
            <div className="border-line border-t pt-3">
              {latView === "scatter" ? (
                <>
                  <LatencyScatter points={latency.points} />
                  <div className="text-muted mt-2 flex flex-wrap gap-3 text-[11px]">
                    {([["Approved", "#009E73"], ["Suggestions", "#E69F00"], ["Waiting", "#D55E00"], ["Rejected", "#CC79A7"]] as const).map(([label, color]) => (
                      <span key={label} className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <HBars data={latency.distribution} color="#0072B2" />
              )}
            </div>
          </div>
        )}
        <p className="text-muted mt-3 text-[11px] leading-relaxed">
          Time from when the reviewed commit was authored to when you recorded your verdict — how long finished code
          waited on you.
        </p>
      </Section>

      <Section
        title="Review reach"
        meta={
          <SegToggle
            value={reachWin}
            onChange={setReachWin}
            options={[
              { v: "7", label: "1w" },
              { v: "30", label: "1m" },
              { v: "90", label: "3m" },
              { v: "all", label: "All" },
            ]}
          />
        }
      >
        {r.prs === 0 ? (
          <Empty>No review activity in this window.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="PRs" value={String(r.prs)} big />
              <Stat label="Authors" value={String(r.authors)} big />
              <Stat label="Teams" value={String(r.teams)} big />
              <Stat label="Vendor share" value={`${Math.round(r.vendorShare * 100)}%`} big />
            </div>
            <div className="border-line border-t pt-3">
              <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">By author</div>
              <AuthorTreemap authors={r.byAuthor} />
            </div>
          </div>
        )}
        <p className="text-muted mt-3 text-[11px] leading-relaxed">
          PRs you're a reviewer on (not only ones you voted on), by author — so it grows as cross-team and vendor folks
          land code in your repos.
        </p>
      </Section>

      <Section title="How you vote" meta={votePattern.total > 0 ? `${votePattern.total} verdicts` : undefined}>
        {votePattern.total === 0 ? (
          <Empty>No recorded verdicts yet.</Empty>
        ) : (
          <VoteBars data={votePattern.byType} />
        )}
        <p className="text-muted mt-3 text-[11px] leading-relaxed">
          Your final verdict mix by author type (each bar is 100%). A bigger suggestions/waiting/rejected share means you
          push back more — useful for showing you hold vendor code to a higher bar.
        </p>
      </Section>

      {votePath.measured > 0 && (
        <Section
          title="How your reviews resolve"
          desc="Do you approve first-pass or gate for changes, and across which vote turns."
          meta={`${votePath.measured} reviews`}
        >
          <div className="flex flex-col gap-4">
            <DepthMeter
              segments={[
                { label: "First-pass approve", count: votePath.outcomes.firstPass, color: "#009E73" },
                { label: "Gated → approved", count: votePath.outcomes.gated, color: "#E69F00" },
                { label: "Held", count: votePath.outcomes.held, color: "#D55E00" },
              ]}
            />
            {votePath.turns.length > 0 && (
              <div className="border-line border-t pt-3">
                <div className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">Vote by turn</div>
                <VoteTurnBubbles data={votePath.turns} />
              </div>
            )}
          </div>
          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            The meter is your gatekeeper rate: how often you push for changes before approving vs approve on the first
            look. The bubbles show the shape of your process — a big Waiting bubble on vote #1 and Approved on #2 means
            you gate first, clear second.
          </p>
        </Section>
      )}

      {reviewDepth.measured > 0 && (
        <Section
          title="Review thoroughness"
          desc="How much you engage when you review."
          meta={`${reviewDepth.measured} reviews · ${reviewDepth.totalComments} comments`}
        >
          <DepthMeter
            segments={[
              { label: "Silent", count: reviewDepth.histogram[0]?.count ?? 0, color: "#cbd5e1" },
              { label: "Light", count: reviewDepth.histogram[1]?.count ?? 0, color: "#7dd3fc" },
              { label: "Moderate", count: reviewDepth.histogram[2]?.count ?? 0, color: "#0ea5e9" },
              { label: "Deep", count: reviewDepth.histogram[3]?.count ?? 0, color: "#0369a1" },
            ]}
          />
          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            Share of your reviews by comment count: Silent (0), Light (1–2), Moderate (3–5), Deep (6+). A large Silent
            slice means most verdicts land without a written note.
          </p>
        </Section>
      )}

      {reviewDepth.byRepo.length > 0 && (
        <Section
          title="Where your review attention lands"
          desc="Review volume vs comment depth, one dot per repo."
        >
          <RepoScatter
            data={reviewDepth.byRepo.map((r) => ({ label: shortRepo(r.label), count: r.count, avg: r.avg }))}
          />
          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            Bottom-right repos are high-volume but low-comment — the ones you tend to wave through. Top-left are where a
            few reviews pull a lot of engagement out of you.
          </p>
        </Section>
      )}

      <Section title="Review load & coverage — by team">
        <CoverageWaffle data={reviewCoverage.origins} labels={labels} />
        <p className="text-muted mt-2 text-[11px] leading-relaxed">
          One square per PR you're on. A row that's mostly "covered by me" or "still needs" means you're carrying that
          team's reviews rather than leaning on it. Hover a square for the PR.
        </p>
      </Section>

      {reviewRhythm.items.length > 0 && (
        <Section
          title="Review rhythm & context-switching"
          meta={
            <SegToggle
              value={rhythmView}
              onChange={setRhythmView}
              options={[
                { v: "day", label: "Day" },
                { v: "calendar", label: "Calendar" },
              ]}
            />
          }
        >
          {rhythmView === "day" ? (
            <ReviewRhythm
              items={reviewRhythm.items}
              labels={labels}
              workStartHour={cfg?.workStartHour ?? 9}
              workEndHour={cfg?.workEndHour ?? 17}
            />
          ) : (
            <ReviewCalendar items={reviewRhythm.items} />
          )}
          <p className="text-muted mt-3 text-[11px] leading-relaxed">
            {rhythmView === "day"
              ? "Each dot is a review — stopping your own work to load someone else's PR. Scattered dots are separate interruptions; clustered dots are batched. Overlaps darken, so a dense sitting reads as a deeper blob. Color = team."
              : "Each cell is a weekday, colored by how many reviews you did — a months-long view of your load. Darker stretches are sustained-heavy periods."}
          </p>
        </Section>
      )}

      {balance.days.length > 0 && (() => {
        const windowDays = balance.days.slice(-balanceWin * 5);
        const streaks = balanceStreaks(windowDays, balance.heavyLine);
        return (
          <Section
            title="Balance & sustainability"
            meta={
              <SegToggle
                value={String(balanceWin) as "4" | "8" | "12"}
                onChange={(v) => setBalanceWin(Number(v) as 4 | 8 | 12)}
                options={[
                  { v: "4", label: "4w" },
                  { v: "8", label: "8w" },
                  { v: "12", label: "12w" },
                ]}
              />
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="longest falling-behind streak" value={`${streaks.fallingBehind.longest}d`} big />
              <Stat label="falling behind now" value={streaks.fallingBehind.current > 0 ? `${streaks.fallingBehind.current}d` : "no"} big />
              <Stat label="longest overload streak" value={`${streaks.overload.longest}d`} big />
              <Stat label={`overloaded now (${balance.heavyLine}+ PRs)`} value={streaks.overload.current > 0 ? `${streaks.overload.current}d` : "no"} big />
            </div>
            <BalanceStrip days={windowDays} heavyLine={balance.heavyLine} />
            <p className="text-muted mt-3 text-[11px] leading-relaxed">
              Each bar is a weekday: orange up = you took on more reviews than you cleared (falling behind), teal down =
              you cleared more than arrived (catching up). Shaded columns are overload days — concurrent load at or above
              your heavy line ({balance.heavyLine}+ PRs on your plate). Long orange runs or wide shaded stretches are the
              unsustainable periods worth flagging before they compound.
            </p>
          </Section>
        );
      })()}

      {activeTotal === 0 ? (
        <Section title="Review load">
          <Empty>No active review PRs right now.</Empty>
        </Section>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Section title="Review load — by repo">
            <Donut data={topWithOther(distribution.byRepo.map((c) => ({ label: shortRepo(c.label), count: c.count })), 5)} />
          </Section>
          <Section title="Review load — by author">
            <Donut data={distribution.byAuthorType} />
          </Section>
          {reviewDepth.byType.length > 0 && (
            <Section title="Comment effort — by author" meta={`${reviewDepth.totalComments} comments`}>
              <Donut data={reviewDepth.byType.map((t) => ({ label: t.label, count: t.total }))} />
            </Section>
          )}
        </div>
      )}

      {loadDay && <LoadDayDrawer dayKey={loadDay} onClose={() => setLoadDay(null)} />}
    </div>
  );
}
