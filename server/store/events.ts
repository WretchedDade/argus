import type { DatabaseSync } from "node:sqlite";
import type {
    ActivityEvent,
    ActivityEventType,
    ActivityVerdict,
    AuthorMeta,
    PrEvent,
    PrEventType,
    PrRole,
    RunEvent,
} from "../types.ts";
import { prep } from "./prep.ts";
import { getSetting, setSetting } from "./settings.ts";

interface EventRow {
    id: number;
    canonical: string;
    ts: string;
    type: string;
    payload: string | null;
}

interface RunEventRow extends EventRow {
    repo: string;
    number: number;
    title: string;
}

const now = (): string => new Date().toISOString();

function rowToEvent(r: EventRow): PrEvent {
    return {
        id: r.id,
        canonical: r.canonical,
        ts: r.ts,
        type: r.type as PrEventType,
        payload: r.payload
            ? (JSON.parse(r.payload) as Record<string, unknown>)
            : null,
    };
}

function rowToRunEvent(r: RunEventRow): RunEvent {
    return { ...rowToEvent(r), repo: r.repo, number: r.number, title: r.title };
}

// The exact set of change signals the bell's change-feed surfaces —
// deliberately narrow, one per scenario the user cares about:
//   1. new commits on a PR you already recorded a verdict on (re-review)
//   2. a PR newly added to your queue
//   3. an "until FTE approves" snooze cleared by an FTE approval
// Scenario 4 (a merged PR ready to archive its review session) is handled
// separately by the archive banner (the `archivable` list), which groups them
// into one line with an Archive action — NOT here, so a merged PR doesn't
// surface as a plain row that only opens the detail page. Everything else
// (teammate votes, review_state churn, drafts, commits on unreviewed PRs) is
// intentionally excluded as noise. References the joined `p` (prs) row, so
// every query using this filter must JOIN prs p.
const CHANGE_FILTER = `(
        e.type = 'added'
        OR (e.type = 'commit_pushed' AND p.reviewed_at IS NOT NULL)
        OR e.type = 'fte_woke'
      )`;

export function appendEvent(
    db: DatabaseSync,
    canonical: string,
    type: PrEventType,
    payload?: Record<string, unknown>,
    ts: string = now(),
    runId?: number,
): void {
    prep(
        db,
        "INSERT INTO pr_events (canonical, ts, type, payload, run_id) VALUES (?, ?, ?, ?, ?)",
    ).run(
        canonical,
        ts,
        type,
        payload ? JSON.stringify(payload) : null,
        runId ?? null,
    );
}

export function listEvents(db: DatabaseSync, canonical: string): PrEvent[] {
    const rows = prep(
        db,
        "SELECT * FROM pr_events WHERE canonical = ? ORDER BY ts ASC, id ASC",
    ).all(canonical) as unknown as EventRow[];
    return rows.map(rowToEvent);
}

// Windowed feed of MY PR activity (authored + reviewed), for external
// consumers (Clio's capture pulse). Every tracked PR is mine in some role, so
// the source is simply pr_events joined to PR identity, restricted to the
// event types that represent real PR activity (triage-noise types are dropped)
// and to events in [sinceMs, untilMs). Authored `added`/`closed` are relabeled
// as authored_opened/authored_merged. Vote churn by other reviewers only
// surfaces on PRs I authored (on PRs I review, only my own vote is "mine").
export function listPrActivity(
    db: DatabaseSync,
    sinceMs: number,
    untilMs: number,
): ActivityEvent[] {
    const WANTED =
        "('added','closed','reviewed','vote_changed','review_state','commit_pushed','comment_posted')";
    const sinceIso = new Date(sinceMs).toISOString();
    const untilIso = new Date(untilMs).toISOString();
    const rows = prep(
        db,
        `
      SELECT e.id, e.canonical, e.ts, e.type, e.payload,
             p.org, p.project, p.repo, p.number, p.title, p.author, p.is_vendor,
             p.role, p.teams_json, p.review_session_id, p.author_meta_json
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type IN ${WANTED} AND e.ts >= ? AND e.ts < ?
      ORDER BY e.ts ASC, e.id ASC
    `,
    ).all(sinceIso, untilIso) as unknown as {
        id: number;
        canonical: string;
        ts: string;
        type: string;
        payload: string | null;
        org: string;
        project: string;
        repo: string;
        number: number;
        title: string;
        author: string | null;
        is_vendor: number;
        role: string | null;
        teams_json: string | null;
        review_session_id: string | null;
        author_meta_json: string | null;
    }[];

    const VERDICTS = new Set<ActivityVerdict>([
        "approved",
        "suggestions",
        "rejected",
        "waiting",
    ]);
    const out: ActivityEvent[] = [];
    for (const r of rows) {
        // Defensive exact-window check (SQL bound is lexicographic on ISO strings;
        // guard against any non-UTC legacy timestamp slipping through).
        const t = Date.parse(r.ts);
        if (!(t >= sinceMs && t < untilMs)) continue;

        const role = (r.role as PrRole) ?? "reviewer";
        const payload = r.payload
            ? (JSON.parse(r.payload) as Record<string, unknown>)
            : {};

        // Drop other reviewers' vote churn on PRs I only review — not my activity.
        if (
            r.type === "vote_changed" &&
            role !== "author" &&
            payload.mine !== true
        )
            continue;

        let type: ActivityEventType;
        if (r.type === "added")
            type = role === "author" ? "authored_opened" : "added";
        else if (r.type === "closed")
            type =
                role === "author" && payload.reason === "completed"
                    ? "authored_merged"
                    : "closed";
        else type = r.type as ActivityEventType;

        let verdict: ActivityVerdict | null = null;
        if (
            r.type === "reviewed" &&
            typeof payload.verdict === "string" &&
            VERDICTS.has(payload.verdict as ActivityVerdict)
        ) {
            verdict = payload.verdict as ActivityVerdict;
        } else if (
            r.type === "review_state" &&
            typeof payload.to === "string" &&
            VERDICTS.has(payload.to as ActivityVerdict)
        ) {
            verdict = payload.to as ActivityVerdict;
        }

        const vote =
            r.type === "vote_changed" && typeof payload.vote === "number"
                ? payload.vote
                : null;
        const meta = r.author_meta_json
            ? (JSON.parse(r.author_meta_json) as AuthorMeta)
            : null;

        out.push({
            id: r.id,
            ts: r.ts,
            type,
            role,
            pr: {
                canonical: r.canonical,
                org: r.org,
                project: r.project,
                repo: r.repo,
                number: r.number,
                title: r.title,
                author: r.author,
                isVendor: !!r.is_vendor,
                teams: r.teams_json
                    ? (JSON.parse(r.teams_json) as string[])
                    : [],
                url: r.canonical,
            },
            verdict,
            vote,
            activeComments: meta ? meta.activeComments : null,
            resolvedComments: meta ? meta.resolvedComments : null,
            reviewSessionId: r.review_session_id,
        });
    }
    return out;
}

// Per-PR changes a run produced, joined with PR identity for display.
export function listRunEvents(db: DatabaseSync, runId: number): RunEvent[] {
    const rows = prep(
        db,
        `
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.run_id = ? ORDER BY e.id ASC
    `,
    ).all(runId) as unknown as RunEventRow[];
    return rows.map(rowToRunEvent);
}

export function getChangesSeenAt(db: DatabaseSync): string | null {
    return getSetting(db, "changes_seen_at");
}

export function setChangesSeenAt(db: DatabaseSync, ts: string = now()): void {
    setSetting(db, "changes_seen_at", ts);
}

// Unread change events: surfaced changes newer than the caught-up watermark
// and not individually marked read. This is the notifications bell feed.
export function listUnreadChanges(db: DatabaseSync, limit = 200): RunEvent[] {
    const baseline = getChangesSeenAt(db);
    const nowTs = now();
    const clause = baseline ? " AND e.ts > ?" : "";
    const params: (string | number)[] = baseline
        ? [baseline, nowTs, limit]
        : [nowTs, limit];
    const rows = prep(
        db,
        `
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE ${CHANGE_FILTER}${clause}
        AND e.id NOT IN (SELECT event_id FROM changes_read)
        AND p.out_of_scope = 0
        AND p.dismissed = 0
        AND COALESCE(p.snooze_mode, '') != 'fte'
        AND (p.snoozed_until IS NULL OR p.snoozed_until <= ?)
      ORDER BY e.ts DESC, e.id DESC LIMIT ?
    `,
    ).all(...params) as unknown as RunEventRow[];
    return rows.map(rowToRunEvent);
}

// Mark every currently-unread change for one PR as read (used when the user
// clicks through to re-review that PR).
export function markChangesReadForPr(
    db: DatabaseSync,
    canonical: string,
): void {
    const ts = now();
    prep(
        db,
        `
      INSERT OR IGNORE INTO changes_read (event_id, read_at)
      SELECT e.id, ? FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.canonical = ? AND ${CHANGE_FILTER}
    `,
    ).run(ts, canonical);
}

// Clear the whole feed by advancing the caught-up watermark to now.
export function markAllChangesRead(db: DatabaseSync): void {
    setChangesSeenAt(db);
}
