import type { CurrentPr } from "./types.ts";
import type { Lane, PrEventType, PrState, PrUpsert } from "../types.ts";

// Prior state of a tracked PR, enough to decompose a change into typed events.
export interface Snapshot {
  sha: string | null;
  isDraft: boolean;
  state: PrState;
  dismissed: boolean;
  votes: Record<string, number>;
}

export interface EventInsert {
  canonical: string;
  type: PrEventType;
  payload?: Record<string, unknown>;
  ts: string;
}

// One PR's worth of writes: metadata upsert, the events its change produced, the
// new reviewer-vote snapshot, and (for a first sighting) its suggested lane.
export interface PlanItem {
  upsert: PrUpsert;
  isAdd: boolean;
  lane: Lane;
  events: EventInsert[];
  votes: Record<string, number>;
}

export interface Plan {
  items: PlanItem[];
  stats: ReconcileStats;
}

// Funnel breakdown for the run trace, so an unchanged run still explains itself.
export interface ReconcileStats {
  mine: number; // matched as mine (input)
  dismissed: number; // skipped: dismissed
  newRecent: number; // added (untracked, within recency)
  newStale: number; // skipped: untracked but older than recency
  changed: number; // tracked, signature moved
  unchanged: number; // tracked, no change
}

export interface ReconcileOptions {
  recencyDays: number;
  nowMs: number;
  me?: string | null; // my identity (uniqueName), so my own vote isn't surfaced as a change
}

// Pure: given the PRs ADO currently reports as mine and the prior snapshots,
// produce the writes to apply plus a funnel breakdown. No I/O, so the event
// decomposition stays unit testable. Absence/terminal handling lives in the
// poller (it needs I/O).
export function reconcile(
  currents: CurrentPr[],
  snapshots: Map<string, Snapshot>,
  opts: ReconcileOptions,
): Plan {
  const nowIso = new Date(opts.nowMs).toISOString();
  const items: PlanItem[] = [];
  const stats: ReconcileStats = {
    mine: currents.length,
    dismissed: 0,
    newRecent: 0,
    newStale: 0,
    changed: 0,
    unchanged: 0,
  };

  for (const c of currents) {
    const snap = snapshots.get(c.canonical);
    if (snap?.dismissed) {
      stats.dismissed += 1; // never resurrect a dismissed PR
      continue;
    }

    const votes = Object.fromEntries(c.reviewers.map((r) => [r.id, r.vote]));

    if (!snap) {
      // First sighting: only add if recent, otherwise ignore stale untracked PRs.
      if (opts.nowMs - Date.parse(c.createdAt) > opts.recencyDays * 86_400_000) {
        stats.newStale += 1;
        continue;
      }
      stats.newRecent += 1;
      items.push({
        upsert: toUpsert(c),
        isAdd: true,
        lane: suggestLane(c),
        events: [{ canonical: c.canonical, type: "added", ts: nowIso }],
        votes,
      });
      continue;
    }

    // Known PR: decompose exactly what moved into typed events.
    const events = diffEvents(c, snap, votes, nowIso, opts.me ?? null);
    if (events.length === 0) {
      stats.unchanged += 1;
      continue;
    }
    stats.changed += 1;
    items.push({ upsert: toUpsert(c), isAdd: false, lane: "review", events, votes });
  }

  return { items, stats };
}

function diffEvents(
  c: CurrentPr,
  snap: Snapshot,
  votes: Record<string, number>,
  ts: string,
  me: string | null,
): EventInsert[] {
  const events: EventInsert[] = [];
  if (c.sha && c.sha !== snap.sha) {
    events.push({ canonical: c.canonical, type: "commit_pushed", payload: { sha: c.sha }, ts });
  }
  if (c.isDraft !== snap.isDraft) {
    events.push({ canonical: c.canonical, type: "draft_changed", payload: { is_draft: c.isDraft }, ts });
  }
  const reviewerMeta = new Map(c.reviewers.map((r) => [r.id, r]));
  for (const [id, vote] of Object.entries(votes)) {
    if (snap.votes[id] !== vote) {
      const m = reviewerMeta.get(id);
      // Skip group-container propagation (the same vote lands on every team the
      // person belongs to); only record the individual human vote, with a name.
      if (m?.isContainer) continue;
      // Still record my own vote (it's the only trail of out-of-Argus approvals),
      // but tag it so the notifications feed can exclude it as non-actionable noise.
      events.push({
        canonical: c.canonical,
        type: "vote_changed",
        payload: { reviewer: id, name: m?.displayName ?? null, vote, mine: !!(me && m?.uniqueName === me) },
        ts,
      });
    }
  }
  return events;
}

function toUpsert(c: CurrentPr): PrUpsert {
  return {
    canonical: c.canonical,
    org: c.org,
    project: c.project,
    repo: c.repo,
    number: c.number,
    title: c.title,
    description: c.description,
    author: c.author,
    isVendor: c.isVendor,
    role: c.role,
    teams: c.teams,
    isDraft: c.isDraft,
    lastCommitSha: c.sha,
    lastCommitAt: c.createdAt, // proxy; the bulk list carries no commit time
    prCreatedAt: c.createdAt,
    sourceBranch: c.sourceBranch,
    targetBranch: c.targetBranch,
  };
}

// Lane heuristics need file-level detail we don't fetch, so default to review
// (the safe lane); the user re-lanes as needed.
function suggestLane(_c: CurrentPr): Lane {
  return "review";
}
