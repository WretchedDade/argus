import { useState } from "react";
import { AlarmClock, AlertTriangle, Ban, ChevronDown, ChevronRight, Hourglass, ListChecks, Zap } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, configQuery, healthQuery, prsQuery, type Lane, type Pr } from "../lib/api";
import { PrCard } from "./PrCard";
import { pushToast } from "../lib/toast";
import { byRecent, isStale, needsAction } from "../lib/triage";

const LANE_LABEL: Record<Lane, string> = { review: "Full review", quick: "Quick" };

function LaneSection({
  id,
  lane,
  items,
  labels,
}: {
  id: string;
  lane: Lane;
  items: Pr[];
  labels: Record<string, string>;
}) {
  const sorted = [...items].sort(byRecent);

  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-fg text-sm font-semibold">{LANE_LABEL[lane]}</h2>
        <span className="text-muted text-xs">{items.length}</span>
      </div>
      <div className="flex flex-col gap-3">
        {sorted.map((pr) =>
          needsAction(pr) || pr.isDraft ? (
            <PrCard key={pr.canonical} pr={pr} labels={labels} />
          ) : (
            <PrCard key={pr.canonical} pr={pr} labels={labels} variant="compact" />
          ),
        )}
      </div>
    </section>
  );
}

function CollapsedSection({
  id,
  label,
  hint,
  items,
  labels,
  onRestore,
  collapsible = true,
}: {
  id: string;
  label: string;
  hint?: string;
  items: Pr[];
  labels: Record<string, string>;
  onRestore?: (canonical: string) => void | Promise<void>;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = collapsible ? open : true;
  return (
    <section id={id} className="scroll-mt-20 flex flex-col gap-2">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted hover:text-fg flex w-full items-center gap-2 py-1 text-left transition-colors"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
          <span className="text-xs opacity-70">{items.length}</span>
          {hint && <span className="text-xs opacity-60">· {hint}</span>}
        </button>
      ) : (
        <div className="flex items-baseline gap-2">
          <h2 className="text-fg text-sm font-semibold">{label}</h2>
          <span className="text-muted text-xs">{items.length}</span>
          {hint && <span className="text-muted text-xs opacity-70">· {hint}</span>}
        </div>
      )}
      {shown && (
        <div className={collapsible ? "mt-1.5 flex flex-col gap-1" : "flex flex-col gap-3"}>
          {items.sort(byRecent).map((pr) => (
            <PrCard
              key={pr.canonical}
              pr={pr}
              labels={labels}
              variant="compact"
              onRestore={onRestore ? () => onRestore(pr.canonical) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface RailEntry {
  id: string;
  label: string;
  Icon: typeof Zap;
}

function SectionRail({ entries }: { entries: RailEntry[] }) {
  if (entries.length < 2) return null;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <nav className="fixed left-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1.5">
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-label={e.label}
          onClick={() => jump(e.id)}
          className="group pr-card border-line text-muted hover:text-fg relative rounded-full border p-2 shadow-sm transition-colors"
        >
          <e.Icon size={16} />
          <span
            role="tooltip"
            className="pr-card border-line text-fg pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-xs opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100"
          >
            {e.label}
          </span>
        </button>
      ))}
    </nav>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="pr-card border-line h-[150px] animate-pulse rounded-xl border opacity-60" />
      ))}
    </div>
  );
}

function PollBanner({ authOk, error }: { authOk: boolean; error: string | null }) {
  const msg = !authOk
    ? "Not signed in to Azure CLI. Run `az login`, then Refresh."
    : `Last poll failed: ${error}`;
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      style={{
        borderColor: "color-mix(in srgb, #d64545 45%, var(--color-line))",
        background: "color-mix(in srgb, #d64545 10%, transparent)",
        color: "color-mix(in srgb, #d64545 60%, var(--color-fg))",
      }}
    >
      <AlertTriangle size={15} className="shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export function TriageQueue() {
  const prs = useQuery(prsQuery);
  const cfg = useQuery(configQuery);
  const health = useQuery(healthQuery);
  const qc = useQueryClient();
  const labels = cfg.data?.teamLabels ?? {};
  const recencyDays = cfg.data?.recencyDays ?? 7;
  const poller = health.data?.poller;

  const restore = async (canonical: string) => {
    try {
      await api.setScope(canonical, false);
      pushToast("Back to review");
      void qc.invalidateQueries({ queryKey: ["prs"] });
    } catch {
      pushToast("Couldn't update scope", "error");
    }
  };

  const unsnooze = async (canonical: string) => {
    try {
      await api.setSnooze(canonical, null);
      pushToast("Unsnoozed");
      void qc.invalidateQueries({ queryKey: ["prs"] });
    } catch {
      pushToast("Couldn't unsnooze", "error");
    }
  };

  // First load, before the poller has returned anything.
  if (prs.isLoading && !prs.data) return <BoardSkeleton />;

  const banner = poller && (!poller.authOk || poller.lastError) ? (
    <PollBanner authOk={poller.authOk} error={poller.lastError} />
  ) : null;

  const review = (prs.data ?? []).filter((p: Pr) => p.role !== "author");
  if (review.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {banner}
        <p className="text-muted text-sm">Nothing to review right now.</p>
      </div>
    );
  }

  const now = Date.now();
  const isSnoozed = (p: Pr) => p.snoozeMode === "fte" || (!!p.snoozedUntil && Date.parse(p.snoozedUntil) > now);

  const inScope = review.filter((p) => !p.outOfScope);
  const outOfScope = review.filter((p) => p.outOfScope);
  const snoozed = inScope.filter(isSnoozed);
  const awake = inScope.filter((p) => !isSnoozed(p));
  const active = awake.filter((p) => !isStale(p, recencyDays));
  const stale = awake.filter((p) => isStale(p, recencyDays));
  const needs = active.filter((p) => needsAction(p) && !p.isDraft).length;
  const lanes: Lane[] = ["review", "quick"];
  const laneIcon: Record<Lane, typeof Zap> = { review: ListChecks, quick: Zap };

  const rail: RailEntry[] = [];
  for (const l of lanes) {
    if (active.some((p) => p.lane === l)) rail.push({ id: `sec-${l}`, label: LANE_LABEL[l], Icon: laneIcon[l] });
  }
  if (snoozed.length > 0) rail.push({ id: "sec-snoozed", label: "Snoozed", Icon: AlarmClock });
  if (stale.length > 0) rail.push({ id: "sec-stale", label: "Stale", Icon: Hourglass });
  if (outOfScope.length > 0) rail.push({ id: "sec-scope", label: "Out of scope", Icon: Ban });

  return (
    <div className="flex flex-col gap-6">
      <SectionRail entries={rail} />
      {banner}

      <div className="text-muted text-sm">
        {needs > 0 ? (
          <>
            <span className="text-fg font-semibold">{needs}</span> need{needs === 1 ? "s" : ""} you
          </>
        ) : (
          "nothing needs you"
        )}
        <span className="mx-1.5">·</span>
        {active.length} open
      </div>

      {lanes.map((l) => {
        const items = active.filter((p) => p.lane === l);
        return items.length ? (
          <LaneSection key={l} id={`sec-${l}`} lane={l} items={items} labels={labels} />
        ) : null;
      })}

      {snoozed.length > 0 && (
        <CollapsedSection
          id="sec-snoozed"
          label="Snoozed"
          hint="hidden until later"
          items={snoozed}
          labels={labels}
          onRestore={unsnooze}
          collapsible={false}
        />
      )}

      {stale.length > 0 && (
        <CollapsedSection id="sec-stale" label="Stale" hint="outside the recency window" items={stale} labels={labels} />
      )}

      {outOfScope.length > 0 && (
        <CollapsedSection
          id="sec-scope"
          label="Out of scope"
          hint="you don't need to review these"
          items={outOfScope}
          labels={labels}
          onRestore={restore}
        />
      )}
    </div>
  );
}
