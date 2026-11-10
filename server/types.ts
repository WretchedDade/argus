// Domain types shared across the server. The DB stores snake_case columns and
// 0/1 booleans; these are the camelCase, real-boolean shapes the app works with.

import type {
    AuthorMeta,
    Lane,
    Pr,
    PrReviewState,
    PrRole,
    PrState,
} from "#shared/schemas/pr";
import type {
    ActivityEntry,
    ActivityEvent,
    ActivityEventType,
    ActivityFeed,
    ActivityVerdict,
} from "#shared/schemas/activity";
import type {
    Insights,
    InsightsAuthoredPr,
    InsightsCount,
    InsightsLoadBucket,
    InsightsWaiting,
    LoadDayPr,
    LoadDetail,
    WeeklyReviewEffort,
    WeeklyReviewFacts,
    WeeklyReviewPr,
} from "#shared/schemas/insights";

export type { AuthorMeta, Lane, Pr, PrReviewState, PrRole, PrState };

type MetaFetch<T> =
    | { ok: true; value: T; lastSuccessfulAt: string }
    | { ok: false; error: string };

export interface AuthorMetaUpdate {
    mergeStatus: string;
    policies: MetaFetch<Pick<AuthorMeta, "completable" | "blockers">>;
    comments: MetaFetch<
        Pick<AuthorMeta, "activeComments" | "resolvedComments">
    >;
}
export type {
    ActivityEntry,
    ActivityEvent,
    ActivityEventType,
    ActivityFeed,
    ActivityVerdict,
};
export type {
    Insights,
    InsightsAuthoredPr,
    InsightsCount,
    InsightsLoadBucket,
    InsightsWaiting,
    LoadDayPr,
    LoadDetail,
    WeeklyReviewEffort,
    WeeklyReviewFacts,
    WeeklyReviewPr,
};

// Why Argus hid a PR on its own. Any other `dismissed_reason` is a manual choice.
export type ArchiveReason = "stale" | "out_of_scope";
export const ARCHIVE_REASONS: readonly ArchiveReason[] = [
    "stale",
    "out_of_scope",
];
export type RepoScope = "in" | "out";

// Days without a tracked change before a PR is archived as stale.
export const STALE_ARCHIVE_DAYS = 30;

export type PrEventType =
    | "added"
    | "refreshed"
    | "lane_changed"
    | "state_changed"
    | "reviewed"
    | "review_provisional"
    | "vote_changed"
    | "review_state"
    | "commit_pushed"
    | "draft_changed"
    | "comment_posted"
    | "snoozed"
    | "fte_woke"
    | "dismissed"
    | "archived"
    | "revived"
    | "out_of_scope"
    | "in_scope"
    | "removed"
    | "closed";

// A closed/merged PR whose linked review session can be archived.
export interface ArchivableSession {
    repo: string;
    number: number;
    status: string;
    sessionId: string;
}

// Fields Argus learns from ADO on discovery/refresh. User-managed fields (lane,
// dismissed, snooze, session) are never part of an upsert, so a refresh can't
// clobber a triage decision.
export interface PrUpsert {
    canonical: string;
    org: string;
    project: string;
    repo: string;
    number: number;
    title: string;
    description: string;
    author: string | null;
    isVendor: boolean;
    role: PrRole;
    teams: string[];
    isDraft: boolean;
    lastCommitSha: string | null;
    lastCommitAt: string | null;
    prCreatedAt: string | null;
    sourceBranch: string | null;
    targetBranch: string | null;
}

export interface PrEvent {
    id: number;
    canonical: string;
    ts: string;
    type: PrEventType;
    payload: Record<string, unknown> | null;
}

// A PR event joined with its PR's identity, for the run-detail changes view.
export interface RunEvent extends PrEvent {
    repo: string;
    number: number;
    title: string;
}
