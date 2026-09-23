import type { Pr, PrReviewState } from "../lib/api";
import { resolveTeamLabel, shortAge } from "../lib/format";
import { teamBadgeStyle } from "../lib/teamColor";
import { REVIEW_STATE_META } from "../lib/triage";

function LanePill({ lane }: { lane: Pr["lane"] }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs capitalize ${
        lane === "quick" ? "lane-quick" : "lane-review"
      }`}
    >
      {lane}
    </span>
  );
}

function ReviewStatePill({ state }: { state: PrReviewState }) {
  const meta = REVIEW_STATE_META[state];
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `color-mix(in srgb, var(${meta.anchor}) 14%, transparent)`,
        borderColor: `color-mix(in srgb, var(${meta.anchor}) 40%, var(--color-line))`,
        color: `color-mix(in srgb, var(${meta.anchor}) 60%, var(--color-fg))`,
      }}
    >
      {meta.label}
    </span>
  );
}

function TeamChips({ teams, labels }: { teams: string[]; labels: Record<string, string> }) {
  if (teams.length === 0) return null;
  return (
    <>
      {teams.map((t) => (
        <span
          key={t}
          className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
          style={teamBadgeStyle(t)}
        >
          {resolveTeamLabel(t, labels)}
        </span>
      ))}
    </>
  );
}

export function PrRow({
  pr,
  labels,
  dim = false,
  showState = false,
  showAge = false,
}: {
  pr: Pr;
  labels: Record<string, string>;
  dim?: boolean;
  showState?: boolean;
  showAge?: boolean;
}) {
  return (
    <a
      href={pr.canonical}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--peacock-teal)_9%,transparent)] ${
        dim ? "opacity-60 hover:opacity-100" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {pr.isDraft && <span className="text-muted mr-1.5 text-xs">draft</span>}
          {pr.title}
        </div>
        <div className="text-muted mt-0.5 text-xs">
          {pr.repo} #{pr.number}
          {pr.author ? ` · ${pr.author}` : ""}
          {showAge ? ` · ${shortAge(pr.updatedAt)} idle` : ""}
        </div>
      </div>
      {showState && pr.reviewState && <ReviewStatePill state={pr.reviewState} />}
      <TeamChips teams={pr.teams} labels={labels} />
      <LanePill lane={pr.lane} />
    </a>
  );
}
