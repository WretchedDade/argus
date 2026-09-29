import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { AlarmClock, AlarmClockOff, Ban, Building2, Check, ChevronDown, Clock, ExternalLink, GitPullRequest, ListChecks, Loader2, MessageSquareText, RefreshCw, RotateCcw, X, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Pr } from "../lib/api";
import { resolveTeamLabel, shortAge, timeUntil } from "../lib/format";
import { teamBadgeStyle } from "../lib/teamColor";
import { REVIEW_STATE_META } from "../lib/triage";
import { pushToast } from "../lib/toast";
import { usePending } from "../lib/usePending";
import { MarkdownPreview } from "./MarkdownPreview";

// The accent hue for a row: its review state, or teal ("your move") when unset.
function accentVar(pr: Pr): string {
  return pr.reviewState ? REVIEW_STATE_META[pr.reviewState].anchor : "--color-teal-500";
}

function StatePill({ pr, small = false }: { pr: Pr; small?: boolean }) {
  if (!pr.reviewState) return null;
  const meta = REVIEW_STATE_META[pr.reviewState];
  return (
    <span
      className={`shrink-0 rounded-full font-medium ${small ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
      style={{
        background: `color-mix(in srgb, var(${meta.anchor}) 16%, transparent)`,
        color: `color-mix(in srgb, var(${meta.anchor}) 62%, var(--color-fg))`,
      }}
    >
      {meta.label}
    </span>
  );
}

// PR size from files changed, as a t-shirt bucket + count. Color goes green→red
// with size, so a big review is obvious at a glance.
const SIZE_BUCKETS: { max: number; label: string; anchor: string }[] = [
  { max: 2, label: "XS", anchor: "--color-green-500" },
  { max: 6, label: "S", anchor: "--color-teal-500" },
  { max: 15, label: "M", anchor: "--color-amber-500" },
  { max: 40, label: "L", anchor: "--color-orange-500" },
  { max: Infinity, label: "XL", anchor: "--color-rose-500" },
];

function SizeChip({ files }: { files: number | null }) {
  if (files == null) return null;
  const b = SIZE_BUCKETS.find((x) => files <= x.max)!;
  return (
    <span
      className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-medium"
      style={{
        borderColor: `color-mix(in srgb, var(${b.anchor}) 40%, var(--color-line))`,
        color: `color-mix(in srgb, var(${b.anchor}) 60%, var(--color-fg))`,
      }}
      title={`${files} file${files === 1 ? "" : "s"} changed`}
    >
      {b.label} · {files}f
    </span>
  );
}

function TeamDots({ teams, labels }: { teams: string[]; labels: Record<string, string> }) {
  return (
    <>
      {teams.map((t) => (
        <span
          key={t}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={teamBadgeStyle(t)}
        >
          {resolveTeamLabel(t, labels)}
        </span>
      ))}
    </>
  );
}

// Visual-only actions swallow the click so they don't trigger the card's
// stretched navigation link. (Wiring for most is still deferred.)
const swallow = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

// A small hover tooltip. Uses a named group so it only reacts to its own button,
// not the card's `group` (which would fire every tooltip at once).
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pr-card border-line text-fg pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-xs opacity-0 shadow-md transition-opacity duration-100 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  spinning = false,
}: {
  icon: typeof Ban;
  label: string;
  onClick?: () => void;
  spinning?: boolean;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={spinning}
        onClick={(e) => {
          swallow(e);
          onClick?.();
        }}
        className="text-muted hover:text-fg rounded-md p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]"
      >
        <Icon size={14} className={spinning ? "animate-spin" : undefined} />
      </button>
    </Tip>
  );
}

function LaneButton({ pr }: { pr: Pr }) {
  const qc = useQueryClient();
  const { pending, run } = usePending();
  const dest = pr.lane === "review" ? "quick" : "review";
  const move = () =>
    run(async () => {
      try {
        await api.setLane(pr.canonical, dest);
        pushToast(`Moved to ${dest === "quick" ? "Quick" : "Full review"}`);
        void qc.invalidateQueries({ queryKey: ["prs"] });
        void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
      } catch {
        pushToast("Couldn't move lane", "error");
      }
    });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        swallow(e);
        move();
      }}
      className="border-line text-muted hover:text-fg inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-60"
    >
      {pending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : dest === "quick" ? (
        <Zap size={12} />
      ) : (
        <ListChecks size={12} />
      )}
      Move to {dest === "quick" ? "Quick" : "Full"}
    </button>
  );
}

function snoozeUntil(kind: "1h" | "4h" | "tomorrow" | "week"): string {
  const d = new Date();
  if (kind === "1h") d.setHours(d.getHours() + 1);
  else if (kind === "4h") d.setHours(d.getHours() + 4);
  else if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else d.setDate(d.getDate() + 7);
  return d.toISOString();
}

const SNOOZE_OPTIONS: [Parameters<typeof snoozeUntil>[0], string][] = [
  ["1h", "In 1 hour"],
  ["4h", "In 4 hours"],
  ["tomorrow", "Until tomorrow"],
  ["week", "Next week"],
];

function SnoozeMenu({ pr }: { pr: Pr }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wake = usePending();

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - r.top + 6, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  const snooze = async (kind: Parameters<typeof snoozeUntil>[0]) => {
    setOpen(false);
    try {
      await api.setSnooze(pr.canonical, snoozeUntil(kind), "time");
      pushToast("Snoozed");
      void qc.invalidateQueries({ queryKey: ["prs"] });
      void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
    } catch {
      pushToast("Couldn't snooze", "error");
    }
  };

  const snoozeFte = async () => {
    setOpen(false);
    try {
      await api.setSnooze(pr.canonical, null, "fte");
      pushToast("Snoozed until an FTE approves");
      void qc.invalidateQueries({ queryKey: ["prs"] });
      void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
    } catch {
      pushToast("Couldn't snooze", "error");
    }
  };

  const clearSnooze = () =>
    wake.run(async () => {
      try {
        await api.setSnooze(pr.canonical, null, null);
        pushToast("Snooze cleared");
        void qc.invalidateQueries({ queryKey: ["prs"] });
        void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
      } catch {
        pushToast("Couldn't clear snooze", "error");
      }
    });

  const itemCls = "text-fg block w-full px-3 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]";

  // Already snoozed: the snooze action is meaningless, so offer a wake instead.
  if (pr.snoozeMode === "fte" || pr.snoozedUntil) {
    return (
      <Tip label="Wake now">
        <button
          type="button"
          aria-label="Wake now"
          disabled={wake.pending}
          onClick={(e) => {
            swallow(e);
            clearSnooze();
          }}
          className="text-muted hover:text-fg inline-flex items-center rounded-md p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)] disabled:opacity-60"
        >
          {wake.pending ? <Loader2 size={14} className="animate-spin" /> : <AlarmClockOff size={14} />}
        </button>
      </Tip>
    );
  }

  return (
    <>
      <Tip label="Snooze">
        <button
          ref={btnRef}
          type="button"
          aria-label="Snooze"
          onClick={(e) => {
            swallow(e);
            toggle();
          }}
          className="text-muted hover:text-fg inline-flex items-center rounded-md p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]"
        >
          <AlarmClock size={14} />
          <ChevronDown size={11} className="-ml-0.5" />
        </button>
      </Tip>
      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              className="border-line fixed z-50 w-44 overflow-hidden rounded-md border py-1 text-xs shadow-md"
              style={{ bottom: pos.bottom, right: pos.right, background: "var(--card-bg)" }}
            >
              {SNOOZE_OPTIONS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={(e) => {
                    swallow(e);
                    void snooze(k);
                  }}
                  className={itemCls}
                >
                  {label}
                </button>
              ))}
              <div className="border-line my-1 border-t" />
              <button
                type="button"
                onClick={(e) => {
                  swallow(e);
                  void snoozeFte();
                }}
                className={itemCls}
              >
                Until an FTE approves
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

export function ActionBar({ pr }: { pr: Pr }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const scope = usePending();
  const reviewReq = usePending();

  const markOutOfScope = () =>
    scope.run(async () => {
      try {
        await api.setScope(pr.canonical, true);
        pushToast("Marked out of scope");
        void qc.invalidateQueries({ queryKey: ["prs"] });
        void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
      } catch {
        pushToast("Couldn't update scope", "error");
      }
    });

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await api.refreshPr(pr.canonical);
      pushToast("Refreshed");
      void qc.invalidateQueries({ queryKey: ["prs"] });
    } catch {
      pushToast("Refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const review = () =>
    reviewReq.run(async () => {
      try {
        const { reReview } = await api.review(pr.canonical);
        pushToast(reReview ? "Re-review requested" : "Review requested");
      } catch {
        pushToast("Couldn't start review", "error");
      }
    });

  return (
    <div className="relative z-20 flex items-center gap-1.5 border-t border-line pt-2.5">
      <button
        type="button"
        disabled={reviewReq.pending}
        onClick={(e) => {
          swallow(e);
          review();
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-70"
        style={{ background: "var(--peacock-teal)" }}
      >
        {reviewReq.pending && <Loader2 size={12} className="animate-spin" />}
        {pr.reviewSessionId ? "Re-review" : "Review"}
      </button>

      <LaneButton pr={pr} />

      <div className="ml-auto flex items-center gap-0.5">
        <SnoozeMenu pr={pr} />
        <ActionBtn icon={RefreshCw} label="Refresh" onClick={refresh} spinning={refreshing} />
        <Tip label="Open in Azure DevOps">
          <a
            href={pr.canonical}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open in Azure DevOps"
            className="text-muted hover:text-fg inline-flex rounded-md p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]"
          >
            <ExternalLink size={14} />
          </a>
        </Tip>
        <ActionBtn icon={Ban} label="Out of scope" onClick={markOutOfScope} spinning={scope.pending} />
      </div>
    </div>
  );
}

// Other reviewers' votes, grouped by kind and shown as tinted chips (concerns
// first). Gives visibility into who's already weighed in even when it's still
// your turn — handy when an FTE-snooze wakes.
const VOTE_META: Record<number, { label: string; anchor: string; Icon: typeof Check }> = {
  10: { label: "Approved by", anchor: "--color-green-500", Icon: Check },
  5: { label: "Suggestions from", anchor: "--color-emerald-500", Icon: MessageSquareText },
  [-5]: { label: "Waiting on author:", anchor: "--color-orange-500", Icon: Clock },
  [-10]: { label: "Rejected by", anchor: "--color-rose-500", Icon: X },
};
const VOTE_ORDER = [-10, -5, 5, 10];

export function VoteChips({ votes }: { votes: { name: string; vote: number }[] }) {
  if (votes.length === 0) return null;
  const groups = VOTE_ORDER.map((v) => ({ v, names: votes.filter((x) => x.vote === v).map((x) => x.name) })).filter(
    (g) => g.names.length > 0,
  );
  if (groups.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {groups.map(({ v, names }) => {
        const m = VOTE_META[v];
        return (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
            style={{
              background: `color-mix(in srgb, var(${m.anchor}) 15%, transparent)`,
              color: `color-mix(in srgb, var(${m.anchor}) 70%, var(--color-fg))`,
            }}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: `var(${m.anchor})` }}
            >
              <m.Icon size={11} />
            </span>
            {m.label} {names.join(", ")}
          </span>
        );
      })}
    </div>
  );
}

// Roomy card for action buckets; compact one-liner for parked/reviewed buckets.
export function PrCard({
  pr,
  labels,
  variant = "full",
  onRestore,
}: {
  pr: Pr;
  labels: Record<string, string>;
  variant?: "full" | "compact";
  onRestore?: () => void | Promise<void>;
}) {
  const accent = accentVar(pr);
  const restore = usePending();

  if (variant === "compact") {
    return (
      <Link
        to="/pr"
        search={{ c: pr.canonical }}
        className="pr-card group relative flex items-center gap-2 overflow-hidden rounded-md border py-1.5 pl-3 pr-2 text-xs opacity-85 transition hover:opacity-100"
        style={{
          borderColor: `color-mix(in srgb, var(${accent}) 42%, var(--color-line))`,
          background: `color-mix(in srgb, var(${accent}) 13%, var(--card-bg))`,
        }}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `var(${accent})` }} />
        {pr.isDraft && (
          <span className="border-line text-muted shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide">
            draft
          </span>
        )}
        {pr.isVendor && (
          <span className="border-line text-muted shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide">
            vendor
          </span>
        )}
        <span className="text-fg min-w-0 flex-1 truncate">{pr.title}</span>
        <span className="text-muted shrink-0">
          {pr.repo} #{pr.number}
        </span>
        <SizeChip files={pr.changedFiles} />
        <StatePill pr={pr} small />
        {pr.snoozeMode === "fte" ? (
          <span className="text-muted inline-flex shrink-0 items-center gap-1">
            <AlarmClock size={11} /> until FTE
          </span>
        ) : pr.snoozedUntil ? (
          <span className="text-muted inline-flex shrink-0 items-center gap-1">
            <AlarmClock size={11} /> {timeUntil(pr.snoozedUntil)}
          </span>
        ) : (
          <span className="text-muted shrink-0 tabular-nums">{shortAge(pr.updatedAt)}</span>
        )}
        {onRestore && (
          <button
            type="button"
            aria-label="Back to review"
            disabled={restore.pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              restore.run(async () => {
                await onRestore();
              });
            }}
            className="text-muted hover:text-fg relative z-20 shrink-0 rounded p-0.5 disabled:opacity-60"
          >
            <RotateCcw size={13} className={restore.pending ? "animate-spin" : undefined} />
          </button>
        )}
      </Link>
    );
  }

  return (
    <div
      className={`pr-card border-line group relative flex min-h-[150px] flex-col justify-between gap-3 rounded-xl border pl-4 pr-3.5 pt-4 pb-4 shadow-sm transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md${pr.isDraft ? " opacity-65 hover:opacity-100" : ""}`}
    >
      <Link
        to="/pr"
        search={{ c: pr.canonical }}
        aria-label={pr.title}
        className="absolute inset-0 z-10"
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-muted flex min-w-0 items-center gap-1.5 text-xs">
            <GitPullRequest size={12} className="shrink-0" />
            <span className="text-fg truncate font-semibold">{pr.repo}</span>
            <span className="shrink-0">#{pr.number}</span>
            {pr.isDraft && (
              <span className="border-line text-muted ml-1 shrink-0 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
                draft
              </span>
            )}
            {pr.isVendor && (
              <span className="border-line text-muted ml-1 inline-flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
                <Building2 size={9} />
                vendor
              </span>
            )}
            <SizeChip files={pr.changedFiles} />
          </div>
        </div>

        <h3 className="text-fg line-clamp-2 text-[15px] font-semibold leading-tight">{pr.title}</h3>

        {pr.description && <MarkdownPreview text={pr.description} />}

        <VoteChips votes={pr.otherVotes} />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-muted flex items-center gap-2.5 text-[11px]">
          {pr.author && <span className="truncate">by {pr.author}</span>}
          <span className="inline-flex shrink-0 items-center gap-1">
            <Clock size={11} />
            {shortAge(pr.updatedAt)}
          </span>
          {pr.teams.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <TeamDots teams={pr.teams} labels={labels} />
            </div>
          )}
        </div>
        <ActionBar pr={pr} />
      </div>
    </div>
  );
}
