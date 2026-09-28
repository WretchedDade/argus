// Domain types shared across the server. The DB stores snake_case columns and
// 0/1 booleans; these are the camelCase, real-boolean shapes the app works with.

export type Lane = "quick" | "review";
export type PrState = "pending" | "reviewed" | "closed";

// How this PR is mine: I authored it, I'm a direct reviewer, or a team I'm on
// is a reviewer. `teams` holds the matched team display names (may be several).
export type PrRole = "author" | "reviewer" | "team";

// My (or my team's) standing on a PR I review. `needs` = not voted yet;
// `covered` = a teammate already satisfied the team's review for me.
export type PrReviewState =
  | "needs"
  | "covered"
  | "suggestions"
  | "approved"
  | "waiting"
  | "rejected";

export type PrEventType =
  | "added"
  | "refreshed"
  | "lane_changed"
  | "state_changed"
  | "reviewed"
  | "vote_changed"
  | "review_state"
  | "commit_pushed"
  | "draft_changed"
  | "comment_posted"
  | "snoozed"
  | "fte_woke"
  | "dismissed"
  | "out_of_scope"
  | "in_scope"
  | "removed"
  | "closed";

export interface AuthorMeta {
  completable: boolean;
  blockers: string[]; // unmet blocking policies (e.g. "Minimum number of reviewers")
  activeComments: number;
  resolvedComments: number;
  mergeStatus: string; // e.g. "succeeded" | "conflicts"
}

// A closed/merged PR whose linked review session can be archived.
export interface ArchivableSession {
  repo: string;
  number: number;
  status: string;
  sessionId: string;
}

export interface InsightsCount {
  label: string;
  count: number;
}

export interface LoadDayPr {
  canonical: string;
  repo: string;
  number: number;
  title: string;
  state: string | null;
  ageDays: number;
}

export interface InsightsWaiting {
  canonical: string;
  repo: string;
  number: number;
  title: string;
  waitingHours: number;
}

// One time bucket (a day or a week) for the load/capacity view. inflow = PRs that
// entered your review queue; throughput = reviews you completed; backlog = the
// "waiting on you" level (daily: level that day; weekly: that week's peak).
export interface InsightsLoadBucket {
  key: string;
  inflow: number;
  throughput: number;
  backlog: number;
}

export interface InsightsAuthoredPr {
  canonical: string;
  repo: string;
  number: number;
  title: string;
  activeComments: number;
  blockers: string[];
  completable: boolean;
}

// Aggregate analytics for the Insights page, computed on demand from the event
// log and current PR rows.
export interface Insights {
  generatedAt: string;
  latency: {
    count: number;
    pending: number;
    medianHours: number | null;
    p90Hours: number | null;
    fastestHours: number | null;
    slowestHours: number | null;
    points: { at: string; hours: number; repo: string; number: number; verdict: string | null }[];
    distribution: InsightsCount[];
  };
  throughput: {
    total: number;
    weekly: { week: string; quick: number; review: number; total: number }[];
  };
  load: {
    daily: InsightsLoadBucket[];
    weekly: InsightsLoadBucket[];
    peak: { count: number; at: string | null };
  };
  backlog: {
    waitingCount: number;
    longestHours: number | null;
    buckets: InsightsCount[];
    longest: InsightsWaiting[];
  };
  distribution: {
    byTeam: InsightsCount[];
    byRepo: InsightsCount[];
    byAuthorType: InsightsCount[];
  };
  reach: {
    items: { at: string; author: string; vendor: boolean; teams: string[] }[];
  };
  votePattern: {
    byType: { label: string; approved: number; suggestions: number; waiting: number; rejected: number }[];
    total: number;
    avgComments: number | null;
    commentsMeasured: number;
  };
  reviewDepth: {
    measured: number;
    totalComments: number;
    avg: number | null;
    median: number | null;
    p90: number | null;
    zeroRate: number | null;
    histogram: InsightsCount[];
    byType: { label: string; avg: number | null; count: number; total: number }[];
    byRepo: { label: string; avg: number; count: number }[];
    byLatency: { label: string; avg: number | null; count: number }[];
  };
  votePath: {
    measured: number;
    outcomes: { firstPass: number; gated: number; held: number };
    turns: { turn: number; verdict: string; count: number }[];
  };
  reviewCoverage: {
    origins: {
      team: string;
      total: number;
      me: number;
      teammate: number;
      needs: number;
      prs: { number: number; repo: string; title: string; coverage: "me" | "teammate" | "needs" }[];
    }[];
  };
  reviewRhythm: {
    items: { at: string; repo: string; team: string | null; number: number; title: string; verdict: string | null }[];
  };
  balance: {
    days: { key: string; inflow: number; throughput: number; level: number }[];
    heavyLine: number;
  };
  authored: {
    open: number;
    completable: number;
    blocked: number;
    mergedCount: number;
    medianMergeHours: number | null;
    openList: InsightsAuthoredPr[];
  };
}

export interface Pr {
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
  reviewState: PrReviewState | null;
  otherVotes: { name: string; vote: number }[];
  lane: Lane;
  state: PrState;
  isDraft: boolean;
  dismissed: boolean;
  dismissedReason: string | null;
  dismissedAt: string | null;
  outOfScope: boolean;
  snoozedUntil: string | null;
  snoozeMode: "time" | "fte" | null;
  lastCommitSha: string | null;
  lastCommitAt: string | null;
  prCreatedAt: string | null;
  addedAt: string;
  updatedAt: string;
  reviewSessionId: string | null;
  reviewedSha: string | null;
  authorMeta: AuthorMeta | null;
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

// --- External activity feed (consumed by Clio's capture pulse) ---

// The verdict a "reviewed"/"review_state" event settled on. A subset of
// PrReviewState: the non-terminal triage states (needs/covered) never surface.
export type ActivityVerdict = "approved" | "suggestions" | "rejected" | "waiting";

// The event vocabulary Clio consumes. A subset of PrEventType (the triage-noise
// types are dropped), with authored lifecycle split out so a consumer can tell
// "I opened/merged my PR" from "a PR entered/left my review queue".
export type ActivityEventType =
  | "authored_opened"
  | "authored_merged"
  | "added"
  | "closed"
  | "reviewed"
  | "vote_changed"
  | "review_state"
  | "commit_pushed"
  | "comment_posted";

// One PR activity event attributable to me, flattened with the PR identity Clio
// needs. `id` is the stable pr_events row id (Clio can dedup on it).
export interface ActivityEvent {
  id: number;
  ts: string;
  type: ActivityEventType;
  role: PrRole;
  pr: {
    canonical: string;
    org: string;
    project: string;
    repo: string;
    number: number;
    title: string;
    author: string | null;
    isVendor: boolean;
    teams: string[];
    url: string;
  };
  verdict: ActivityVerdict | null;
  vote: number | null;
  activeComments: number | null;
  resolvedComments: number | null;
  reviewSessionId: string | null;
}

export interface ActivityFeed {
  since: string;
  until: string;
  generatedAt: string;
  events: ActivityEvent[];
}

// --- Deploy tracking (where a merged PR shipped) ---

// One environment's deploy state for a build: the stage's run state and result,
// and when it finished. null = the build has no matching stage for that env.
export interface DeployEnv {
  state: string | null; // notStarted | inProgress | completed | ...
  result: string | null; // succeeded | failed | canceled | ...
  finishedAt: string | null;
}

// Where a merged PR's build has reached across dev/ppe/prod. `found` is false
// when no build matched the merge commit (repo has no configured pipeline, or
// the build isn't visible). `terminal` = resolved for good (prod succeeded, or
// the PR was abandoned), so it never needs re-resolving.
export interface PrDeploy {
  found: boolean;
  buildId: number | null;
  buildNumber: string | null;
  buildUrl: string | null;
  dev: DeployEnv | null;
  ppe: DeployEnv | null;
  prod: DeployEnv | null;
  terminal: boolean;
}

// One row in the deploy timeline: a merged PR plus where it has shipped.
export interface DeployTimelinePr {
  canonical: string;
  repo: string;
  number: number;
  title: string;
  mergedAt: string;
  deploy: PrDeploy;
}
