import type { Pr, PrReviewState } from "./api";

export const shouldShowAutomaticReview = (pr: Pick<Pr, "lane">): boolean => pr.lane === "quick";

const DAY_MS = 86_400_000;

// A PR is stale once its last activity is older than the recency window: the
// poller stops refreshing it, so its state is frozen and it should sink.
export function isStale(pr: Pr, recencyDays: number, now = Date.now()): boolean {
  return now - Date.parse(pr.updatedAt) > recencyDays * DAY_MS;
}

export function isSnoozed(
  pr: Pick<Pr, "snoozeMode" | "snoozedUntil">,
  now = Date.now(),
): boolean {
  return pr.snoozeMode === "fte" || (!!pr.snoozedUntil && Date.parse(pr.snoozedUntil) > now);
}

// Needs your action: awaiting your first vote (or an unknown state).
export function needsAction(pr: Pr): boolean {
  return pr.reviewState === "needs" || pr.reviewState === null;
}

// Most recent activity first.
export function byRecent(a: Pr, b: Pr): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

// Count of review PRs that need your attention right now (the Board's headline),
// applying the same exclusions the queue does (out-of-scope, snoozed, stale, draft).
export function needsYouCount(prs: Pr[], recencyDays: number, now = Date.now()): number {
  return prs.filter(
    (p) =>
      p.role !== "author" &&
      !p.outOfScope &&
      !isSnoozed(p, now) &&
      !isStale(p, recencyDays, now) &&
      needsAction(p) &&
      !p.isDraft,
  ).length;
}

export interface ReviewStateMeta {
  label: string;
  anchor: string; // css var for color-mix
}

export const REVIEW_STATE_META: Record<PrReviewState, ReviewStateMeta> = {
  needs: { label: "Needs Review", anchor: "--color-teal-500" },
  covered: { label: "Covered", anchor: "--color-sky-500" },
  suggestions: { label: "Suggestions", anchor: "--color-emerald-500" },
  waiting: { label: "Waiting on Author", anchor: "--color-orange-500" },
  approved: { label: "Approved", anchor: "--color-green-500" },
  rejected: { label: "Rejected", anchor: "--color-rose-500" },
};
