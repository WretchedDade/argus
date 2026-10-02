import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ActivityEvent, ActivityEventType, ActivityVerdict, ArchivableSession, AuthorMeta, DeployTimelinePr, Insights, InsightsCount, InsightsLoadBucket, InsightsWaiting, Lane, LoadDayPr, Pr, PrDeploy, PrEvent, PrEventType, PrReviewState, PrRole, PrState, PrUpsert, RunEvent } from "./types.ts";
import type { Plan, Snapshot } from "./ado/reconcile.ts";
import type { ConfigOverrides } from "./config.ts";
import { isVendorName } from "./ado/normalize.ts";
import { log } from "./log.ts";

// Operational log rows returned to the activity/runs routes.
export interface ActivityEntry {
  id: number;
  ts: string;
  level: string;
  msg: string;
  data: Record<string, unknown> | null;
  runId: number | null;
}

export interface PollRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  mine: number | null;
  tracked: number | null;
  added: number | null;
  updated: number | null;
  events: number | null;
  closed: number | null;
  error: string | null;
}

export interface PollRunResult {
  ok: boolean;
  mine?: number;
  tracked?: number;
  added?: number;
  updated?: number;
  events?: number;
  closed?: number;
  error?: string | null;
}

interface ActivityRow {
  id: number;
  ts: string;
  level: string;
  msg: string;
  data: string | null;
  run_id: number | null;
}

interface PollRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  ok: number;
  mine: number | null;
  tracked: number | null;
  added: number | null;
  updated: number | null;
  events: number | null;
  closed: number | null;
  error: string | null;
}

function rowToActivity(r: ActivityRow): ActivityEntry {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level,
    msg: r.msg,
    data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null,
    runId: r.run_id,
  };
}

function rowToRun(r: PollRunRow): PollRun {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    ok: !!r.ok,
    mine: r.mine,
    tracked: r.tracked,
    added: r.added,
    updated: r.updated,
    events: r.events,
    closed: r.closed,
    error: r.error,
  };
}


// prs holds the current snapshot; pr_events is the append-only timeline every
// metric is derived from. User-managed columns live on prs but are only ever
// written by the dedicated action methods, never by upsertPr.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS prs (
  canonical         TEXT PRIMARY KEY,
  org               TEXT NOT NULL DEFAULT '',
  project           TEXT NOT NULL DEFAULT '',
  repo              TEXT NOT NULL DEFAULT '',
  number            INTEGER NOT NULL DEFAULT 0,
  title             TEXT NOT NULL DEFAULT '',
  author            TEXT,
  is_vendor         INTEGER NOT NULL DEFAULT 0,
  lane              TEXT NOT NULL DEFAULT 'review',
  state             TEXT NOT NULL DEFAULT 'pending',
  is_draft          INTEGER NOT NULL DEFAULT 0,
  dismissed         INTEGER NOT NULL DEFAULT 0,
  dismissed_reason  TEXT,
  dismissed_at      TEXT,
  snoozed_until     TEXT,
  last_commit_sha   TEXT,
  last_commit_at    TEXT,
  pr_created_at     TEXT,
  added_at          TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  review_session_id TEXT,
  reviewers_json    TEXT
);

CREATE TABLE IF NOT EXISTS pr_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical TEXT NOT NULL,
  ts        TEXT NOT NULL,
  type      TEXT NOT NULL,
  payload   TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_canonical ON pr_events(canonical);
CREATE INDEX IF NOT EXISTS idx_events_ts        ON pr_events(ts);

-- Operational logs, pruned by age (see pruneLogs). poll_runs is one row per
-- reconcile cycle; activity_log is the granular trace within/around a run.
CREATE TABLE IF NOT EXISTS poll_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  mine        INTEGER,
  added       INTEGER,
  updated     INTEGER,
  events      INTEGER,
  closed      INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pollruns_started ON poll_runs(started_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  level  TEXT NOT NULL,
  msg    TEXT NOT NULL,
  data   TEXT,
  run_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Per-event "read" marks for the notifications bell. An event is unread when it
-- is a surfaced change, newer than the changes_seen_at watermark, and absent here.
CREATE TABLE IF NOT EXISTS changes_read (event_id INTEGER PRIMARY KEY, read_at TEXT NOT NULL);
`;

const b = (v: boolean): number => (v ? 1 : 0);
const now = (): string => new Date().toISOString();

const HOUR_MS = 3_600_000;
const WEEK_MS = 604_800_000;

// Median of an unsorted numeric list (null when empty).
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, c) => a - c);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank percentile (null when empty).
function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, c) => a - c);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ISO date (YYYY-MM-DD) of the Monday starting the week that contains `ms`.
function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// The last `n` week-start keys, oldest first, ending with the current week.
function recentWeeks(n: number): string[] {
  const start = weekKey(Date.now());
  const startMs = Date.parse(start);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(startMs - i * WEEK_MS).toISOString().slice(0, 10));
  return out;
}

// Heuristic author classification for the review-load breakdown. Automated bots
// are matched by name; everyone else falls back to the vendor/FTE flag. The
// pattern is intentionally conservative and can be extended as new bots appear.
const AUTOMATED_RE = /dependabot|renovate|\bbot\b|build service|azure pipelines|automation|\bagency\b/i;
function classifyAuthor(author: string | null, isVendor: boolean): "FTE" | "Vendor" | "Automated" {
  if (author && AUTOMATED_RE.test(author)) return "Automated";
  return isVendor ? "Vendor" : "FTE";
}


// Subset of the old pr-tracker state records used by importLegacyState.
interface LegacyPr {
  url?: string;
  org?: string;
  project?: string;
  repo?: string;
  pr_number?: number;
  title?: string;
  author_display_name?: string | null;
  is_vendor?: boolean;
  is_draft?: boolean;
  lane?: string;
  state?: string;
  last_commit_sha?: string | null;
  last_commit_at?: string | null;
  pr_created_at?: string | null;
  added_at?: string | null;
  last_refreshed_at?: string | null;
  reviewers?: { id?: string; display_name?: string; vote_code?: number; is_container?: boolean }[];
}

// Case-insensitive `*`-glob match, for team display-name patterns.
function globMatch(pattern: string, value: string): boolean {
  const rx = new RegExp(
    "^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
  return rx.test(value);
}

interface PrRow {
  canonical: string;
  org: string;
  project: string;
  repo: string;
  number: number;
  title: string;
  description: string | null;
  author: string | null;
  is_vendor: number;
  role: string | null;
  teams_json: string | null;
  review_state: string | null;
  approvals_json: string | null;
  author_meta_json: string | null;
  lane: string;
  state: string;
  is_draft: number;
  dismissed: number;
  dismissed_reason: string | null;
  dismissed_at: string | null;
  out_of_scope: number;
  snoozed_until: string | null;
  snooze_mode: string | null;
  reviewed_sha: string | null;
  last_commit_sha: string | null;
  last_commit_at: string | null;
  pr_created_at: string | null;
  added_at: string;
  updated_at: string;
  review_session_id: string | null;
  changed_files: number | null;
}

function rowToPr(r: PrRow): Pr {
  return {
    canonical: r.canonical,
    org: r.org,
    project: r.project,
    repo: r.repo,
    number: r.number,
    title: r.title,
    description: r.description ?? "",
    author: r.author,
    isVendor: !!r.is_vendor,
    role: (r.role as PrRole) ?? "reviewer",
    teams: r.teams_json ? (JSON.parse(r.teams_json) as string[]) : [],
    reviewState: (r.review_state as PrReviewState) ?? null,
    otherVotes: r.approvals_json ? (JSON.parse(r.approvals_json) as { name: string; vote: number }[]) : [],
    lane: r.lane as Lane,
    state: r.state as PrState,
    isDraft: !!r.is_draft,
    dismissed: !!r.dismissed,
    dismissedReason: r.dismissed_reason,
    dismissedAt: r.dismissed_at,
    outOfScope: !!r.out_of_scope,
    snoozedUntil: r.snoozed_until,
    snoozeMode: (r.snooze_mode as "time" | "fte" | null) ?? null,
    lastCommitSha: r.last_commit_sha,
    lastCommitAt: r.last_commit_at,
    prCreatedAt: r.pr_created_at,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    reviewSessionId: r.review_session_id,
    reviewedSha: r.reviewed_sha,
    changedFiles: r.changed_files ?? null,
    authorMeta: r.author_meta_json ? (JSON.parse(r.author_meta_json) as AuthorMeta) : null,
  };
}

interface EventRow {
  id: number;
  canonical: string;
  ts: string;
  type: string;
  payload: string | null;
}

function rowToEvent(r: EventRow): PrEvent {
  return {
    id: r.id,
    canonical: r.canonical,
    ts: r.ts,
    type: r.type as PrEventType,
    payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
  };
}

export interface ListOptions {
  includeClosed?: boolean;
  includeDismissed?: boolean;
}

export class ArgusStore {
  #db: DatabaseSync;
  #stmts = new Map<string, StatementSync>();

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA busy_timeout = 5000;"); // wait out transient locks (e.g. a lingering process after reload) instead of throwing SQLITE_BUSY
    this.#db.exec(SCHEMA);
    this.#ensureColumn("prs", "reviewers_json", "TEXT"); // added after first release
    this.#ensureColumn("pr_events", "run_id", "INTEGER"); // links an event to its poll run
    this.#ensureColumn("poll_runs", "tracked", "INTEGER"); // queue size at end of run
    this.#ensureColumn("prs", "role", "TEXT"); // author | reviewer | team
    this.#ensureColumn("prs", "teams_json", "TEXT"); // matched team display names
    this.#ensureColumn("prs", "review_state", "TEXT"); // needs | covered | approved | ...
    this.#ensureColumn("prs", "description", "TEXT"); // PR description body (for card preview)
    this.#ensureColumn("prs", "out_of_scope", "INTEGER NOT NULL DEFAULT 0"); // user marked "not my review"
    this.#ensureColumn("prs", "snooze_mode", "TEXT"); // null | "time" | "fte" (wake when a teammate/FTE approves)
    this.#ensureColumn("prs", "reviewed_sha", "TEXT"); // commit sha at the time of my recorded review (re-push detection)
    this.#ensureColumn("prs", "reviewed_at", "TEXT"); // when I recorded my verdict (latency end)
    this.#ensureColumn("prs", "reviewed_sha_authored_at", "TEXT"); // authored date of reviewed_sha (latency start); backfilled by the poller
    this.#ensureColumn("prs", "my_comments", "INTEGER"); // # of comments I authored on this PR; counted once after I record a verdict
    this.#ensureColumn("prs", "approvals_json", "TEXT"); // individuals who approved (name + vote), for card display
    this.#ensureColumn("prs", "author_meta_json", "TEXT"); // completability + comment counts for authored PRs
    this.#ensureColumn("prs", "merge_commit", "TEXT"); // the merge commit sha (for deploy tracking); captured on close
    this.#ensureColumn("prs", "merged_at", "TEXT"); // ADO's real closedDate (merge time), for build time-bounding
    this.#ensureColumn("prs", "deploy_json", "TEXT"); // cached PrDeploy: where this merged PR has shipped
    this.#ensureColumn("prs", "deploy_resolved_at", "TEXT"); // when deploy_json was last resolved
    this.#ensureColumn("prs", "source_branch", "TEXT"); // PR source branch (for the diff/file-count call)
    this.#ensureColumn("prs", "target_branch", "TEXT"); // PR target branch
    this.#ensureColumn("prs", "changed_files", "INTEGER"); // # of files changed in the PR (from ADO branch diff)
    this.#ensureColumn("prs", "changed_files_sha", "TEXT"); // the head sha the file count was computed at (staleness check)
    // One-time: the first file-count pass used a bad query param and stored 0s;
    // clear them so they recompute correctly.
    if (!this.#getSetting("changed_files_reset")) {
      this.#db.exec("UPDATE prs SET changed_files = NULL, changed_files_sha = NULL");
      this.#setSetting("changed_files_reset", now());
    }
    // One-time: clear cached not-found deploy results, so they re-resolve. Covers
    // the pre-`reason` rows and the pre-`merged_at` rows whose build search used
    // Argus's detection time (often days after the real merge) and missed the build.
    if (!this.#getSetting("deploy_time_migrated")) {
      this.#db.exec("UPDATE prs SET deploy_json = NULL WHERE deploy_json IS NOT NULL AND json_extract(deploy_json, '$.found') = 0");
      this.#setSetting("deploy_time_migrated", now());
    }
    // Backfill reviewed_at (verdict time) for reviews recorded before that column
    // existed, from the latest recorded 'reviewed' verdict event.
    this.#db.exec(`
      UPDATE prs SET reviewed_at = (
        SELECT MAX(e.ts) FROM pr_events e
        WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
          AND json_extract(e.payload, '$.verdict') IS NOT NULL
      )
      WHERE reviewed_sha IS NOT NULL AND reviewed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM pr_events e
          WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
            AND json_extract(e.payload, '$.verdict') IS NOT NULL
        )
    `);
    // Backfill the reviewed sha's authored date from last_commit_at when the
    // reviewed sha is still the head we last saw (the common case).
    this.#db.exec(`
      UPDATE prs SET reviewed_sha_authored_at = last_commit_at
      WHERE reviewed_sha IS NOT NULL AND reviewed_sha_authored_at IS NULL
        AND reviewed_sha = last_commit_sha AND last_commit_at IS NOT NULL
    `);
    // Backfill a `verdict` onto migrated review events from the old tracker's
    // vote label, so historical reviews feed the verdict-based metrics (rhythm,
    // throughput). Idempotent: only touches migration reviews still lacking a
    // verdict whose vote maps to a known state ("No Vote" stays excluded).
    this.#db.exec(`
      UPDATE pr_events
      SET payload = json_set(payload, '$.verdict',
        CASE lower(json_extract(payload, '$.vote'))
          WHEN 'approved' THEN 'approved'
          WHEN 'approve' THEN 'approved'
          WHEN 'approved with suggestions' THEN 'suggestions'
          WHEN 'waiting for author' THEN 'waiting'
          WHEN 'rejected' THEN 'rejected'
        END)
      WHERE type = 'reviewed'
        AND json_extract(payload, '$.source') = 'migration'
        AND json_extract(payload, '$.verdict') IS NULL
        AND lower(json_extract(payload, '$.vote')) IN
            ('approved', 'approve', 'approved with suggestions', 'waiting for author', 'rejected')
    `);
    // Backfill final verdict + comment count onto migrated PRs from their latest
    // migrated review, so historical reviews feed How-you-vote, Review depth, and
    // the vote journey. Migrated rows have null role/teams, so they stay out of
    // team-coverage (no source data) but count where only a verdict is needed.
    this.#db.exec(`
      UPDATE prs SET review_state = (
        SELECT json_extract(e.payload, '$.verdict') FROM pr_events e
        WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
          AND json_extract(e.payload, '$.source') = 'migration'
          AND json_extract(e.payload, '$.verdict') IS NOT NULL
        ORDER BY e.ts DESC, e.id DESC LIMIT 1
      )
      WHERE review_state IS NULL AND EXISTS (
        SELECT 1 FROM pr_events e
        WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
          AND json_extract(e.payload, '$.source') = 'migration'
          AND json_extract(e.payload, '$.verdict') IS NOT NULL
      )
    `);
    this.#db.exec(`
      UPDATE prs SET my_comments = (
        SELECT COALESCE(json_extract(e.payload, '$.comments_posted.critical'), 0)
             + COALESCE(json_extract(e.payload, '$.comments_posted.important'), 0)
             + COALESCE(json_extract(e.payload, '$.comments_posted.suggestion'), 0)
             + COALESCE(json_extract(e.payload, '$.comments_posted.praise'), 0)
        FROM pr_events e
        WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
          AND json_extract(e.payload, '$.source') = 'migration'
          AND json_extract(e.payload, '$.verdict') IS NOT NULL
        ORDER BY e.ts DESC, e.id DESC LIMIT 1
      )
      WHERE my_comments IS NULL AND EXISTS (
        SELECT 1 FROM pr_events e
        WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
          AND json_extract(e.payload, '$.source') = 'migration'
          AND json_extract(e.payload, '$.verdict') IS NOT NULL
      )
    `);
    // Baseline "changes seen" to now on first run so you start caught up rather
    // than facing the entire migrated history as unseen.
    if (!this.getChangesSeenAt()) this.setChangesSeenAt();
  }

  // Add a column to an existing DB if a prior schema version lacked it.
  #ensureColumn(table: string, column: string, type: string): void {
    const cols = this.#db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  // Cache prepared statements by SQL text so hot paths don't recompile.
  #prep(sql: string): StatementSync {
    let stmt = this.#stmts.get(sql);
    if (!stmt) {
      stmt = this.#db.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }

  // Insert on first sight, otherwise refresh only ADO-sourced columns. Triage
  // columns (lane, state, dismissed, snooze, session, added_at) are untouched.
  upsertPr(pr: PrUpsert): void {
    const ts = now();
    this.#prep(`
      INSERT INTO prs (canonical, org, project, repo, number, title, description, author,
                       is_vendor, role, teams_json, is_draft, last_commit_sha,
                       last_commit_at, pr_created_at, source_branch, target_branch, added_at, updated_at)
      VALUES ($canonical, $org, $project, $repo, $number, $title, $description, $author,
              $is_vendor, $role, $teams_json, $is_draft, $last_commit_sha,
              $last_commit_at, $pr_created_at, $source_branch, $target_branch, $ts, $ts)
      ON CONFLICT(canonical) DO UPDATE SET
        org = excluded.org, project = excluded.project, repo = excluded.repo,
        number = excluded.number, title = excluded.title,
        description = CASE
          WHEN description IS NULL OR description = '' OR length(excluded.description) >= length(description)
          THEN excluded.description ELSE description END,
        author = excluded.author,
        is_vendor = excluded.is_vendor, role = excluded.role, teams_json = excluded.teams_json,
        is_draft = excluded.is_draft,
        last_commit_sha = excluded.last_commit_sha,
        last_commit_at = excluded.last_commit_at,
        pr_created_at = excluded.pr_created_at,
        source_branch = excluded.source_branch,
        target_branch = excluded.target_branch,
        updated_at = excluded.updated_at
    `).run({
      $canonical: pr.canonical,
      $org: pr.org,
      $project: pr.project,
      $repo: pr.repo,
      $number: pr.number,
      $title: pr.title,
      $description: pr.description,
      $author: pr.author,
      $is_vendor: b(pr.isVendor),
      $role: pr.role,
      $teams_json: JSON.stringify(pr.teams),
      $is_draft: b(pr.isDraft),
      $last_commit_sha: pr.lastCommitSha,
      $last_commit_at: pr.lastCommitAt,
      $pr_created_at: pr.prCreatedAt,
      $source_branch: pr.sourceBranch ?? null,
      $target_branch: pr.targetBranch ?? null,
      $ts: ts,
    });
  }

  getPr(canonical: string): Pr | null {
    const row = this.#prep("SELECT * FROM prs WHERE canonical = ?").get(canonical) as
      | PrRow
      | undefined;
    return row ? rowToPr(row) : null;
  }

  // Resolve a PR number to its canonical, across any state (incl. closed and
  // dismissed) so search can reach historical PRs. ADO PR ids are unique within
  // the org, so number alone is enough; newest wins if somehow duplicated.
  findCanonicalByNumber(number: number): string | null {
    const row = this.#prep(
      "SELECT canonical FROM prs WHERE number = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(number) as { canonical: string } | undefined;
    return row?.canonical ?? null;
  }

  listPrs(opts: ListOptions = {}): Pr[] {
    const where: string[] = [];
    if (!opts.includeClosed) where.push("state != 'closed'");
    if (!opts.includeDismissed) where.push("dismissed = 0");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.#prep(
      `SELECT * FROM prs ${clause} ORDER BY updated_at DESC`,
    ).all() as unknown as PrRow[];
    return rows.map(rowToPr);
  }

  appendEvent(
    canonical: string,
    type: PrEventType,
    payload?: Record<string, unknown>,
    ts: string = now(),
    runId?: number,
  ): void {
    this.#prep(
      "INSERT INTO pr_events (canonical, ts, type, payload, run_id) VALUES (?, ?, ?, ?, ?)",
    ).run(canonical, ts, type, payload ? JSON.stringify(payload) : null, runId ?? null);
  }

  listEvents(canonical: string): PrEvent[] {
    const rows = this.#prep(
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
  listPrActivity(sinceMs: number, untilMs: number): ActivityEvent[] {
    const WANTED = "('added','closed','reviewed','vote_changed','review_state','commit_pushed','comment_posted')";
    const sinceIso = new Date(sinceMs).toISOString();
    const untilIso = new Date(untilMs).toISOString();
    const rows = this.#prep(`
      SELECT e.id, e.canonical, e.ts, e.type, e.payload,
             p.org, p.project, p.repo, p.number, p.title, p.author, p.is_vendor,
             p.role, p.teams_json, p.review_session_id, p.author_meta_json
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type IN ${WANTED} AND e.ts >= ? AND e.ts < ?
      ORDER BY e.ts ASC, e.id ASC
    `).all(sinceIso, untilIso) as unknown as {
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

    const VERDICTS = new Set<ActivityVerdict>(["approved", "suggestions", "rejected", "waiting"]);
    const out: ActivityEvent[] = [];
    for (const r of rows) {
      // Defensive exact-window check (SQL bound is lexicographic on ISO strings;
      // guard against any non-UTC legacy timestamp slipping through).
      const t = Date.parse(r.ts);
      if (!(t >= sinceMs && t < untilMs)) continue;

      const role = (r.role as PrRole) ?? "reviewer";
      const payload = r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : {};

      // Drop other reviewers' vote churn on PRs I only review — not my activity.
      if (r.type === "vote_changed" && role !== "author" && payload.mine !== true) continue;

      let type: ActivityEventType;
      if (r.type === "added") type = role === "author" ? "authored_opened" : "added";
      else if (r.type === "closed") type = role === "author" && payload.reason === "completed" ? "authored_merged" : "closed";
      else type = r.type as ActivityEventType;

      let verdict: ActivityVerdict | null = null;
      if (r.type === "reviewed" && typeof payload.verdict === "string" && VERDICTS.has(payload.verdict as ActivityVerdict)) {
        verdict = payload.verdict as ActivityVerdict;
      } else if (r.type === "review_state" && typeof payload.to === "string" && VERDICTS.has(payload.to as ActivityVerdict)) {
        verdict = payload.to as ActivityVerdict;
      }

      const vote = r.type === "vote_changed" && typeof payload.vote === "number" ? payload.vote : null;
      const meta = r.author_meta_json ? (JSON.parse(r.author_meta_json) as AuthorMeta) : null;

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
          teams: r.teams_json ? (JSON.parse(r.teams_json) as string[]) : [],
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
  listRunEvents(runId: number): RunEvent[] {
    const rows = this.#prep(`
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.run_id = ? ORDER BY e.id ASC
    `).all(runId) as unknown as {
      id: number;
      canonical: string;
      ts: string;
      type: string;
      payload: string | null;
      repo: string;
      number: number;
      title: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      canonical: r.canonical,
      ts: r.ts,
      type: r.type as PrEventType,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
      repo: r.repo,
      number: r.number,
      title: r.title,
    }));
  }

  // --- "what's changed" feed (external events the user cares about) ---

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
  static #CHANGE_FILTER = `(
        e.type = 'added'
        OR (e.type = 'commit_pushed' AND p.reviewed_at IS NOT NULL)
        OR e.type = 'fte_woke'
      )`;

  // Unread change events: surfaced changes newer than the caught-up watermark
  // and not individually marked read. This is the notifications bell feed.
  listUnreadChanges(limit = 200): RunEvent[] {
    const baseline = this.getChangesSeenAt();
    const nowTs = now();
    const clause = baseline ? " AND e.ts > ?" : "";
    const params: (string | number)[] = baseline ? [baseline, nowTs, limit] : [nowTs, limit];
    const rows = this.#prep(`
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE ${ArgusStore.#CHANGE_FILTER}${clause}
        AND e.id NOT IN (SELECT event_id FROM changes_read)
        AND p.out_of_scope = 0
        AND COALESCE(p.snooze_mode, '') != 'fte'
        AND (p.snoozed_until IS NULL OR p.snoozed_until <= ?)
      ORDER BY e.ts DESC, e.id DESC LIMIT ?
    `).all(...params) as unknown as {
      id: number;
      canonical: string;
      ts: string;
      type: string;
      payload: string | null;
      repo: string;
      number: number;
      title: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      canonical: r.canonical,
      ts: r.ts,
      type: r.type as PrEventType,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
      repo: r.repo,
      number: r.number,
      title: r.title,
    }));
  }

  // Mark every currently-unread change for one PR as read (used when the user
  // clicks through to re-review that PR).
  markChangesReadForPr(canonical: string): void {
    const ts = now();
    this.#prep(`
      INSERT OR IGNORE INTO changes_read (event_id, read_at)
      SELECT e.id, ? FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.canonical = ? AND ${ArgusStore.#CHANGE_FILTER}
    `).run(ts, canonical);
  }

  // Clear the whole feed by advancing the caught-up watermark to now.
  markAllChangesRead(): void {
    this.setChangesSeenAt();
  }

  // --- reviewed-sha authored dates (for review latency) ---
  // Captured synchronously in recordReview from last_commit_at (see there); no
  // separate resolution step is needed.

  // Migrated PRs whose author the old tracker didn't capture; the poller backfills
  // them from ADO a bounded batch per cycle until none remain.
  prsMissingAuthor(limit = 50): { canonical: string; number: number }[] {
    return this.#prep("SELECT canonical, number FROM prs WHERE author IS NULL LIMIT ?").all(limit) as unknown as {
      canonical: string;
      number: number;
    }[];
  }

  setAuthor(canonical: string, author: string): void {
    this.#prep("UPDATE prs SET author = ? WHERE canonical = ?").run(author, canonical);
  }

  // PRs you've voted on (terminal verdict, not your own) whose "my comment count"
  // hasn't been counted yet — drives the one-time backfill and go-forward counts.
  prsNeedingCommentCount(limit = 25): { canonical: string; number: number; project: string; repo: string }[] {
    return this.#prep(
      `SELECT canonical, number, project, repo FROM prs
       WHERE my_comments IS NULL AND role != 'author'
         AND review_state IN ('approved','suggestions','waiting','rejected')
       LIMIT ?`,
    ).all(limit) as unknown as { canonical: string; number: number; project: string; repo: string }[];
  }

  setMyComments(canonical: string, count: number): void {
    this.#prep("UPDATE prs SET my_comments = ? WHERE canonical = ?").run(count, canonical);
  }

  // --- Deploy tracking (where a merged PR shipped) ---

  // Merge commit + real merge time (ADO closedDate), captured on close so we can
  // pin the exact build and bound the build search to the actual merge moment.
  setMergeInfo(canonical: string, sha: string, mergedAt: string | null): void {
    this.#prep("UPDATE prs SET merge_commit = ?, merged_at = COALESCE(?, merged_at) WHERE canonical = ?").run(sha, mergedAt ?? null, canonical);
  }

  // ISO cutoff for the deploy window: PRs merged on/after this are in scope.
  #deployCutoff(windowDays: number): string {
    return new Date(Date.now() - windowDays * 86_400_000).toISOString();
  }

  // Merged-in-window PRs (configured repos) missing the merge commit or its real
  // merge time. The poller backfills a bounded batch via `az pr show`.
  prsNeedingMergeInfo(windowDays: number, repos: string[], limit = 30): { canonical: string; number: number }[] {
    if (repos.length === 0) return [];
    const ph = repos.map(() => "?").join(",");
    return this.#prep(`
      SELECT p.canonical, p.number
      FROM prs p
      WHERE p.state = 'closed' AND (p.merge_commit IS NULL OR p.merged_at IS NULL) AND p.repo IN (${ph})
        AND EXISTS (
          SELECT 1 FROM pr_events e
          WHERE e.canonical = p.canonical AND e.type = 'closed'
            AND json_extract(e.payload, '$.reason') = 'completed' AND e.ts >= ?
        )
      LIMIT ?
    `).all(...repos, this.#deployCutoff(windowDays), limit) as unknown as { canonical: string; number: number }[];
  }

  // Merged-in-window PRs (configured repos) with a known merge commit whose deploy
  // state is unresolved or not yet terminal (still rolling out) — refreshed by the
  // poller until prod finishes.
  prsNeedingDeploy(windowDays: number, repos: string[], limit = 20): { canonical: string; repo: string; project: string; mergeCommit: string; mergedAt: string }[] {
    if (repos.length === 0) return [];
    const ph = repos.map(() => "?").join(",");
    return this.#prep(`
      SELECT p.canonical, p.repo, p.project, p.merge_commit AS mergeCommit,
             COALESCE(p.merged_at, (SELECT MIN(e.ts) FROM pr_events e
              WHERE e.canonical = p.canonical AND e.type = 'closed'
                AND json_extract(e.payload, '$.reason') = 'completed')) AS mergedAt
      FROM prs p
      WHERE p.merge_commit IS NOT NULL AND p.repo IN (${ph})
        AND (p.deploy_json IS NULL OR json_extract(p.deploy_json, '$.terminal') IS NOT 1)
        AND EXISTS (
          SELECT 1 FROM pr_events e
          WHERE e.canonical = p.canonical AND e.type = 'closed'
            AND json_extract(e.payload, '$.reason') = 'completed' AND e.ts >= ?
        )
      ORDER BY (p.deploy_json IS NULL) DESC, mergedAt DESC
      LIMIT ?
    `).all(...repos, this.#deployCutoff(windowDays), limit) as unknown as { canonical: string; repo: string; project: string; mergeCommit: string; mergedAt: string }[];
  }

  setDeploy(canonical: string, deploy: PrDeploy): void {
    this.#prep("UPDATE prs SET deploy_json = ?, deploy_resolved_at = ? WHERE canonical = ?").run(
      JSON.stringify(deploy),
      now(),
      canonical,
    );
  }

  // The deploy timeline: PRs merged within the window, newest first, each with its
  // resolved deploy state (or an unresolved placeholder if the poller hasn't gotten
  // to it yet). Drives the Deploys view and the detail-page "Shipped" line.
  deployTimeline(windowDays: number, repos: string[]): DeployTimelinePr[] {
    if (repos.length === 0) return [];
    const ph = repos.map(() => "?").join(",");
    const rows = this.#prep(`
      SELECT p.canonical, p.repo, p.number, p.title, p.author AS author, p.role AS role, p.deploy_json AS deployJson,
             COALESCE(p.merged_at, (SELECT MIN(e.ts) FROM pr_events e
              WHERE e.canonical = p.canonical AND e.type = 'closed'
                AND json_extract(e.payload, '$.reason') = 'completed')) AS mergedAt
      FROM prs p
      WHERE p.state = 'closed' AND p.repo IN (${ph})
        AND EXISTS (
          SELECT 1 FROM pr_events e
          WHERE e.canonical = p.canonical AND e.type = 'closed'
            AND json_extract(e.payload, '$.reason') = 'completed' AND e.ts >= ?
        )
      ORDER BY mergedAt DESC
    `).all(...repos, this.#deployCutoff(windowDays)) as unknown as {
      canonical: string; repo: string; number: number; title: string; author: string | null; role: string | null; deployJson: string | null; mergedAt: string;
    }[];
    const pending: PrDeploy = { found: false, reason: null, buildId: null, buildNumber: null, buildUrl: null, dev: null, ppe: null, prod: null, terminal: false };
    return rows.map((r) => ({
      canonical: r.canonical,
      repo: r.repo,
      number: r.number,
      title: r.title,
      author: r.author,
      mine: r.role === "author",
      mergedAt: r.mergedAt,
      deploy: r.deployJson ? (JSON.parse(r.deployJson) as PrDeploy) : pending,
    }));
  }

  getDeploy(canonical: string): PrDeploy | null {
    const row = this.#prep("SELECT deploy_json AS j FROM prs WHERE canonical = ?").get(canonical) as { j: string | null } | undefined;
    return row?.j ? (JSON.parse(row.j) as PrDeploy) : null;
  }

  // --- PR size (files changed) ---

  // Active board PRs whose file count is missing or stale (a new commit landed
  // since it was counted). Bounded per cycle; needs branches for the diff call.
  prsNeedingFileCount(limit = 20): { canonical: string; repo: string; sourceBranch: string; targetBranch: string; sha: string | null }[] {
    return this.#prep(`
      SELECT canonical, repo, source_branch AS sourceBranch, target_branch AS targetBranch, last_commit_sha AS sha
      FROM prs
      WHERE state != 'closed' AND dismissed = 0
        AND source_branch IS NOT NULL AND target_branch IS NOT NULL
        AND (changed_files IS NULL OR changed_files_sha IS NOT last_commit_sha)
      LIMIT ?
    `).all(limit) as unknown as { canonical: string; repo: string; sourceBranch: string; targetBranch: string; sha: string | null }[];
  }

  setChangedFiles(canonical: string, count: number, sha: string | null): void {
    this.#prep("UPDATE prs SET changed_files = ?, changed_files_sha = ? WHERE canonical = ?").run(count, sha, canonical);
  }

  // --- Insights: aggregate analytics computed on demand from events + PRs ---

  // Per-day breakdown for the Load & capacity drill-down: which PRs arrived,
  // which you reviewed, and which were on your plate on a given local day. The
  // bucket logic mirrors computeInsights's daily series (must stay in sync).
  loadDayDetail(
    dayKey: string,
    recencyDays: number,
    work: { endHour: number; days: number[] } = { endHour: 17, days: [1, 2, 3, 4, 5] },
  ): { key: string; arrived: LoadDayPr[]; reviewed: LoadDayPr[]; onPlate: LoadDayPr[] } {
    const nowMs = Date.now();
    const staleMs = recencyDays * 86_400_000;
    const [y, m, d] = dayKey.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = dayStart + 86_400_000;

    const rollToBusinessDay = (ms: number): number => {
      const dt = new Date(ms);
      const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (dt.getHours() >= work.endHour || !work.days.includes(dt.getDay())) day.setDate(day.getDate() + 1);
      let guard = 0;
      while (!work.days.includes(day.getDay()) && guard++ < 8) day.setDate(day.getDate() + 1);
      return day.getTime();
    };
    const VERDICT = new Set(["approved", "suggestions", "waiting", "rejected"]);
    const dayAfter = (ms: number): number => {
      const dt = new Date(ms);
      dt.setHours(0, 0, 0, 0);
      dt.setDate(dt.getDate() + 1);
      return dt.getTime();
    };

    const closedTs = new Map<string, number>();
    for (const r of this.#prep("SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical").all() as unknown as { canonical: string; ts: string }[]) {
      closedTs.set(r.canonical, Date.parse(r.ts));
    }
    const prs = this.#prep(`
      SELECT canonical, repo, number, title, role, is_draft AS isDraft, dismissed, out_of_scope AS outOfScope,
             review_state AS reviewState, added_at AS addedAt, updated_at AS updatedAt, reviewed_at AS reviewedAt
      FROM prs
    `).all() as unknown as {
      canonical: string; repo: string; number: number; title: string; role: string | null; isDraft: number;
      dismissed: number; outOfScope: number; reviewState: string | null; addedAt: string; updatedAt: string; reviewedAt: string | null;
    }[];

    const row = (p: (typeof prs)[number]): LoadDayPr => ({
      canonical: p.canonical,
      repo: p.repo,
      number: p.number,
      title: p.title,
      state: p.reviewState,
      ageDays: Math.max(0, Math.floor((dayEnd - Date.parse(p.addedAt)) / 86_400_000)),
    });

    const arrived: LoadDayPr[] = [];
    const onPlate: LoadDayPr[] = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || p.outOfScope || p.isDraft) continue;
      const start = Date.parse(p.addedAt);
      if (!Number.isFinite(start)) continue;
      const rolled = rollToBusinessDay(start);
      if (rolled >= dayStart && rolled < dayEnd) arrived.push(row(p));
      const ends: number[] = [];
      const cl = closedTs.get(p.canonical);
      if (cl) ends.push(cl);
      if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
      else if (p.reviewState && VERDICT.has(p.reviewState)) ends.push(dayAfter(p.reviewedAt ? Date.parse(p.reviewedAt) : Date.parse(p.updatedAt)));
      ends.push(Date.parse(p.updatedAt) + staleMs);
      const end = ends.length ? Math.min(...ends) : nowMs;
      if (start < dayEnd && end > dayStart) onPlate.push(row(p));
    }

    const reviewed: LoadDayPr[] = [];
    for (const r of this.#prep(`
      SELECT e.canonical, e.ts, p.repo, p.number, p.title, p.review_state AS reviewState, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
        AND e.ts >= ? AND e.ts < ?
    `).all(new Date(dayStart).toISOString(), new Date(dayEnd).toISOString()) as unknown as {
      canonical: string; ts: string; repo: string; number: number; title: string; reviewState: string | null; addedAt: string;
    }[]) {
      reviewed.push({
        canonical: r.canonical,
        repo: r.repo,
        number: r.number,
        title: r.title,
        state: r.reviewState,
        ageDays: Math.max(0, Math.floor((dayEnd - Date.parse(r.addedAt)) / 86_400_000)),
      });
    }

    const byAge = (a: LoadDayPr, b: LoadDayPr) => b.ageDays - a.ageDays;
    return {
      key: dayKey,
      arrived: arrived.sort(byAge),
      reviewed: reviewed.sort(byAge),
      onPlate: onPlate.sort(byAge),
    };
  }

  computeInsights(recencyDays: number, work: { endHour: number; days: number[] } = { endHour: 17, days: [1, 2, 3, 4, 5] }): Insights {
    const nowMs = Date.now();
    const staleMs = recencyDays * 86_400_000;
    const weeks = recentWeeks(8);

    // Roll an arrival timestamp forward to the business day the PR could actually
    // be picked up: after-hours arrivals (>= workEndHour) and non-work-day
    // arrivals move to the next work day's start. So a Friday-evening or weekend
    // PR counts as Monday inflow instead of vanishing from the weekday view.
    const rollToBusinessDay = (ms: number): number => {
      const d = new Date(ms);
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (d.getHours() >= work.endHour || !work.days.includes(d.getDay())) {
        day.setDate(day.getDate() + 1);
      }
      let guard = 0;
      while (!work.days.includes(day.getDay()) && guard++ < 8) day.setDate(day.getDate() + 1);
      return day.getTime();
    };

    // Verdict reviews (one recordReview per completed review), with their PR.
    const reviewed = this.#prep(`
      SELECT e.canonical, e.ts, p.lane, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
      ORDER BY e.ts ASC
    `).all() as unknown as { canonical: string; ts: string; lane: string; addedAt: string }[];


    // Throughput: every verdict-review counts, bucketed by week and lane.
    const tpByWeek = new Map<string, { quick: number; review: number }>();
    for (const r of reviewed) {
      const wk = weekKey(Date.parse(r.ts));
      const cell = tpByWeek.get(wk) ?? tpByWeek.set(wk, { quick: 0, review: 0 }).get(wk)!;
      if (r.lane === "quick") cell.quick++;
      else cell.review++;
    }

    // All PR rows, decoded once, for latency / backlog / distribution / authored.
    const prs = this.#prep(`
      SELECT canonical, repo, number, title, author, role, teams_json AS teamsJson, is_vendor AS isVendor,
             lane, state, is_draft AS isDraft, dismissed, out_of_scope AS outOfScope,
             snoozed_until AS snoozedUntil, snooze_mode AS snoozeMode, review_state AS reviewState,
             added_at AS addedAt, pr_created_at AS prCreatedAt, last_commit_at AS lastCommitAt,
             updated_at AS updatedAt, author_meta_json AS authorMetaJson,
             reviewed_sha AS reviewedSha, reviewed_at AS reviewedAt, reviewed_sha_authored_at AS reviewedShaAuthoredAt,
             my_comments AS myComments
      FROM prs
    `).all() as unknown as {
      canonical: string; repo: string; number: number; title: string; author: string | null; role: string | null;
      teamsJson: string | null; isVendor: number; lane: string; state: string; isDraft: number;
      dismissed: number; outOfScope: number; snoozedUntil: string | null; snoozeMode: string | null;
      reviewState: string | null; addedAt: string; prCreatedAt: string | null; lastCommitAt: string | null;
      updatedAt: string; authorMetaJson: string | null;
      reviewedSha: string | null; reviewedAt: string | null; reviewedShaAuthoredAt: string | null;
      myComments: number | null;
    }[];

    // Latency: authored date of the reviewed sha -> when you recorded the verdict
    // (how long the finished code waited on you). Reviews whose sha date isn't
    // resolved yet count as pending, not zero.
    const latHours: number[] = [];
    const latPoints: { at: string; hours: number; repo: string; number: number; verdict: string | null }[] = [];
    let latPending = 0;
    for (const p of prs) {
      if (!p.reviewedSha || !p.reviewedAt) continue;
      if (!p.reviewedShaAuthoredAt) {
        latPending++;
        continue;
      }
      const h = (Date.parse(p.reviewedAt) - Date.parse(p.reviewedShaAuthoredAt)) / HOUR_MS;
      if (Number.isFinite(h) && h >= 0) {
        latHours.push(h);
        latPoints.push({ at: p.reviewedAt, hours: h, repo: p.repo, number: p.number, verdict: p.reviewState });
      }
    }
    latPoints.sort((a, c) => Date.parse(a.at) - Date.parse(c.at));
    const latBucketDefs: [string, number, number][] = [
      ["< 12h", 0, 12],
      ["12–24h", 12, 24],
      ["1–2d", 24, 48],
      ["2–4d", 48, 96],
      ["> 4d", 96, Infinity],
    ];
    const latDistribution: InsightsCount[] = latBucketDefs.map(([label]) => ({ label, count: 0 }));
    for (const h of latHours) {
      const i = latBucketDefs.findIndex(([, lo, hi]) => h >= lo && h < hi);
      if (i >= 0) latDistribution[i].count++;
    }

    const isSnoozed = (p: { snoozeMode: string | null; snoozedUntil: string | null }): boolean =>
      p.snoozeMode === "fte" || (!!p.snoozedUntil && Date.parse(p.snoozedUntil) > nowMs);

    // Active review queue: PRs I (or my team) review that are still live.
    const activeReview = prs.filter(
      (p) => p.role !== "author" && p.state !== "closed" && !p.dismissed && !p.outOfScope,
    );

    // Distribution across the active queue: where my review load comes from.
    const teamCount = new Map<string, number>();
    const repoCount = new Map<string, number>();
    const authorType = { FTE: 0, Vendor: 0, Automated: 0 };
    for (const p of activeReview) {
      authorType[classifyAuthor(p.author, !!p.isVendor)]++;
      repoCount.set(p.repo, (repoCount.get(p.repo) ?? 0) + 1);
      const teams = p.teamsJson ? (JSON.parse(p.teamsJson) as string[]) : [];
      if (teams.length === 0) teamCount.set("Direct", (teamCount.get("Direct") ?? 0) + 1);
      for (const t of teams) teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
    }
    const topCounts = (m: Map<string, number>): InsightsCount[] =>
      [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, c) => c.count - a.count);

    // Review reach: raw footprint records — PRs (not yours, known author) that
    // entered your review queue, with when/who/vendor/teams. The client windows
    // and aggregates these, so the recency selector switches instantly. Excludes
    // your own PRs by name too (migrated PRs can have a null role).
    const myNames = new Set(prs.filter((p) => p.role === "author" && p.author).map((p) => p.author as string));
    const reachItems = prs
      .filter((p) => p.role !== "author" && !p.dismissed && !!p.author && !myNames.has(p.author))
      .map((p) => ({
        at: p.addedAt,
        author: p.author as string,
        vendor: !!p.isVendor,
        repo: p.repo,
        teams: p.teamsJson ? (JSON.parse(p.teamsJson) as string[]) : [],
      }));

    // Vote pattern: how you land your final verdict, grouped by author type. Only
    // PRs you actually voted on (a terminal review_state), excluding your own.
    const VERDICTS = ["approved", "suggestions", "waiting", "rejected"] as const;
    const voteByType = new Map<string, { approved: number; suggestions: number; waiting: number; rejected: number }>();
    let voteTotal = 0;
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
      const type = classifyAuthor(p.author, !!p.isVendor);
      const cell = voteByType.get(type) ?? voteByType.set(type, { approved: 0, suggestions: 0, waiting: 0, rejected: 0 }).get(type)!;
      cell[v as (typeof VERDICTS)[number]]++;
      voteTotal++;
    }
    const commentCounts: number[] = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
      if (p.myComments != null) commentCounts.push(p.myComments);
    }
    const avgComments = commentCounts.length ? commentCounts.reduce((a, b) => a + b, 0) / commentCounts.length : null;

    // Review depth: what your comment counts reveal beyond the average. One record
    // per voted PR that has a resolved comment count, tagged with author type,
    // repo, and review latency so the client can slice engagement several ways.
    type DepthItem = { comments: number; type: string; repo: string; latencyHours: number | null };
    const depthItems: DepthItem[] = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
      if (p.myComments == null) continue;
      let latencyHours: number | null = null;
      if (p.reviewedAt && p.reviewedShaAuthoredAt) {
        const h = (Date.parse(p.reviewedAt) - Date.parse(p.reviewedShaAuthoredAt)) / HOUR_MS;
        if (Number.isFinite(h) && h >= 0) latencyHours = h;
      }
      depthItems.push({ comments: p.myComments, type: classifyAuthor(p.author, !!p.isVendor), repo: p.repo, latencyHours });
    }
    const depthComments = depthItems.map((d) => d.comments);
    const depthTotal = depthComments.reduce((a, b) => a + b, 0);
    const depthHistDefs: [string, number, number][] = [
      ["0", 0, 1],
      ["1–2", 1, 3],
      ["3–5", 3, 6],
      ["6+", 6, Infinity],
    ];
    const depthHistogram: InsightsCount[] = depthHistDefs.map(([label]) => ({ label, count: 0 }));
    for (const c of depthComments) {
      const i = depthHistDefs.findIndex(([, lo, hi]) => c >= lo && c < hi);
      if (i >= 0) depthHistogram[i].count++;
    }
    const avgBy = (items: DepthItem[]): number | null =>
      items.length ? items.reduce((a, d) => a + d.comments, 0) / items.length : null;
    const depthByType = ["FTE", "Vendor", "Automated"]
      .map((label) => {
        const items = depthItems.filter((d) => d.type === label);
        return { label, avg: avgBy(items), count: items.length, total: items.reduce((a, d) => a + d.comments, 0) };
      })
      .filter((t) => t.count > 0);
    const repoGroups = new Map<string, DepthItem[]>();
    for (const d of depthItems) (repoGroups.get(d.repo) ?? repoGroups.set(d.repo, []).get(d.repo)!).push(d);
    const depthByRepo = [...repoGroups.entries()]
      .map(([label, items]) => ({ label, avg: avgBy(items)!, count: items.length }))
      .sort((a, c) => c.avg - a.avg);
    const depthLatDefs: [string, number, number][] = [
      ["< 1 day", 0, 24],
      ["1–3 days", 24, 72],
      ["> 3 days", 72, Infinity],
    ];
    const depthByLatency = depthLatDefs
      .map(([label, lo, hi]) => {
        const items = depthItems.filter((d) => d.latencyHours != null && d.latencyHours >= lo && d.latencyHours < hi);
        return { label, avg: avgBy(items), count: items.length };
      })
      .filter((b) => b.count > 0);
    const zeroRate = depthComments.length ? depthComments.filter((c) => c === 0).length / depthComments.length : null;

    // Vote journey: each time you RECORDED a verdict on a PR is one "turn" — a
    // real engagement / context switch, even when the verdict repeats (you came
    // back after a re-push and re-reviewed). Recorded verdicts (`reviewed` events)
    // give the multi-turn sequence; no dedup.
    const GATE_VERDICTS = new Set(["waiting", "rejected"]); // blocking
    const seqByCanon = new Map<string, string[]>();
    for (const r of this.#db
      .prepare(
        `SELECT canonical, payload FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY canonical, ts ASC, id ASC`,
      )
      .all() as unknown as { canonical: string; payload: string | null }[]) {
      if (!r.payload) continue;
      const v = (JSON.parse(r.payload) as { verdict?: string }).verdict;
      if (!v) continue;
      (seqByCanon.get(r.canonical) ?? seqByCanon.set(r.canonical, []).get(r.canonical)!).push(v);
    }
    // Universe = the same voted PRs as "How you vote" (a recorded verdict, not
    // your own PR), so the count lines up. PRs you recorded through Argus bring
    // their full sequence; PRs you only voted on in ADO bring a single turn from
    // their current verdict.
    const voteOutcomes = { firstPass: 0, gated: 0, held: 0 };
    const turnMap = new Map<string, number>(); // `${turn}|${verdict}` -> count
    let votePathMeasured = 0;
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
      const recorded = seqByCanon.get(p.canonical);
      const turns = recorded && recorded.length ? recorded : [v];
      votePathMeasured++;
      turns.forEach((verdict, i) => {
        const key = `${i + 1}|${verdict}`;
        turnMap.set(key, (turnMap.get(key) ?? 0) + 1);
      });
      const final = turns[turns.length - 1];
      if (GATE_VERDICTS.has(final)) voteOutcomes.held++;
      else if (turns.some((x) => GATE_VERDICTS.has(x))) voteOutcomes.gated++;
      else voteOutcomes.firstPass++;
    }
    const votePathTurns = [...turnMap.entries()].map(([k, count]) => {
      const [turn, verdict] = k.split("|");
      return { turn: Number(turn), verdict, count };
    });

    // Review origin + team coverage over ALL tracked PRs (all-time, incl. closed
    // — the active queue is inflated by stale PRs). Origin = why a PR is on your
    // plate: directly named ("Individual") vs via a team container. For team PRs,
    // coverage = who satisfies the review — you (you voted, so role became
    // 'reviewer'), a teammate ('covered'), or nobody yet. A PR in two containers
    // counts under each, matching the existing by-team load donut.
    type CovPr = { number: number; repo: string; title: string; coverage: "me" | "teammate" | "needs" };
    type Cov = { total: number; me: number; teammate: number; needs: number; prs: CovPr[] };
    const originCov = new Map<string, Cov>();
    const covRank = { me: 0, teammate: 1, needs: 2 };
    const bumpCov = (key: string, cov: "me" | "teammate" | "needs", pr: { number: number; repo: string; title: string }) => {
      const c = originCov.get(key) ?? originCov.set(key, { total: 0, me: 0, teammate: 0, needs: 0, prs: [] }).get(key)!;
      c.total++;
      c[cov]++;
      c.prs.push({ number: pr.number, repo: pr.repo, title: pr.title, coverage: cov });
    };
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || p.outOfScope) continue;
      // Drop stale open PRs — abandoned reviews that just bloat "still needs".
      if (p.state !== "closed" && nowMs - Date.parse(p.updatedAt) > staleMs) continue;
      const teams = p.teamsJson ? (JSON.parse(p.teamsJson) as string[]) : [];
      if (teams.length === 0) {
        if (p.role === "reviewer") bumpCov("Individual", "me", p);
        continue;
      }
      const cov = p.role === "reviewer" ? "me" : p.reviewState === "covered" ? "teammate" : "needs";
      for (const t of teams) bumpCov(t, cov, p);
    }
    const reviewCoverageOrigins = [...originCov.entries()]
      .map(([team, c]) => ({ ...c, team, prs: [...c.prs].sort((a, b) => covRank[a.coverage] - covRank[b.coverage]) }))
      .sort((a, b) => b.total - a.total);

    // Review rhythm / context-switching: each recorded verdict is a "pickup" — an
    // act of stopping your own work to load someone else's PR. Emitted as a flat,
    // timestamped list (repo + team + title); the client bins into days to show
    // volume, batching (clustered vs scattered), and breadth (distinct contexts).
    const prMeta = new Map<string, { repo: string; team: string | null; title: string; number: number; author: string | null; isVendor: boolean }>();
    for (const p of prs) {
      const t = p.teamsJson ? (JSON.parse(p.teamsJson) as string[])[0] ?? null : null;
      prMeta.set(p.canonical, { repo: p.repo, team: t, title: p.title, number: p.number, author: p.author, isVendor: !!p.isVendor });
    }
    const rhythmItems: { at: string; repo: string; team: string | null; number: number; title: string; verdict: string | null; author: string | null; isVendor: boolean }[] = [];
    for (const r of this.#db
      .prepare(
        `SELECT canonical, ts, json_extract(payload, '$.verdict') AS verdict FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY ts ASC`,
      )
      .all() as unknown as { canonical: string; ts: string; verdict: string | null }[]) {
      const m = prMeta.get(r.canonical);
      if (!m) continue;
      rhythmItems.push({ at: r.ts, repo: m.repo, team: m.team, number: m.number, title: m.title, verdict: r.verdict, author: m.author, isVendor: m.isVendor });
    }


    // "Waiting on you": live PRs awaiting your first vote, measured from the
    // author's last push (when the ball actually landed in your court). Stale /
    // abandoned PRs are excluded — those are the author's move, not your latency.
    const waiting = activeReview.filter(
      (p) =>
        !p.isDraft &&
        !isSnoozed(p) &&
        (p.reviewState === "needs" || p.reviewState === null) &&
        nowMs - Date.parse(p.updatedAt) <= staleMs,
    );
    const bucketDefs: [string, number, number][] = [
      ["< 1 day", 0, 24],
      ["1–3 days", 24, 72],
      ["3–7 days", 72, 168],
      ["> 7 days", 168, Infinity],
    ];
    const buckets: InsightsCount[] = bucketDefs.map(([label]) => ({ label, count: 0 }));
    const aged = waiting.map((p) => ({
      p,
      waitingHours: (nowMs - Date.parse(p.lastCommitAt ?? p.addedAt)) / HOUR_MS,
    }));
    for (const { waitingHours } of aged) {
      const i = bucketDefs.findIndex(([, lo, hi]) => waitingHours >= lo && waitingHours < hi);
      if (i >= 0) buckets[i].count++;
    }
    const longest: InsightsWaiting[] = [...aged]
      .sort((a, c) => c.waitingHours - a.waitingHours)
      .slice(0, 5)
      .map(({ p, waitingHours }) => ({ canonical: p.canonical, repo: p.repo, number: p.number, title: p.title, waitingHours }));

    // Authored side.
    const closedTs = new Map<string, string>();
    for (const r of this.#prep(
      "SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical",
    ).all() as unknown as { canonical: string; ts: string }[]) {
      closedTs.set(r.canonical, r.ts);
    }
    const authored = prs.filter((p) => p.role === "author");
    const openAuthored = authored.filter((p) => p.state !== "closed");
    const parseMeta = (j: string | null): AuthorMeta | null => (j ? (JSON.parse(j) as AuthorMeta) : null);
    let completable = 0;
    let blocked = 0;
    const openList: Insights["authored"]["openList"] = [];
    for (const p of openAuthored) {
      const m = parseMeta(p.authorMetaJson);
      if (m?.completable) completable++;
      else if (m && m.blockers.length > 0) blocked++;
      openList.push({
        canonical: p.canonical,
        repo: p.repo,
        number: p.number,
        title: p.title,
        activeComments: m?.activeComments ?? 0,
        blockers: m?.blockers ?? [],
        completable: m?.completable ?? false,
      });
    }
    openList.sort((a, c) => c.activeComments - a.activeComments || c.blockers.length - a.blockers.length);
    const mergeHours: number[] = [];
    for (const p of authored) {
      if (p.state !== "closed" || !p.prCreatedAt) continue;
      const end = closedTs.get(p.canonical);
      if (!end) continue;
      const h = (Date.parse(end) - Date.parse(p.prCreatedAt)) / HOUR_MS;
      if (Number.isFinite(h) && h >= 0) mergeHours.push(h);
    }

    // --- Load & capacity ---
    // "On your plate" = PRs you're on the hook for. A PR lands when it enters your
    // queue (added_at) and stays on your plate until it leaves your court:
    //   - it closes (merges / abandoned), OR
    //   - a teammate covers the team's review (you never had to), OR
    //   - you cast a verdict — it counts through that day, then leaves the next
    //     day (the ball is now in the author's court), OR
    //   - it goes stale (idle past the recency window).
    // Snoozing does NOT take it off your plate (deferred, still yours). Excluded
    // entirely: your own PRs, dismissed, out-of-scope, and drafts (not ready).
    const intervals: { start: number; end: number }[] = [];
    const inflowMs: number[] = [];
    const VERDICT_STATES = new Set(["approved", "suggestions", "waiting", "rejected"]);
    // Midnight starting the day AFTER `ms` (local) — a verdicted PR counts through
    // the day you acted, then leaves your plate the next day.
    const dayAfter = (ms: number): number => {
      const d = new Date(ms);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      return d.getTime();
    };
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || p.outOfScope || p.isDraft) continue;
      const start = Date.parse(p.addedAt);
      if (!Number.isFinite(start)) continue;
      inflowMs.push(start);
      const ends: number[] = [];
      const cl = closedTs.get(p.canonical);
      if (cl) ends.push(Date.parse(cl));
      // A teammate covered the team's review — off your plate from when it settled.
      if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
      // You cast a verdict (approved/suggestions/waiting/rejected): it was on your
      // plate through that day, then leaves the next day — the ball is now in the
      // author's court. Verdict day = when you recorded it, else when it settled.
      else if (p.reviewState && VERDICT_STATES.has(p.reviewState)) {
        ends.push(dayAfter(p.reviewedAt ? Date.parse(p.reviewedAt) : Date.parse(p.updatedAt)));
      }
      // Stale: idle past the recency window, no longer live load.
      const staleCut = Date.parse(p.updatedAt) + staleMs;
      if (Number.isFinite(staleCut)) ends.push(staleCut);
      const end = ends.length ? Math.min(...ends) : nowMs;
      if (end > start) intervals.push({ start, end });
    }
    const throughputMs = reviewed.map((r) => Date.parse(r.ts));

    const DAY_MS = 86_400_000;
    const WINDOW_DAYS = 84; // 12 weeks, enough to derive both series
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const firstDayStart = todayStart.getTime() - (WINDOW_DAYS - 1) * DAY_MS;
    const dayBuckets = Array.from({ length: WINDOW_DAYS }, (_, i) => {
      const dayStart = firstDayStart + i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      let level = 0;
      for (const iv of intervals) if (iv.start < dayEnd && iv.end > dayStart) level++;
      return { dayStart, level, inflow: 0, throughput: 0 };
    });
    const dayIndex = (ms: number): number => Math.floor((ms - firstDayStart) / DAY_MS);
    // Raw inflow per day (used by the weekly view, which sums whole weeks — a
    // Friday-evening PR belongs to its own week there, so it must NOT roll).
    for (const ms of inflowMs) {
      const i = dayIndex(ms);
      if (i >= 0 && i < WINDOW_DAYS) dayBuckets[i].inflow++;
    }
    // Business-day-rolled inflow, used only by the daily view: after-hours /
    // weekend arrivals move to the next work day so they land on (e.g.) Monday
    // instead of vanishing from the weekday-only day chart.
    const rolledInflow = new Array<number>(WINDOW_DAYS).fill(0);
    for (const ms of inflowMs) {
      const i = dayIndex(rollToBusinessDay(ms));
      if (i >= 0 && i < WINDOW_DAYS) rolledInflow[i]++;
    }
    for (const ms of throughputMs) {
      const i = dayIndex(ms);
      if (i >= 0 && i < WINDOW_DAYS) dayBuckets[i].throughput++;
    }
    const daily: InsightsLoadBucket[] = dayBuckets
      .slice(-14)
      .filter((d) => {
        const wd = new Date(d.dayStart).getDay();
        return wd !== 0 && wd !== 6; // drop Sunday / Saturday
      })
      .map((d) => ({
        key: new Date(d.dayStart).toISOString().slice(0, 10),
        inflow: rolledInflow[dayIndex(d.dayStart)],
        throughput: d.throughput,
        backlog: d.level,
      }));
    const loadWeeks = recentWeeks(12);
    const weeklyLoad = new Map<string, { inflow: number; throughput: number; peak: number }>();
    for (const d of dayBuckets) {
      const wk = weekKey(d.dayStart);
      const cell = weeklyLoad.get(wk) ?? weeklyLoad.set(wk, { inflow: 0, throughput: 0, peak: 0 }).get(wk)!;
      cell.inflow += d.inflow;
      cell.throughput += d.throughput;
      cell.peak = Math.max(cell.peak, d.level);
    }
    const loadWeekly: InsightsLoadBucket[] = loadWeeks.map((week) => {
      const cell = weeklyLoad.get(week) ?? { inflow: 0, throughput: 0, peak: 0 };
      return { key: week, inflow: cell.inflow, throughput: cell.throughput, backlog: cell.peak };
    });
    const peakDay = dayBuckets.reduce((best, d) => (d.level > best.level ? d : best), { dayStart: 0, level: 0, inflow: 0, throughput: 0 });

    // Balance / sustainability series, derived from the daily load series
    // (weekdays only — weekends aren't work days). Per day: inflow, throughput,
    // and concurrent load (level). The client windows this and derives streaks
    // ("falling behind" = inflow > throughput; "overload" = level >= heavy line)
    // so the stats always match the visible range. Heavy line = p75 of level.
    const balanceDays = dayBuckets.filter((d) => {
      const wd = new Date(d.dayStart).getDay();
      return wd !== 0 && wd !== 6;
    });
    const sortedLevels = balanceDays.map((d) => d.level).sort((a, b) => a - b);
    const heavyLine = sortedLevels.length ? Math.max(1, sortedLevels[Math.floor(sortedLevels.length * 0.75)]) : 1;
    const balanceSeries = balanceDays.map((d) => ({
      key: new Date(d.dayStart).toISOString().slice(0, 10),
      inflow: d.inflow,
      throughput: d.throughput,
      level: d.level,
    }));

    const trackingSince = (this.#db.prepare("SELECT MIN(ts) AS t FROM pr_events").get() as { t?: string } | undefined)?.t ?? null;

    return {
      generatedAt: now(),
      summary: {
        reviewsAllTime: rhythmItems.length,
        firstReviewAt: rhythmItems.length ? rhythmItems[0].at : null,
        lastReviewAt: rhythmItems.length ? rhythmItems[rhythmItems.length - 1].at : null,
        trackingSince,
      },
      latency: {
        count: latHours.length,
        pending: latPending,
        medianHours: median(latHours),
        p90Hours: percentile(latHours, 90),
        fastestHours: latHours.length ? Math.min(...latHours) : null,
        slowestHours: latHours.length ? Math.max(...latHours) : null,
        points: latPoints,
        distribution: latDistribution,
      },
      throughput: {
        total: reviewed.length,
        weekly: weeks.map((week) => {
          const cell = tpByWeek.get(week) ?? { quick: 0, review: 0 };
          return { week, quick: cell.quick, review: cell.review, total: cell.quick + cell.review };
        }),
      },
      load: {
        daily,
        weekly: loadWeekly,
        peak: { count: peakDay.level, at: peakDay.level > 0 ? new Date(peakDay.dayStart).toISOString().slice(0, 10) : null },
      },
      backlog: {
        waitingCount: waiting.length,
        longestHours: aged.length ? Math.max(...aged.map((a) => a.waitingHours)) : null,
        buckets,
        longest,
      },
      distribution: {
        byTeam: topCounts(teamCount),
        byRepo: topCounts(repoCount),
        byAuthorType: (["FTE", "Vendor", "Automated"] as const)
          .map((label) => ({ label, count: authorType[label] }))
          .filter((x) => x.count > 0),
      },
      reach: {
        items: reachItems,
      },
      votePattern: {
        byType: (["FTE", "Vendor", "Automated"] as const)
          .filter((t) => voteByType.has(t))
          .map((t) => ({ label: t, ...voteByType.get(t)! })),
        total: voteTotal,
        avgComments,
        commentsMeasured: commentCounts.length,
      },
      reviewDepth: {
        measured: depthComments.length,
        totalComments: depthTotal,
        avg: avgComments,
        median: median(depthComments),
        p90: percentile(depthComments, 90),
        zeroRate,
        histogram: depthHistogram,
        byType: depthByType,
        byRepo: depthByRepo,
        byLatency: depthByLatency,
      },
      votePath: {
        measured: votePathMeasured,
        outcomes: voteOutcomes,
        turns: votePathTurns,
      },
      reviewCoverage: {
        origins: reviewCoverageOrigins,
      },
      reviewRhythm: {
        items: rhythmItems,
      },
      balance: {
        days: balanceSeries,
        heavyLine,
      },
      authored: {
        open: openAuthored.length,
        completable,
        blocked,
        mergedCount: mergeHours.length,
        medianMergeHours: median(mergeHours),
        openList,
      },
    };
  }

  getChangesSeenAt(): string | null {
    return this.#getSetting("changes_seen_at");
  }

  setChangesSeenAt(ts: string = now()): void {
    this.#setSetting("changes_seen_at", ts);
  }

  // Prior state of every tracked PR, keyed by canonical, for the reconciler to
  // diff against. Reviewer votes come from the snapshot column.
  listSnapshots(): Map<string, Snapshot> {
    const rows = this.#prep(
      "SELECT canonical, last_commit_sha, is_draft, state, dismissed, reviewers_json FROM prs",
    ).all() as unknown as {
      canonical: string;
      last_commit_sha: string | null;
      is_draft: number;
      state: string;
      dismissed: number;
      reviewers_json: string | null;
    }[];
    const map = new Map<string, Snapshot>();
    for (const r of rows) {
      map.set(r.canonical, {
        sha: r.last_commit_sha,
        isDraft: !!r.is_draft,
        state: r.state as PrState,
        dismissed: !!r.dismissed,
        votes: r.reviewers_json ? (JSON.parse(r.reviewers_json) as Record<string, number>) : {},
      });
    }
    return map;
  }

  // Apply a reconcile plan atomically: events, metadata, and the vote snapshot
  // for every PR commit together, so a crash can't half-write a change.
  applyPlan(plan: Plan, runId?: number): { added: number; updated: number; events: number } {
    let added = 0;
    let updated = 0;
    let events = 0;
    this.#db.exec("BEGIN");
    try {
      for (const item of plan.items) {
        for (const ev of item.events) {
          this.appendEvent(ev.canonical, ev.type, ev.payload, ev.ts, runId);
          events += 1;
        }
        this.upsertPr(item.upsert);
        this.#setReviewers(item.upsert.canonical, item.votes);
        if (item.isAdd) added += 1;
        else updated += 1;
      }
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
    return { added, updated, events };
  }

  // Terminal transition detected out of band (PR left the active list).
  markClosed(canonical: string, reason: string, ts: string = now(), runId?: number): void {
    this.appendEvent(canonical, "closed", { reason }, ts, runId);
    this.#prep("UPDATE prs SET state = 'closed', updated_at = ? WHERE canonical = ?").run(ts, canonical);
  }

  #setReviewers(canonical: string, votes: Record<string, number>): void {
    this.#prep("UPDATE prs SET reviewers_json = ? WHERE canonical = ?").run(JSON.stringify(votes), canonical);
  }

  // Role/teams/reviewState (and the description preview) are cheap metadata that
  // can change without a signature change (a team added, a teammate voting, an
  // edited description), so the poller refreshes them for every mine PR each
  // cycle. No-op for canonicals not yet tracked.
  setOwnership(
    canonical: string,
    role: PrRole,
    teams: string[],
    reviewState: PrReviewState | null,
    description: string,
    isVendor: boolean,
    otherVotes: { name: string; vote: number }[],
  ): void {
    const prev = this.#prep("SELECT review_state AS s, description AS d FROM prs WHERE canonical = ?").get(canonical) as
      | { s: string | null; d: string | null }
      | undefined;
    // Don't let a truncated bulk-list description overwrite a longer stored one.
    const keepDesc = prev?.d && description.length < prev.d.length ? prev.d : description;
    this.#prep(
      "UPDATE prs SET role = ?, teams_json = ?, review_state = ?, description = ?, is_vendor = ?, approvals_json = ? WHERE canonical = ?",
    ).run(role, JSON.stringify(teams), reviewState, keepDesc, isVendor ? 1 : 0, JSON.stringify(otherVotes), canonical);
    // Record a timeline entry whenever my standing changes (e.g. needs → covered).
    if (prev && prev.s !== reviewState) {
      this.appendEvent(canonical, "review_state", { from: prev.s, to: reviewState });
    }
    // Wake an "until FTE approves" snooze once a teammate/FTE has approved, and
    // emit a distinct signal (with the approver's name) so the bell can surface
    // "an FTE cleared this for you" unambiguously — separate from a manual clear.
    // The snooze means "hide until someone on my team has vetted this," so a
    // non-vendor (FTE) approving vote wakes it directly — NOT only the stricter
    // team "covered" state, which never applies when ADO lists me as an
    // individual reviewer (role=reviewer) so my own reviewState stays "needs".
    const row = this.#prep("SELECT snooze_mode AS m FROM prs WHERE canonical = ?").get(canonical) as
      | { m: string | null }
      | undefined;
    if (row?.m === "fte") {
      // Attribute the wake to a non-vendor (FTE) approver — a vendor approval
      // doesn't cover the team's review, so it never wakes an fte-snooze.
      const by = otherVotes.find((v) => v.vote >= 5 && !isVendorName(v.name))?.name ?? null;
      if (by || reviewState === "covered" || reviewState === "approved") {
        this.appendEvent(canonical, "fte_woke", { by });
        this.setSnooze(canonical, null, null);
      }
    }
  }

  // Mark a PR out of scope (I don't need to review it) or restore it. Parks the
  // PR in its own section rather than deleting it; fully reversible.
  setOutOfScope(canonical: string, value: boolean): void {
    this.#prep("UPDATE prs SET out_of_scope = ? WHERE canonical = ?").run(value ? 1 : 0, canonical);
    this.appendEvent(canonical, value ? "out_of_scope" : "in_scope");
  }

  // Move a PR between the quick and full-review lanes (manual triage).
  setLane(canonical: string, lane: Lane): void {
    this.#prep("UPDATE prs SET lane = ? WHERE canonical = ?").run(lane, canonical);
    this.appendEvent(canonical, "lane_changed", { lane });
  }

  // Authoritative description write (from `az pr show`, which returns full text,
  // unlike the bulk list). Bypasses the anti-truncation guard used elsewhere.
  setDescription(canonical: string, description: string): void {
    this.#prep("UPDATE prs SET description = ? WHERE canonical = ?").run(description, canonical);
  }

  // Link the child session that reviewed this PR, so a later re-review can target
  // it. Cleared by passing null.
  setReviewSession(canonical: string, sessionId: string | null): void {
    this.#prep("UPDATE prs SET review_session_id = ? WHERE canonical = ?").run(sessionId, canonical);
    this.appendEvent(canonical, "reviewed", sessionId ? { sessionId } : { cleared: true });
  }

  // Fully untrack a PR: delete its row and event history. Used to undo an
  // erroneous add / let the user drop a PR that shouldn't be on the board. Unlike
  // dismiss (which keeps a tombstone so it never resurrects), remove is a clean
  // delete — auto-discovery may re-add it later if it genuinely qualifies.
  removePr(canonical: string): void {
    this.#prep("DELETE FROM pr_events WHERE canonical = ?").run(canonical);
    this.#prep("DELETE FROM prs WHERE canonical = ?").run(canonical);
  }

  // Explicitly record a review outcome: the verdict, the commit reviewed (for
  // re-push detection), and optionally the session that did it. The verdict is
  // reflected into review_state immediately so the board collapses without
  // waiting for the next ADO poll (which then reconciles the same value).
  recordReview(canonical: string, opts: { verdict?: string; sha?: string; sessionId?: string }): void {
    if (opts.sessionId) this.#prep("UPDATE prs SET review_session_id = ? WHERE canonical = ?").run(opts.sessionId, canonical);
    if (opts.sha) {
      this.#prep("UPDATE prs SET reviewed_sha = ? WHERE canonical = ?").run(opts.sha, canonical);
      // The reviewed sha is normally the head we last saw, so its authored date is
      // last_commit_at (from the az PR list) — capture it now, no REST needed. If a
      // re-push means the sha differs, leave it null (a later poll can't recover it).
      this.#prep(`
        UPDATE prs
        SET reviewed_sha_authored_at = CASE WHEN reviewed_sha = last_commit_sha THEN last_commit_at ELSE NULL END
        WHERE canonical = ?
      `).run(canonical);
    }
    const VERDICT_STATES = new Set(["approved", "suggestions", "waiting", "rejected"]);
    if (opts.verdict && VERDICT_STATES.has(opts.verdict)) {
      this.#prep("UPDATE prs SET reviewed_at = ? WHERE canonical = ?").run(now(), canonical);
      // Mark my comment count stale so the poller recounts once (comments are
      // effectively final at verdict time; a re-review re-triggers the count).
      this.#prep("UPDATE prs SET my_comments = NULL WHERE canonical = ?").run(canonical);
      const prev = this.#prep("SELECT review_state AS s FROM prs WHERE canonical = ?").get(canonical) as
        | { s: string | null }
        | undefined;
      this.#prep("UPDATE prs SET review_state = ? WHERE canonical = ?").run(opts.verdict, canonical);
      if (prev && prev.s !== opts.verdict) {
        this.appendEvent(canonical, "review_state", { from: prev.s, to: opts.verdict });
      }
    }
    this.appendEvent(canonical, "reviewed", {
      verdict: opts.verdict ?? null,
      sha: opts.sha ?? null,
      sessionId: opts.sessionId ?? null,
    });
  }

  // Hide a PR: `until` (ISO) for a timed snooze, or mode "fte" to hide until a
  // teammate/FTE approves (the poller wakes it in setOwnership). null clears it.
  setSnooze(canonical: string, until: string | null, mode: "time" | "fte" | null = until ? "time" : null): void {
    this.#prep("UPDATE prs SET snoozed_until = ?, snooze_mode = ? WHERE canonical = ?").run(until, mode, canonical);
    this.appendEvent(canonical, "snoozed", mode ? { until, mode } : { cleared: true });
  }

  // Store completability + comment counts for one of my authored PRs.
  setAuthorMeta(canonical: string, meta: AuthorMeta): void {
    this.#prep("UPDATE prs SET author_meta_json = ? WHERE canonical = ?").run(JSON.stringify(meta), canonical);
  }

  // Closed/merged PRs whose linked review sessions can be archived. Written by the
  // poller, read + cleared by the user-initiated archive action (which has the
  // session context the background poll lacks).
  // Sessions ready to archive — computed directly: a closed PR (merged or
  // abandoned) that still has a linked review session, OR an open PR that has
  // gone stale (no activity past the recency window) with a linked session. Both
  // are deterministic, so they don't depend on the poller catching a transition.
  // Archiving clears the session link (see markReviewSessionsArchived), so items
  // drop off — a stale PR that later wakes up gets a fresh review session, it is
  // not re-flagged here. `status` distinguishes the reason ('completed'/reason
  // vs 'stale') so the archive prompt reads correctly.
  getArchivable(recencyDays: number): ArchivableSession[] {
    const staleMs = recencyDays * 86_400_000;
    const now = Date.now();
    const rows = this.#prep(`
      SELECT p.repo AS repo, p.number AS number, p.review_session_id AS sessionId,
        p.state AS state, p.updated_at AS updatedAt,
        (SELECT json_extract(e.payload, '$.reason') FROM pr_events e
         WHERE e.canonical = p.canonical AND e.type = 'closed'
         ORDER BY e.ts DESC LIMIT 1) AS closeReason
      FROM prs p
      WHERE p.review_session_id IS NOT NULL AND p.dismissed = 0
      ORDER BY p.updated_at DESC
    `).all() as unknown as { repo: string; number: number; sessionId: string; state: string; updatedAt: string; closeReason: string | null }[];
    // Staleness is decided in JS with Date.parse (updated_at is stored in a
    // locale format that is not lexicographically sortable), matching the rest
    // of the store. Closed PRs are always archivable; open PRs only once idle
    // past the recency window.
    return rows
      .filter((r) => r.state === "closed" || now - Date.parse(r.updatedAt) > staleMs)
      .map((r) => ({
        repo: r.repo,
        number: r.number,
        sessionId: r.sessionId,
        status: r.state === "closed" ? (r.closeReason ?? "completed") : "stale",
      }));
  }

  // Drop the review-session link on PRs whose sessions were just archived, so
  // they leave the archivable list. Keyed by sessionId (what the banner acts on).
  markReviewSessionsArchived(sessionIds: string[]): void {
    if (sessionIds.length === 0) return;
    const placeholders = sessionIds.map(() => "?").join(",");
    this.#prep(`UPDATE prs SET review_session_id = NULL WHERE review_session_id IN (${placeholders})`).run(...sessionIds);
  }

  // --- operational logging (pruned by age) ---

  startPollRun(startedAt: string = now()): number {
    const info = this.#prep("INSERT INTO poll_runs (started_at) VALUES (?)").run(startedAt);
    return Number(info.lastInsertRowid);
  }

  finishPollRun(runId: number, result: PollRunResult, finishedAt: string = now()): void {
    this.#prep(`
      UPDATE poll_runs SET finished_at = ?, ok = ?, mine = ?, tracked = ?, added = ?, updated = ?,
                           events = ?, closed = ?, error = ?
      WHERE id = ?
    `).run(
      finishedAt,
      result.ok ? 1 : 0,
      result.mine ?? null,
      result.tracked ?? null,
      result.added ?? null,
      result.updated ?? null,
      result.events ?? null,
      result.closed ?? null,
      result.error ?? null,
      runId,
    );
  }

  // Size of the active queue (what the Board shows): not closed, not dismissed.
  countTracked(): number {
    const r = this.#prep("SELECT COUNT(*) AS n FROM prs WHERE state != 'closed' AND dismissed = 0").get() as {
      n: number;
    };
    return r.n;
  }

  // Append one trace line and mirror it to the extension log.
  recordActivity(
    level: string,
    msg: string,
    data?: Record<string, unknown>,
    runId?: number,
  ): void {
    this.#prep(
      "INSERT INTO activity_log (ts, level, msg, data, run_id) VALUES (?, ?, ?, ?, ?)",
    ).run(now(), level, msg, data ? JSON.stringify(data) : null, runId ?? null);
    log(data ? `${msg} ${JSON.stringify(data)}` : msg, level === "info" ? undefined : level);
  }

  listActivity(limit = 100): ActivityEntry[] {
    const rows = this.#prep(
      "SELECT * FROM (SELECT * FROM activity_log ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
    ).all(limit) as unknown as ActivityRow[];
    return rows.map(rowToActivity);
  }

  // Trace lines for one run, in order, for the run-detail view.
  listActivityForRun(runId: number): ActivityEntry[] {
    const rows = this.#prep(
      "SELECT * FROM activity_log WHERE run_id = ? ORDER BY id ASC",
    ).all(runId) as unknown as ActivityRow[];
    return rows.map(rowToActivity);
  }

  listPollRuns(limit = 50): PollRun[] {
    const rows = this.#prep("SELECT * FROM poll_runs ORDER BY id DESC LIMIT ?").all(limit) as unknown as PollRunRow[];
    return rows.map(rowToRun);
  }

  getRun(id: number): PollRun | null {
    const row = this.#prep("SELECT * FROM poll_runs WHERE id = ?").get(id) as PollRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  // Drop operational logs older than the retention window. Cheap; run per cycle.
  pruneLogs(retentionDays: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    this.#prep("DELETE FROM activity_log WHERE ts < ?").run(cutoff);
    this.#prep("DELETE FROM poll_runs WHERE started_at < ?").run(cutoff);
  }

  // User config overrides (set from the Settings screen), merged onto defaults.
  getConfigOverrides(): ConfigOverrides {
    const row = this.#prep("SELECT value FROM settings WHERE key = 'config'").get() as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as ConfigOverrides) : {};
  }

  saveConfigOverrides(overrides: ConfigOverrides): void {
    this.#prep(
      "INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(overrides));
  }

  // First-run gate: true once the user has confirmed org/project/team setup.
  // Until then the UI shows the setup screen instead of an empty, mis-configured
  // board (the shipped defaults are one team's, so ownership is wrong otherwise).
  isSetupComplete(): boolean {
    return this.#getSetting("setup_complete") === "1";
  }

  markSetupComplete(): void {
    this.#setSetting("setup_complete", "1");
  }

  #getSetting(key: string): string | null {
    const row = this.#prep("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  #setSetting(key: string, value: string): void {
    this.#prep(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  // Team (container reviewer) names seen during discovery, for the Settings picker.
  getSeenTeams(): string[] {
    const v = this.#getSetting("seen_teams");
    return v ? (JSON.parse(v) as string[]) : [];
  }

  addSeenTeams(names: string[]): void {
    const merged = [...new Set([...this.getSeenTeams(), ...names])].sort();
    this.#setSetting("seen_teams", JSON.stringify(merged));
  }

  // One-time, guarded import of the old pr-tracker state file so we have real
  // (mostly stale) PRs to work with. INSERT OR IGNORE won't clobber live rows;
  // updated_at is set to the old last-refreshed time so they read as stale.
  importLegacyState(file: string, teamPatterns: string[]): { imported: number } {
    if (this.#getSetting("legacy_imported")) return { imported: 0 };
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      return { imported: 0 };
    }
    const parsed = JSON.parse(text) as { prs?: Record<string, LegacyPr> };
    const prs = parsed.prs ? Object.values(parsed.prs) : [];

    let imported = 0;
    this.#db.exec("BEGIN");
    try {
      for (const p of prs) {
        if (!p.url) continue;
        const teams = (p.reviewers ?? [])
          .filter((r) => r.is_container && r.display_name && teamPatterns.some((pat) => globMatch(pat, r.display_name!)))
          .map((r) => r.display_name!);
        const votes = Object.fromEntries((p.reviewers ?? []).filter((r) => r.id).map((r) => [r.id, r.vote_code ?? 0]));
        const ts = p.last_refreshed_at || p.added_at || now();
        const info = this.#prep(`
          INSERT OR IGNORE INTO prs (canonical, org, project, repo, number, title, author, is_vendor,
                                     role, teams_json, is_draft, lane, state, last_commit_sha, last_commit_at,
                                     pr_created_at, added_at, updated_at, reviewers_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          p.url,
          p.org ?? "",
          p.project ?? "",
          p.repo ?? "",
          p.pr_number ?? 0,
          p.title ?? "",
          p.author_display_name ?? null,
          p.is_vendor ? 1 : 0,
          teams.length ? "team" : "reviewer",
          JSON.stringify(teams),
          p.is_draft ? 1 : 0,
          p.lane === "quick" ? "quick" : "review",
          p.state === "reviewed" ? "reviewed" : "pending",
          p.last_commit_sha ?? null,
          p.last_commit_at ?? null,
          p.pr_created_at ?? null,
          p.added_at ?? ts,
          ts,
          JSON.stringify(votes),
        );
        if (info.changes) imported += 1;
      }
      this.#setSetting("legacy_imported", now());
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
    return { imported };
  }

  counts(): { prs: number; events: number } {
    const prs = this.#prep("SELECT COUNT(*) AS n FROM prs").get() as { n: number };
    const events = this.#prep("SELECT COUNT(*) AS n FROM pr_events").get() as { n: number };
    return { prs: prs.n, events: events.n };
  }

  // Read-only import of the legacy pr-tracker involvement archive so Insights
  // has real history. Idempotent: safe to re-run to pick up new departures as
  // pr-tracker keeps appending. Reconstructs a timeline per record; never writes
  // back to the archive.
  importInvolvement(file: string): { imported: number } {
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      return { imported: 0 }; // archive absent; nothing to migrate
    }

    let imported = 0;
    this.#db.exec("BEGIN");
    try {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const rec = JSON.parse(trimmed) as InvolvementRecord;
        if (!rec.url || this.#recordImported(rec)) continue;
        this.#importRecord(rec);
        imported += 1;
      }
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
    return { imported };
  }

  #importRecord(rec: InvolvementRecord): void {
    const parsed = parseAdoPrUrl(rec.url!);
    const added = rec.added_at || rec.archived_at || now();

    // Historical PRs are terminal; store a closed snapshot so joins/counts work.
    this.#prep(`
      INSERT OR IGNORE INTO prs (canonical, org, project, repo, number, title,
                                 author, is_vendor, lane, state, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)
    `).run(
      rec.url!,
      parsed?.org ?? "",
      parsed?.project ?? "",
      rec.repo ?? parsed?.repo ?? "",
      rec.pr_number ?? parsed?.number ?? 0,
      rec.title ?? "",
      rec.author_display_name ?? null,
      b(!!rec.is_vendor || !!rec.is_agency),
      rec.lane === "quick" ? "quick" : "review",
      added,
      rec.archived_at ?? added,
    );

    if (rec.added_at) this.appendEvent(rec.url!, "added", { source: "migration" }, rec.added_at);
    for (const rv of rec.reviews ?? []) {
      this.appendEvent(
        rec.url!,
        "reviewed",
        { source: "migration", mode: rv.mode, vote: rv.vote, comments_posted: rv.comments_posted },
        rv.reviewed_at || added,
      );
    }
    const terminal: PrEventType = rec.reason === "removed" ? "removed" : "closed";
    this.appendEvent(rec.url!, terminal, { source: "migration", reason: rec.reason }, rec.archived_at || added);
  }

  // A record is already imported if its terminal event exists. Dedups by the
  // PR's departure timestamp, so re-running only adds new departures — and it's
  // idempotent against data already in the DB, no separate bookkeeping.
  #recordImported(rec: InvolvementRecord): boolean {
    const terminalTs = rec.archived_at || rec.added_at;
    if (!terminalTs) return false; // no stable timestamp; let it import
    const type = rec.reason === "removed" ? "removed" : "closed";
    return !!this.#prep(
      "SELECT 1 FROM pr_events WHERE canonical = ? AND ts = ? AND type = ? LIMIT 1",
    ).get(rec.url!, terminalTs, type);
  }

  close(): void {
    this.#db.close();
  }
}

// Shape of one line in the legacy pr-involvement.jsonl archive.
interface InvolvementRecord {
  url?: string;
  repo?: string;
  pr_number?: number;
  title?: string;
  author_display_name?: string | null;
  is_vendor?: boolean;
  is_agency?: boolean;
  lane?: string | null;
  added_at?: string | null;
  archived_at?: string;
  reason?: string;
  reviews?: { mode?: string; reviewed_at?: string; vote?: unknown; comments_posted?: unknown }[];
}

// Best-effort parse of dev.azure.com and *.visualstudio.com PR URLs.
function parseAdoPrUrl(
  url: string,
): { org: string; project: string; repo: string; number: number } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const gitIdx = parts.indexOf("_git");
    const prIdx = parts.indexOf("pullrequest");
    if (gitIdx === -1 || prIdx === -1) return null;
    const org = u.hostname.endsWith("visualstudio.com")
      ? u.hostname.split(".")[0]
      : parts[0];
    const project = u.hostname.endsWith("visualstudio.com")
      ? parts[0]
      : parts[1];
    return {
      org: org ?? "",
      project: project ?? "",
      repo: parts[gitIdx + 1] ?? "",
      number: Number(parts[prIdx + 1]) || 0,
    };
  } catch {
    return null;
  }
}
