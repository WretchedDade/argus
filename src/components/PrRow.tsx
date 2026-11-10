import type { Pr, PrReviewState } from "../lib/api";
import { resolveTeamLabel, shortAge } from "../lib/format";
import { teamAnchor } from "../lib/teamColor";
import { REVIEW_STATE_META } from "../lib/triage";

function LanePill({ lane }: { lane: Pr["lane"] }) {
    return (
        <Badge
            component="span"
            className="shrink-0"
            variant="light"
            color={lane === "quick" ? "orange" : undefined}
            size="sm"
        >
            {lane === "quick" ? "Review for me" : "Review with me"}
        </Badge>
    );
}

function ReviewStatePill({ state }: { state: PrReviewState }) {
    const meta = REVIEW_STATE_META[state];
    return (
        <Badge
            component="span"
            className="shrink-0"
            variant="light"
            color={`var(${meta.anchor})`}
            size="sm"
        >
            {meta.label}
        </Badge>
    );
}

function TeamChips({
    teams,
    labels,
}: {
    teams: string[];
    labels: Record<string, string>;
}) {
    if (teams.length === 0) return null;
    return (
        <>
            {teams.map((t) => (
                <Badge
                    component="span"
                    key={t}
                    className="shrink-0"
                    variant="light"
                    color={teamAnchor(t)}
                    radius="sm"
                    size="xs"
                >
                    {resolveTeamLabel(t, labels)}
                </Badge>
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
            className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--mantine-primary-color-filled)_9%,transparent)] ${
                dim ? "text-muted" : ""
            }`}
        >
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                    {pr.isDraft && (
                        <span className="text-muted mr-1.5 text-xs">draft</span>
                    )}
                    {pr.title}
                </div>
                <div className="text-muted mt-0.5 text-xs">
                    {pr.repo} #{pr.number}
                    {pr.author ? ` · ${pr.author}` : ""}
                    {showAge ? ` · ${shortAge(pr.updatedAt)} idle` : ""}
                </div>
            </div>
            {showState && pr.reviewState && (
                <ReviewStatePill state={pr.reviewState} />
            )}
            <TeamChips teams={pr.teams} labels={labels} />
            {pr.reviewCount > 0 && <LanePill lane={pr.lane} />}
        </a>
    );
}
import { Badge } from "@mantine/core";
