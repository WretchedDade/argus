import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowLeft, Ban, ExternalLink } from "lucide-react";
import { api, configQuery, prDetailQuery, type Pr, type PrEvent, type PrReviewState } from "../lib/api";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { ActionBar, VoteChips } from "../components/PrCard";
import { resolveTeamLabel, timeAgo } from "../lib/format";
import { teamBadgeStyle } from "../lib/teamColor";
import { REVIEW_STATE_META } from "../lib/triage";

export const Route = createFileRoute("/pr")({
  validateSearch: (s: Record<string, unknown>): { c: string } => ({ c: String(s.c ?? "") }),
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: ({ context, deps }) =>
    deps.c ? context.queryClient.ensureQueryData(prDetailQuery(deps.c)) : null,
  component: PrDetailPage,
});

function voteLabel(v: number): string {
  if (v >= 10) return "approved";
  if (v >= 5) return "approved with suggestions";
  if (v <= -10) return "rejected";
  if (v <= -5) return "waiting on author";
  return "vote reset";
}

function eventLabel(e: PrEvent): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "added":
      return "Added to the queue";
    case "refreshed":
      return "Metadata refreshed";
    case "lane_changed":
      return `Moved to ${p.lane === "quick" ? "Quick" : "Full review"}`;
    case "state_changed":
      return `State changed to ${String(p.state ?? "")}`;
    case "reviewed":
      return "Reviewed";
    case "vote_changed": {
      const who = p.name ? String(p.name) : "A reviewer";
      return `${who} ${voteLabel(Number(p.vote ?? 0))}`;
    }
    case "review_state": {
      const to = p.to ? (REVIEW_STATE_META[p.to as PrReviewState]?.label ?? String(p.to)) : "no standing";
      return `Your review state \u2192 ${to}`;
    }
    case "commit_pushed":
      return `New commit ${String(p.sha ?? "").slice(0, 8)}`;
    case "draft_changed":
      return p.isDraft ? "Marked as draft" : "Draft published";
    case "comment_posted":
      return "Comment posted";
    case "snoozed":
      if (p.cleared) return "Snooze cleared";
      if (p.mode === "fte") return "Snoozed until an FTE approves";
      return `Snoozed until ${p.until ? new Date(String(p.until)).toLocaleString() : "later"}`;
    case "fte_woke":
      return p.by ? `${String(p.by)} approved — snooze cleared` : "An FTE approved — snooze cleared";
    case "dismissed":
      return "Dismissed";
    case "out_of_scope":
      return "Marked out of scope";
    case "in_scope":
      return "Restored to review";
    case "removed":
      return "Removed";
    case "closed":
      return `Closed (${String(p.reason ?? "")})`;
    default:
      return e.type;
  }
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-line text-muted shrink-0 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
      {children}
    </span>
  );
}

function StatePill({ pr }: { pr: Pr }) {
  if (!pr.reviewState) return null;
  const meta = REVIEW_STATE_META[pr.reviewState];
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, var(${meta.anchor}) 16%, transparent)`,
        color: `color-mix(in srgb, var(${meta.anchor}) 62%, var(--color-fg))`,
      }}
    >
      {meta.label}
    </span>
  );
}

// A small tinted status pill used across the detail header (lane, snooze, scope).
function Chip({ anchor, children }: { anchor: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, var(${anchor}) 15%, transparent)`,
        color: `color-mix(in srgb, var(${anchor}) 64%, var(--color-fg))`,
      }}
    >
      {children}
    </span>
  );
}

function snoozeLabel(pr: Pr): string {
  if (pr.snoozeMode === "fte") return "Snoozed until an FTE approves";
  if (pr.snoozedUntil)
    return `Snoozed until ${new Date(pr.snoozedUntil).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  return "";
}

function PrDetailPage() {
  const { c } = Route.useSearch();
  const q = useQuery(prDetailQuery(c));
  const labels = useQuery(configQuery).data?.teamLabels ?? {};
  const qc = useQueryClient();
  const router = useRouter();

  const goBack = () => {
    // Prefer a real history back so scroll position on the board is restored;
    // fall back to a fresh navigation when opened directly (no history).
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/" });
  };

  // Fetch the full description once on open: the bulk poll truncates it, but
  // `az pr show` (via refreshPr) returns the full text and stores it.
  useEffect(() => {
    if (!c) return;
    api
      .refreshPr(c)
      .then(() => qc.invalidateQueries({ queryKey: ["pr", c] }))
      .catch(() => {});
  }, [c, qc]);

  const pr = q.data?.pr;
  // Show individual reviewer votes (now recorded with a name); hide the legacy
  // nameless/container vote rows and internal refresh events.
  const HIDDEN = new Set(["refreshed"]);
  const events = [...(q.data?.events ?? [])]
    .filter((e) => !HIDDEN.has(e.type) && !(e.type === "vote_changed" && !e.payload?.name))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <button
        type="button"
        onClick={goBack}
        className="text-muted hover:text-fg inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft size={14} /> Board
      </button>

      {!pr ? (
        <p className="text-muted text-sm">{q.isLoading ? "Loading…" : "PR not found."}</p>
      ) : (
        <>
          <div className="pr-card border-line flex flex-col gap-4 rounded-xl border p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-muted flex min-w-0 items-center gap-1.5 text-sm">
                <span className="text-fg font-semibold">{pr.repo}</span>
                <span>#{pr.number}</span>
                {pr.isDraft && <Badge>draft</Badge>}
                {pr.isVendor && <Badge>vendor</Badge>}
              </div>
              <a
                href={pr.canonical}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                style={{ background: "var(--peacock-teal)" }}
              >
                <ExternalLink size={14} /> Open in Azure DevOps
              </a>
            </div>

            <h1 className="text-fg text-lg font-semibold leading-snug">{pr.title}</h1>

            <div className="flex flex-wrap items-center gap-2">
              <StatePill pr={pr} />
              <Chip anchor="--color-sky-500">
                <span className="capitalize">{pr.lane}</span> lane
              </Chip>
              {(pr.snoozeMode === "fte" || pr.snoozedUntil) && (
                <Chip anchor="--color-amber-500">
                  <AlarmClock size={11} /> {snoozeLabel(pr)}
                </Chip>
              )}
              {pr.outOfScope && (
                <Chip anchor="--color-slate-400">
                  <Ban size={11} /> Out of scope
                </Chip>
              )}
              {pr.teams.map((t) => (
                <span key={t} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={teamBadgeStyle(t)}>
                  {resolveTeamLabel(t, labels)}
                </span>
              ))}
            </div>

            <div className="text-muted flex flex-wrap items-center gap-x-1.5 text-xs">
              {pr.author && (
                <>
                  <span>by {pr.author}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>updated {timeAgo(pr.updatedAt)}</span>
            </div>

            {pr.otherVotes.length > 0 && (
              <div className="border-line border-t pt-3">
                <div className="text-muted mb-1 text-xs font-semibold uppercase tracking-wide">Reviewer votes</div>
                <VoteChips votes={pr.otherVotes} />
              </div>
            )}

            <ActionBar pr={pr} />

            {pr.description && (
              <div className="border-line border-t pt-3">
                <MarkdownPreview text={pr.description} clamp={false} />
              </div>
            )}
          </div>

          <section>
            <h2 className="text-muted mb-2 text-xs font-semibold uppercase tracking-wide">History</h2>
            {events.length === 0 ? (
              <p className="text-muted text-sm">No recorded events yet.</p>
            ) : (
              <ol className="border-line relative ml-2 flex flex-col gap-3 border-l pl-4">
                {events.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
                      style={{ background: "var(--peacock-teal)" }}
                    />
                    <div className="text-fg text-sm">{eventLabel(e)}</div>
                    <div className="text-muted text-xs" title={new Date(e.ts).toLocaleString()}>
                      {timeAgo(e.ts)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
