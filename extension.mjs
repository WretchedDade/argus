// server/extension.ts
import path3 from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

// server/db.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// server/ado/normalize.ts
function isVendorName(name) {
  return /\(.+\)/.test(name || "");
}
function normalizePr(raw, org, project, ownership) {
  const repo = raw.repository?.name ?? "";
  const author = raw.createdBy?.displayName ?? null;
  return {
    canonical: `https://worldwidelearning.visualstudio.com/${project}/_git/${repo}/pullrequest/${raw.pullRequestId}`,
    org,
    project,
    repo,
    repoId: raw.repository?.id ?? "",
    number: raw.pullRequestId,
    title: raw.title ?? "",
    description: raw.description ?? "",
    author,
    isVendor: isVendorName(author),
    role: ownership.role ?? "reviewer",
    teams: ownership.teams,
    reviewState: ownership.reviewState,
    otherVotes: ownership.otherVotes,
    isDraft: !!raw.isDraft,
    status: raw.status ?? "active",
    mergeStatus: raw.mergeStatus ?? "",
    createdAt: raw.creationDate,
    sha: raw.lastMergeSourceCommit?.commitId ?? null,
    targetBranch: (raw.targetRefName ?? "").replace(/^refs\/heads\//, ""),
    sourceBranch: (raw.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
    reviewers: (raw.reviewers ?? []).filter((r) => r.id).map((r) => ({ id: r.id, vote: r.vote ?? 0, displayName: r.displayName ?? null, isContainer: !!r.isContainer, uniqueName: r.uniqueName ?? null }))
  };
}

// server/log.ts
var session = null;
function setSession(s) {
  session = s;
}
function log(message, level) {
  if (session) void session.log(message, level ? { level } : void 0).catch(() => {
  });
}

// server/db.ts
function rowToActivity(r) {
  return {
    id: r.id,
    ts: r.ts,
    level: r.level,
    msg: r.msg,
    data: r.data ? JSON.parse(r.data) : null,
    runId: r.run_id
  };
}
function rowToRun(r) {
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
    error: r.error
  };
}
var SCHEMA = `
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
var b = (v) => v ? 1 : 0;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var HOUR_MS = 36e5;
var WEEK_MS = 6048e5;
function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, c) => a - c);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function percentile(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, c) => a - c);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
}
function weekKey(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function recentWeeks(n) {
  const start = weekKey(Date.now());
  const startMs = Date.parse(start);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(startMs - i * WEEK_MS).toISOString().slice(0, 10));
  return out;
}
var AUTOMATED_RE = /dependabot|renovate|\bbot\b|build service|azure pipelines|automation|\bagency\b/i;
function classifyAuthor(author, isVendor) {
  if (author && AUTOMATED_RE.test(author)) return "Automated";
  return isVendor ? "Vendor" : "FTE";
}
function globMatch(pattern, value) {
  const rx = new RegExp(
    "^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i"
  );
  return rx.test(value);
}
function rowToPr(r) {
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
    role: r.role ?? "reviewer",
    teams: r.teams_json ? JSON.parse(r.teams_json) : [],
    reviewState: r.review_state ?? null,
    otherVotes: r.approvals_json ? JSON.parse(r.approvals_json) : [],
    lane: r.lane,
    state: r.state,
    isDraft: !!r.is_draft,
    dismissed: !!r.dismissed,
    dismissedReason: r.dismissed_reason,
    dismissedAt: r.dismissed_at,
    outOfScope: !!r.out_of_scope,
    snoozedUntil: r.snoozed_until,
    snoozeMode: r.snooze_mode ?? null,
    lastCommitSha: r.last_commit_sha,
    lastCommitAt: r.last_commit_at,
    prCreatedAt: r.pr_created_at,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    reviewSessionId: r.review_session_id,
    reviewedSha: r.reviewed_sha,
    changedFiles: r.changed_files ?? null,
    authorMeta: r.author_meta_json ? JSON.parse(r.author_meta_json) : null
  };
}
function rowToEvent(r) {
  return {
    id: r.id,
    canonical: r.canonical,
    ts: r.ts,
    type: r.type,
    payload: r.payload ? JSON.parse(r.payload) : null
  };
}
var ArgusStore = class _ArgusStore {
  #db;
  #stmts = /* @__PURE__ */ new Map();
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA busy_timeout = 5000;");
    this.#db.exec(SCHEMA);
    this.#ensureColumn("prs", "reviewers_json", "TEXT");
    this.#ensureColumn("pr_events", "run_id", "INTEGER");
    this.#ensureColumn("poll_runs", "tracked", "INTEGER");
    this.#ensureColumn("prs", "role", "TEXT");
    this.#ensureColumn("prs", "teams_json", "TEXT");
    this.#ensureColumn("prs", "review_state", "TEXT");
    this.#ensureColumn("prs", "description", "TEXT");
    this.#ensureColumn("prs", "out_of_scope", "INTEGER NOT NULL DEFAULT 0");
    this.#ensureColumn("prs", "snooze_mode", "TEXT");
    this.#ensureColumn("prs", "reviewed_sha", "TEXT");
    this.#ensureColumn("prs", "reviewed_at", "TEXT");
    this.#ensureColumn("prs", "reviewed_sha_authored_at", "TEXT");
    this.#ensureColumn("prs", "my_comments", "INTEGER");
    this.#ensureColumn("prs", "approvals_json", "TEXT");
    this.#ensureColumn("prs", "author_meta_json", "TEXT");
    this.#ensureColumn("prs", "merge_commit", "TEXT");
    this.#ensureColumn("prs", "merged_at", "TEXT");
    this.#ensureColumn("prs", "deploy_json", "TEXT");
    this.#ensureColumn("prs", "deploy_resolved_at", "TEXT");
    this.#ensureColumn("prs", "source_branch", "TEXT");
    this.#ensureColumn("prs", "target_branch", "TEXT");
    this.#ensureColumn("prs", "changed_files", "INTEGER");
    this.#ensureColumn("prs", "changed_files_sha", "TEXT");
    if (!this.#getSetting("changed_files_reset")) {
      this.#db.exec("UPDATE prs SET changed_files = NULL, changed_files_sha = NULL");
      this.#setSetting("changed_files_reset", now());
    }
    if (!this.#getSetting("changed_files_blob_count_reset")) {
      this.#db.exec("UPDATE prs SET changed_files = NULL, changed_files_sha = NULL");
      this.#setSetting("changed_files_blob_count_reset", now());
    }
    if (!this.#getSetting("deploy_time_migrated")) {
      this.#db.exec("UPDATE prs SET deploy_json = NULL WHERE deploy_json IS NOT NULL AND json_extract(deploy_json, '$.found') = 0");
      this.#setSetting("deploy_time_migrated", now());
    }
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
    this.#db.exec(`
      UPDATE prs SET reviewed_sha_authored_at = last_commit_at
      WHERE reviewed_sha IS NOT NULL AND reviewed_sha_authored_at IS NULL
        AND reviewed_sha = last_commit_sha AND last_commit_at IS NOT NULL
    `);
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
    if (!this.getChangesSeenAt()) this.setChangesSeenAt();
  }
  // Add a column to an existing DB if a prior schema version lacked it.
  #ensureColumn(table, column, type) {
    const cols = this.#db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  // Cache prepared statements by SQL text so hot paths don't recompile.
  #prep(sql) {
    let stmt = this.#stmts.get(sql);
    if (!stmt) {
      stmt = this.#db.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }
  // Insert on first sight, otherwise refresh only ADO-sourced columns. Triage
  // columns (lane, state, dismissed, snooze, session, added_at) are untouched.
  upsertPr(pr) {
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
      $ts: ts
    });
  }
  getPr(canonical) {
    this.#clearExpiredSnoozes();
    const row = this.#prep("SELECT * FROM prs WHERE canonical = ?").get(canonical);
    return row ? rowToPr(row) : null;
  }
  // Resolve a PR number to its canonical, across any state (incl. closed and
  // dismissed) so search can reach historical PRs. ADO PR ids are unique within
  // the org, so number alone is enough; newest wins if somehow duplicated.
  findCanonicalByNumber(number) {
    const row = this.#prep(
      "SELECT canonical FROM prs WHERE number = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(number);
    return row?.canonical ?? null;
  }
  listPrs(opts = {}) {
    this.#clearExpiredSnoozes();
    const where = [];
    if (!opts.includeClosed) where.push("state != 'closed'");
    if (!opts.includeDismissed) where.push("dismissed = 0");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.#prep(
      `SELECT * FROM prs ${clause} ORDER BY updated_at DESC`
    ).all();
    return rows.map(rowToPr);
  }
  #clearExpiredSnoozes() {
    this.#prep(
      "UPDATE prs SET snoozed_until = NULL, snooze_mode = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?"
    ).run(now());
  }
  appendEvent(canonical, type, payload, ts = now(), runId) {
    this.#prep(
      "INSERT INTO pr_events (canonical, ts, type, payload, run_id) VALUES (?, ?, ?, ?, ?)"
    ).run(canonical, ts, type, payload ? JSON.stringify(payload) : null, runId ?? null);
  }
  listEvents(canonical) {
    const rows = this.#prep(
      "SELECT * FROM pr_events WHERE canonical = ? ORDER BY ts ASC, id ASC"
    ).all(canonical);
    return rows.map(rowToEvent);
  }
  // Windowed feed of MY PR activity (authored + reviewed), for external
  // consumers (Clio's capture pulse). Every tracked PR is mine in some role, so
  // the source is simply pr_events joined to PR identity, restricted to the
  // event types that represent real PR activity (triage-noise types are dropped)
  // and to events in [sinceMs, untilMs). Authored `added`/`closed` are relabeled
  // as authored_opened/authored_merged. Vote churn by other reviewers only
  // surfaces on PRs I authored (on PRs I review, only my own vote is "mine").
  listPrActivity(sinceMs, untilMs) {
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
    `).all(sinceIso, untilIso);
    const VERDICTS = /* @__PURE__ */ new Set(["approved", "suggestions", "rejected", "waiting"]);
    const out = [];
    for (const r of rows) {
      const t = Date.parse(r.ts);
      if (!(t >= sinceMs && t < untilMs)) continue;
      const role = r.role ?? "reviewer";
      const payload = r.payload ? JSON.parse(r.payload) : {};
      if (r.type === "vote_changed" && role !== "author" && payload.mine !== true) continue;
      let type;
      if (r.type === "added") type = role === "author" ? "authored_opened" : "added";
      else if (r.type === "closed") type = role === "author" && payload.reason === "completed" ? "authored_merged" : "closed";
      else type = r.type;
      let verdict = null;
      if (r.type === "reviewed" && typeof payload.verdict === "string" && VERDICTS.has(payload.verdict)) {
        verdict = payload.verdict;
      } else if (r.type === "review_state" && typeof payload.to === "string" && VERDICTS.has(payload.to)) {
        verdict = payload.to;
      }
      const vote = r.type === "vote_changed" && typeof payload.vote === "number" ? payload.vote : null;
      const meta = r.author_meta_json ? JSON.parse(r.author_meta_json) : null;
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
          teams: r.teams_json ? JSON.parse(r.teams_json) : [],
          url: r.canonical
        },
        verdict,
        vote,
        activeComments: meta ? meta.activeComments : null,
        resolvedComments: meta ? meta.resolvedComments : null,
        reviewSessionId: r.review_session_id
      });
    }
    return out;
  }
  // Per-PR changes a run produced, joined with PR identity for display.
  listRunEvents(runId) {
    const rows = this.#prep(`
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.run_id = ? ORDER BY e.id ASC
    `).all(runId);
    return rows.map((r) => ({
      id: r.id,
      canonical: r.canonical,
      ts: r.ts,
      type: r.type,
      payload: r.payload ? JSON.parse(r.payload) : null,
      repo: r.repo,
      number: r.number,
      title: r.title
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
  listUnreadChanges(limit = 200) {
    const baseline = this.getChangesSeenAt();
    const nowTs = now();
    const clause = baseline ? " AND e.ts > ?" : "";
    const params = baseline ? [baseline, nowTs, limit] : [nowTs, limit];
    const rows = this.#prep(`
      SELECT e.id, e.canonical, e.ts, e.type, e.payload, p.repo, p.number, p.title
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE ${_ArgusStore.#CHANGE_FILTER}${clause}
        AND e.id NOT IN (SELECT event_id FROM changes_read)
        AND p.out_of_scope = 0
        AND COALESCE(p.snooze_mode, '') != 'fte'
        AND (p.snoozed_until IS NULL OR p.snoozed_until <= ?)
      ORDER BY e.ts DESC, e.id DESC LIMIT ?
    `).all(...params);
    return rows.map((r) => ({
      id: r.id,
      canonical: r.canonical,
      ts: r.ts,
      type: r.type,
      payload: r.payload ? JSON.parse(r.payload) : null,
      repo: r.repo,
      number: r.number,
      title: r.title
    }));
  }
  // Mark every currently-unread change for one PR as read (used when the user
  // clicks through to re-review that PR).
  markChangesReadForPr(canonical) {
    const ts = now();
    this.#prep(`
      INSERT OR IGNORE INTO changes_read (event_id, read_at)
      SELECT e.id, ? FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.canonical = ? AND ${_ArgusStore.#CHANGE_FILTER}
    `).run(ts, canonical);
  }
  // Clear the whole feed by advancing the caught-up watermark to now.
  markAllChangesRead() {
    this.setChangesSeenAt();
  }
  // --- reviewed-sha authored dates (for review latency) ---
  // Captured synchronously in recordReview from last_commit_at (see there); no
  // separate resolution step is needed.
  // Migrated PRs whose author the old tracker didn't capture; the poller backfills
  // them from ADO a bounded batch per cycle until none remain.
  prsMissingAuthor(limit = 50) {
    return this.#prep("SELECT canonical, number FROM prs WHERE author IS NULL LIMIT ?").all(limit);
  }
  setAuthor(canonical, author) {
    this.#prep("UPDATE prs SET author = ? WHERE canonical = ?").run(author, canonical);
  }
  // PRs you've voted on (terminal verdict, not your own) whose "my comment count"
  // hasn't been counted yet — drives the one-time backfill and go-forward counts.
  prsNeedingCommentCount(limit = 25) {
    return this.#prep(
      `SELECT canonical, number, project, repo FROM prs
       WHERE my_comments IS NULL AND role != 'author'
         AND review_state IN ('approved','suggestions','waiting','rejected')
       LIMIT ?`
    ).all(limit);
  }
  setMyComments(canonical, count) {
    this.#prep("UPDATE prs SET my_comments = ? WHERE canonical = ?").run(count, canonical);
  }
  // --- Deploy tracking (where a merged PR shipped) ---
  // Merge commit + real merge time (ADO closedDate), captured on close so we can
  // pin the exact build and bound the build search to the actual merge moment.
  setMergeInfo(canonical, sha, mergedAt) {
    this.#prep("UPDATE prs SET merge_commit = ?, merged_at = COALESCE(?, merged_at) WHERE canonical = ?").run(sha, mergedAt ?? null, canonical);
  }
  // ISO cutoff for the deploy window: PRs merged on/after this are in scope.
  #deployCutoff(windowDays) {
    return new Date(Date.now() - windowDays * 864e5).toISOString();
  }
  // Merged-in-window PRs (configured repos) missing the merge commit or its real
  // merge time. The poller backfills a bounded batch via `az pr show`.
  prsNeedingMergeInfo(windowDays, repos, limit = 30) {
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
    `).all(...repos, this.#deployCutoff(windowDays), limit);
  }
  // Merged-in-window PRs (configured repos) with a known merge commit whose deploy
  // state is unresolved or not yet terminal (still rolling out) — refreshed by the
  // poller until prod finishes.
  prsNeedingDeploy(windowDays, repos, limit = 20) {
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
    `).all(...repos, this.#deployCutoff(windowDays), limit);
  }
  setDeploy(canonical, deploy) {
    this.#prep("UPDATE prs SET deploy_json = ?, deploy_resolved_at = ? WHERE canonical = ?").run(
      JSON.stringify(deploy),
      now(),
      canonical
    );
  }
  // The deploy timeline: PRs merged within the window, newest first, each with its
  // resolved deploy state (or an unresolved placeholder if the poller hasn't gotten
  // to it yet). Drives the Deploys view and the detail-page "Shipped" line.
  deployTimeline(windowDays, repos) {
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
    `).all(...repos, this.#deployCutoff(windowDays));
    const pending = { found: false, reason: null, buildId: null, buildNumber: null, buildUrl: null, dev: null, ppe: null, prod: null, terminal: false };
    return rows.map((r) => ({
      canonical: r.canonical,
      repo: r.repo,
      number: r.number,
      title: r.title,
      author: r.author,
      mine: r.role === "author",
      mergedAt: r.mergedAt,
      deploy: r.deployJson ? JSON.parse(r.deployJson) : pending
    }));
  }
  getDeploy(canonical) {
    const row = this.#prep("SELECT deploy_json AS j FROM prs WHERE canonical = ?").get(canonical);
    return row?.j ? JSON.parse(row.j) : null;
  }
  // --- PR size (files changed) ---
  // Active board PRs whose file count is missing or stale (a new commit landed
  // since it was counted). New PRs bypass the bounded historical backfill.
  prsNeedingFileCount(limit = 20, newPrs = /* @__PURE__ */ new Set()) {
    const rows = this.#prep(`
      SELECT canonical, repo, source_branch AS sourceBranch, target_branch AS targetBranch, last_commit_sha AS sha
      FROM prs
      WHERE state != 'closed' AND dismissed = 0
        AND source_branch IS NOT NULL AND target_branch IS NOT NULL
        AND (changed_files IS NULL OR changed_files_sha IS NOT last_commit_sha)
    `).all();
    return [
      ...rows.filter((pr) => newPrs.has(pr.canonical)),
      ...rows.filter((pr) => !newPrs.has(pr.canonical)).slice(0, limit)
    ];
  }
  setChangedFiles(canonical, count, sha) {
    this.#prep("UPDATE prs SET changed_files = ?, changed_files_sha = ? WHERE canonical = ?").run(count, sha, canonical);
  }
  // --- Insights: aggregate analytics computed on demand from events + PRs ---
  // Per-day breakdown for the Load & capacity drill-down: which PRs arrived,
  // which you reviewed, and which were on your plate on a given local day. The
  // bucket logic mirrors computeInsights's daily series (must stay in sync).
  loadDayDetail(dayKey, recencyDays, work = { endHour: 17, days: [1, 2, 3, 4, 5] }) {
    const nowMs = Date.now();
    const staleMs = recencyDays * 864e5;
    const [y, m, d] = dayKey.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = dayStart + 864e5;
    const rollToBusinessDay = (ms) => {
      const dt = new Date(ms);
      const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (dt.getHours() >= work.endHour || !work.days.includes(dt.getDay())) day.setDate(day.getDate() + 1);
      let guard = 0;
      while (!work.days.includes(day.getDay()) && guard++ < 8) day.setDate(day.getDate() + 1);
      return day.getTime();
    };
    const VERDICT = /* @__PURE__ */ new Set(["approved", "suggestions", "waiting", "rejected"]);
    const dayAfter = (ms) => {
      const dt = new Date(ms);
      dt.setHours(0, 0, 0, 0);
      dt.setDate(dt.getDate() + 1);
      return dt.getTime();
    };
    const closedTs = /* @__PURE__ */ new Map();
    for (const r of this.#prep("SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical").all()) {
      closedTs.set(r.canonical, Date.parse(r.ts));
    }
    const prs = this.#prep(`
      SELECT canonical, repo, number, title, role, is_draft AS isDraft, dismissed, out_of_scope AS outOfScope,
             review_state AS reviewState, added_at AS addedAt, updated_at AS updatedAt, reviewed_at AS reviewedAt
      FROM prs
    `).all();
    const row = (p) => ({
      canonical: p.canonical,
      repo: p.repo,
      number: p.number,
      title: p.title,
      state: p.reviewState,
      ageDays: Math.max(0, Math.floor((dayEnd - Date.parse(p.addedAt)) / 864e5)),
      dayKey
    });
    const arrived = [];
    const onPlate = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || p.outOfScope || p.isDraft) continue;
      const start = Date.parse(p.addedAt);
      if (!Number.isFinite(start)) continue;
      const rolled = rollToBusinessDay(start);
      if (rolled >= dayStart && rolled < dayEnd) arrived.push(row(p));
      const ends = [];
      const cl = closedTs.get(p.canonical);
      if (cl) ends.push(cl);
      if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
      else if (p.reviewState && VERDICT.has(p.reviewState)) ends.push(dayAfter(p.reviewedAt ? Date.parse(p.reviewedAt) : Date.parse(p.updatedAt)));
      ends.push(Date.parse(p.updatedAt) + staleMs);
      const end = ends.length ? Math.min(...ends) : nowMs;
      if (start < dayEnd && end > dayStart) onPlate.push(row(p));
    }
    const reviewed = [];
    for (const r of this.#prep(`
      SELECT e.canonical, e.ts, p.repo, p.number, p.title, p.review_state AS reviewState, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
        AND e.ts >= ? AND e.ts < ?
    `).all(new Date(dayStart).toISOString(), new Date(dayEnd).toISOString())) {
      reviewed.push({
        canonical: r.canonical,
        repo: r.repo,
        number: r.number,
        title: r.title,
        state: r.reviewState,
        ageDays: Math.max(0, Math.floor((dayEnd - Date.parse(r.addedAt)) / 864e5)),
        dayKey
      });
    }
    const byAge = (a, b2) => b2.ageDays - a.ageDays;
    return {
      key: dayKey,
      endKey: dayKey,
      granularity: "day",
      peakDayKey: dayKey,
      arrived: arrived.sort(byAge),
      reviewed: reviewed.sort(byAge),
      onPlate: onPlate.sort(byAge)
    };
  }
  loadWeekDetail(weekKey2, recencyDays, work = { endHour: 17, days: [1, 2, 3, 4, 5] }) {
    const start = /* @__PURE__ */ new Date(`${weekKey2}T00:00:00`);
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      return localDayKey(day.getTime());
    });
    const details = days.map((day) => this.loadDayDetail(day, recencyDays, work));
    const peak = details.reduce((best, detail) => detail.onPlate.length > best.onPlate.length ? detail : best);
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const byAge = (a, b2) => b2.ageDays - a.ageDays;
    const arrived = this.#prep(`
      SELECT canonical, repo, number, title, review_state AS reviewState, added_at AS addedAt
      FROM prs
      WHERE (role IS NULL OR role != 'author') AND dismissed = 0 AND out_of_scope = 0 AND is_draft = 0
        AND added_at >= ? AND added_at < ?
    `).all(start.toISOString(), weekEnd.toISOString());
    const reviewed = this.#prep(`
      SELECT e.canonical, e.ts, p.repo, p.number, p.title, p.review_state AS reviewState, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
        AND e.ts >= ? AND e.ts < ?
    `).all(start.toISOString(), weekEnd.toISOString());
    const toRow = (p, at) => ({
      canonical: p.canonical,
      repo: p.repo,
      number: p.number,
      title: p.title,
      state: p.reviewState,
      ageDays: Math.max(0, Math.floor((Date.parse(at) + 864e5 - Date.parse(p.addedAt)) / 864e5)),
      dayKey: localDayKey(Date.parse(at))
    });
    return {
      key: weekKey2,
      endKey: days[6],
      granularity: "week",
      peakDayKey: peak.key,
      arrived: arrived.map((p) => toRow(p, p.addedAt)).sort((a, b2) => a.dayKey.localeCompare(b2.dayKey) || byAge(a, b2)),
      reviewed: reviewed.map((p) => toRow(p, p.ts)).sort((a, b2) => a.dayKey.localeCompare(b2.dayKey) || byAge(a, b2)),
      onPlate: peak.onPlate
    };
  }
  computeInsights(recencyDays, work = { endHour: 17, days: [1, 2, 3, 4, 5] }) {
    const nowMs = Date.now();
    const staleMs = recencyDays * 864e5;
    const weeks = recentWeeks(8);
    const rollToBusinessDay = (ms) => {
      const d = new Date(ms);
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (d.getHours() >= work.endHour || !work.days.includes(d.getDay())) {
        day.setDate(day.getDate() + 1);
      }
      let guard = 0;
      while (!work.days.includes(day.getDay()) && guard++ < 8) day.setDate(day.getDate() + 1);
      return day.getTime();
    };
    const reviewed = this.#prep(`
      SELECT e.canonical, e.ts, p.lane, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
      ORDER BY e.ts ASC
    `).all();
    const tpByWeek = /* @__PURE__ */ new Map();
    for (const r of reviewed) {
      const wk = weekKey(Date.parse(r.ts));
      const cell = tpByWeek.get(wk) ?? tpByWeek.set(wk, { quick: 0, review: 0 }).get(wk);
      if (r.lane === "quick") cell.quick++;
      else cell.review++;
    }
    const prs = this.#prep(`
      SELECT canonical, repo, number, title, author, role, teams_json AS teamsJson, is_vendor AS isVendor,
             lane, state, is_draft AS isDraft, dismissed, out_of_scope AS outOfScope,
             snoozed_until AS snoozedUntil, snooze_mode AS snoozeMode, review_state AS reviewState,
             added_at AS addedAt, pr_created_at AS prCreatedAt, last_commit_at AS lastCommitAt,
             updated_at AS updatedAt, author_meta_json AS authorMetaJson,
             reviewed_sha AS reviewedSha, reviewed_at AS reviewedAt, reviewed_sha_authored_at AS reviewedShaAuthoredAt,
             my_comments AS myComments
      FROM prs
    `).all();
    const latHours = [];
    const latPoints = [];
    let latPending = 0;
    for (const p of prs) {
      if (!p.reviewedSha || !p.reviewedAt) continue;
      if (p.state !== "closed" && nowMs - Date.parse(p.updatedAt) > staleMs) continue;
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
    const latBucketDefs = [
      ["< 12h", 0, 12],
      ["12\u201324h", 12, 24],
      ["1\u20132d", 24, 48],
      ["2\u20134d", 48, 96],
      ["> 4d", 96, Infinity]
    ];
    const latDistribution = latBucketDefs.map(([label]) => ({ label, count: 0 }));
    for (const h of latHours) {
      const i = latBucketDefs.findIndex(([, lo, hi]) => h >= lo && h < hi);
      if (i >= 0) latDistribution[i].count++;
    }
    const isSnoozed = (p) => p.snoozeMode === "fte" || !!p.snoozedUntil && Date.parse(p.snoozedUntil) > nowMs;
    const activeReview = prs.filter(
      (p) => p.role !== "author" && p.state !== "closed" && !p.dismissed && !p.outOfScope
    );
    const teamCount = /* @__PURE__ */ new Map();
    const repoCount = /* @__PURE__ */ new Map();
    const authorType = { FTE: 0, Vendor: 0, Automated: 0 };
    for (const p of activeReview) {
      authorType[classifyAuthor(p.author, !!p.isVendor)]++;
      repoCount.set(p.repo, (repoCount.get(p.repo) ?? 0) + 1);
      const teams = p.teamsJson ? JSON.parse(p.teamsJson) : [];
      if (teams.length === 0) teamCount.set("Direct", (teamCount.get("Direct") ?? 0) + 1);
      for (const t of teams) teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
    }
    const topCounts = (m) => [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, c) => c.count - a.count);
    const myNames = new Set(prs.filter((p) => p.role === "author" && p.author).map((p) => p.author));
    const reachItems = prs.filter((p) => p.role !== "author" && !p.dismissed && !!p.author && !myNames.has(p.author)).map((p) => ({
      at: p.addedAt,
      author: p.author,
      vendor: !!p.isVendor,
      repo: p.repo,
      teams: p.teamsJson ? JSON.parse(p.teamsJson) : []
    }));
    const VERDICTS = ["approved", "suggestions", "waiting", "rejected"];
    const voteByType = /* @__PURE__ */ new Map();
    let voteTotal = 0;
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !VERDICTS.includes(v)) continue;
      const type = classifyAuthor(p.author, !!p.isVendor);
      const cell = voteByType.get(type) ?? voteByType.set(type, { approved: 0, suggestions: 0, waiting: 0, rejected: 0 }).get(type);
      cell[v]++;
      voteTotal++;
    }
    const commentCounts = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !VERDICTS.includes(v)) continue;
      if (p.myComments != null) commentCounts.push(p.myComments);
    }
    const avgComments = commentCounts.length ? commentCounts.reduce((a, b2) => a + b2, 0) / commentCounts.length : null;
    const depthItems = [];
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !VERDICTS.includes(v)) continue;
      if (p.myComments == null) continue;
      let latencyHours = null;
      if (p.reviewedAt && p.reviewedShaAuthoredAt) {
        const h = (Date.parse(p.reviewedAt) - Date.parse(p.reviewedShaAuthoredAt)) / HOUR_MS;
        if (Number.isFinite(h) && h >= 0) latencyHours = h;
      }
      depthItems.push({ comments: p.myComments, type: classifyAuthor(p.author, !!p.isVendor), repo: p.repo, latencyHours });
    }
    const depthComments = depthItems.map((d) => d.comments);
    const depthTotal = depthComments.reduce((a, b2) => a + b2, 0);
    const depthHistDefs = [
      ["0", 0, 1],
      ["1\u20132", 1, 3],
      ["3\u20135", 3, 6],
      ["6+", 6, Infinity]
    ];
    const depthHistogram = depthHistDefs.map(([label]) => ({ label, count: 0 }));
    for (const c of depthComments) {
      const i = depthHistDefs.findIndex(([, lo, hi]) => c >= lo && c < hi);
      if (i >= 0) depthHistogram[i].count++;
    }
    const avgBy = (items) => items.length ? items.reduce((a, d) => a + d.comments, 0) / items.length : null;
    const depthByType = ["FTE", "Vendor", "Automated"].map((label) => {
      const items = depthItems.filter((d) => d.type === label);
      return { label, avg: avgBy(items), count: items.length, total: items.reduce((a, d) => a + d.comments, 0) };
    }).filter((t) => t.count > 0);
    const repoGroups = /* @__PURE__ */ new Map();
    for (const d of depthItems) (repoGroups.get(d.repo) ?? repoGroups.set(d.repo, []).get(d.repo)).push(d);
    const depthByRepo = [...repoGroups.entries()].map(([label, items]) => ({ label, avg: avgBy(items), count: items.length })).sort((a, c) => c.avg - a.avg);
    const depthLatDefs = [
      ["< 1 day", 0, 24],
      ["1\u20133 days", 24, 72],
      ["> 3 days", 72, Infinity]
    ];
    const depthByLatency = depthLatDefs.map(([label, lo, hi]) => {
      const items = depthItems.filter((d) => d.latencyHours != null && d.latencyHours >= lo && d.latencyHours < hi);
      return { label, avg: avgBy(items), count: items.length };
    }).filter((b2) => b2.count > 0);
    const zeroRate = depthComments.length ? depthComments.filter((c) => c === 0).length / depthComments.length : null;
    const GATE_VERDICTS = /* @__PURE__ */ new Set(["waiting", "rejected"]);
    const seqByCanon = /* @__PURE__ */ new Map();
    for (const r of this.#db.prepare(
      `SELECT canonical, payload FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY canonical, ts ASC, id ASC`
    ).all()) {
      if (!r.payload) continue;
      const v = JSON.parse(r.payload).verdict;
      if (!v) continue;
      (seqByCanon.get(r.canonical) ?? seqByCanon.set(r.canonical, []).get(r.canonical)).push(v);
    }
    const voteOutcomes = { firstPass: 0, gated: 0, held: 0 };
    const turnMap = /* @__PURE__ */ new Map();
    let votePathMeasured = 0;
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || !p.author || myNames.has(p.author)) continue;
      const v = p.reviewState;
      if (!v || !VERDICTS.includes(v)) continue;
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
    const originCov = /* @__PURE__ */ new Map();
    const covRank = { me: 0, teammate: 1, needs: 2 };
    const bumpCov = (key, cov, pr) => {
      const c = originCov.get(key) ?? originCov.set(key, { total: 0, me: 0, teammate: 0, needs: 0, prs: [] }).get(key);
      c.total++;
      c[cov]++;
      c.prs.push({ number: pr.number, repo: pr.repo, title: pr.title, coverage: cov });
    };
    for (const p of prs) {
      if (p.role === "author" || p.dismissed || p.outOfScope) continue;
      if (p.state !== "closed" && nowMs - Date.parse(p.updatedAt) > staleMs) continue;
      const teams = p.teamsJson ? JSON.parse(p.teamsJson) : [];
      if (teams.length === 0) {
        if (p.role === "reviewer") bumpCov("Individual", "me", p);
        continue;
      }
      const cov = p.role === "reviewer" ? "me" : p.reviewState === "covered" ? "teammate" : "needs";
      for (const t of teams) bumpCov(t, cov, p);
    }
    const reviewCoverageOrigins = [...originCov.entries()].map(([team, c]) => ({ ...c, team, prs: [...c.prs].sort((a, b2) => covRank[a.coverage] - covRank[b2.coverage]) })).sort((a, b2) => b2.total - a.total);
    const prMeta = /* @__PURE__ */ new Map();
    for (const p of prs) {
      const t = p.teamsJson ? JSON.parse(p.teamsJson)[0] ?? null : null;
      prMeta.set(p.canonical, { repo: p.repo, team: t, title: p.title, number: p.number, author: p.author, isVendor: !!p.isVendor });
    }
    const rhythmItems = [];
    for (const r of this.#db.prepare(
      `SELECT canonical, ts, json_extract(payload, '$.verdict') AS verdict FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY ts ASC`
    ).all()) {
      const m = prMeta.get(r.canonical);
      if (!m) continue;
      rhythmItems.push({ at: r.ts, repo: m.repo, team: m.team, number: m.number, title: m.title, verdict: r.verdict, author: m.author, isVendor: m.isVendor });
    }
    const waiting = activeReview.filter(
      (p) => !p.isDraft && !isSnoozed(p) && (p.reviewState === "needs" || p.reviewState === null) && nowMs - Date.parse(p.updatedAt) <= staleMs
    );
    const bucketDefs = [
      ["< 1 day", 0, 24],
      ["1\u20133 days", 24, 72],
      ["3\u20137 days", 72, 168],
      ["> 7 days", 168, Infinity]
    ];
    const buckets = bucketDefs.map(([label]) => ({ label, count: 0 }));
    const aged = waiting.map((p) => ({
      p,
      waitingHours: (nowMs - Date.parse(p.lastCommitAt ?? p.addedAt)) / HOUR_MS
    }));
    for (const { waitingHours } of aged) {
      const i = bucketDefs.findIndex(([, lo, hi]) => waitingHours >= lo && waitingHours < hi);
      if (i >= 0) buckets[i].count++;
    }
    const longest = [...aged].sort((a, c) => c.waitingHours - a.waitingHours).slice(0, 5).map(({ p, waitingHours }) => ({ canonical: p.canonical, repo: p.repo, number: p.number, title: p.title, waitingHours }));
    const closedTs = /* @__PURE__ */ new Map();
    for (const r of this.#prep(
      "SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical"
    ).all()) {
      closedTs.set(r.canonical, r.ts);
    }
    const authored = prs.filter((p) => p.role === "author");
    const openAuthored = authored.filter((p) => p.state !== "closed");
    const parseMeta = (j) => j ? JSON.parse(j) : null;
    let completable = 0;
    let blocked = 0;
    const openList = [];
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
        completable: m?.completable ?? false
      });
    }
    openList.sort((a, c) => c.activeComments - a.activeComments || c.blockers.length - a.blockers.length);
    const mergeHours = [];
    for (const p of authored) {
      if (p.state !== "closed" || !p.prCreatedAt) continue;
      const end = closedTs.get(p.canonical);
      if (!end) continue;
      const h = (Date.parse(end) - Date.parse(p.prCreatedAt)) / HOUR_MS;
      if (Number.isFinite(h) && h >= 0) mergeHours.push(h);
    }
    const intervals = [];
    const inflowMs = [];
    const VERDICT_STATES = /* @__PURE__ */ new Set(["approved", "suggestions", "waiting", "rejected"]);
    const dayAfter = (ms) => {
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
      const ends = [];
      const cl = closedTs.get(p.canonical);
      if (cl) ends.push(Date.parse(cl));
      if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
      else if (p.reviewState && VERDICT_STATES.has(p.reviewState)) {
        ends.push(dayAfter(p.reviewedAt ? Date.parse(p.reviewedAt) : Date.parse(p.updatedAt)));
      }
      const staleCut = Date.parse(p.updatedAt) + staleMs;
      if (Number.isFinite(staleCut)) ends.push(staleCut);
      const end = ends.length ? Math.min(...ends) : nowMs;
      if (end > start) intervals.push({ start, end });
    }
    const throughputMs = reviewed.map((r) => Date.parse(r.ts));
    const DAY_MS = 864e5;
    const WINDOW_DAYS = 84;
    const todayStart = /* @__PURE__ */ new Date();
    todayStart.setHours(0, 0, 0, 0);
    const firstDayStart = todayStart.getTime() - (WINDOW_DAYS - 1) * DAY_MS;
    const dayBuckets = Array.from({ length: WINDOW_DAYS }, (_, i) => {
      const dayStart = firstDayStart + i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      let level = 0;
      for (const iv of intervals) if (iv.start < dayEnd && iv.end > dayStart) level++;
      return { dayStart, level, inflow: 0, throughput: 0 };
    });
    const dayIndex = (ms) => Math.floor((ms - firstDayStart) / DAY_MS);
    for (const ms of inflowMs) {
      const i = dayIndex(ms);
      if (i >= 0 && i < WINDOW_DAYS) dayBuckets[i].inflow++;
    }
    const rolledInflow = new Array(WINDOW_DAYS).fill(0);
    for (const ms of inflowMs) {
      const i = dayIndex(rollToBusinessDay(ms));
      if (i >= 0 && i < WINDOW_DAYS) rolledInflow[i]++;
    }
    for (const ms of throughputMs) {
      const i = dayIndex(ms);
      if (i >= 0 && i < WINDOW_DAYS) dayBuckets[i].throughput++;
    }
    const daily = dayBuckets.slice(-14).filter((d) => {
      const wd = new Date(d.dayStart).getDay();
      return wd !== 0 && wd !== 6;
    }).map((d) => ({
      key: new Date(d.dayStart).toISOString().slice(0, 10),
      inflow: rolledInflow[dayIndex(d.dayStart)],
      throughput: d.throughput,
      backlog: d.level
    }));
    const loadWeeks = recentWeeks(12);
    const weeklyLoad = /* @__PURE__ */ new Map();
    for (const d of dayBuckets) {
      const wk = weekKey(d.dayStart);
      const cell = weeklyLoad.get(wk) ?? weeklyLoad.set(wk, { inflow: 0, throughput: 0, peak: 0 }).get(wk);
      cell.inflow += d.inflow;
      cell.throughput += d.throughput;
      cell.peak = Math.max(cell.peak, d.level);
    }
    const loadWeekly = loadWeeks.map((week) => {
      const cell = weeklyLoad.get(week) ?? { inflow: 0, throughput: 0, peak: 0 };
      return { key: week, inflow: cell.inflow, throughput: cell.throughput, backlog: cell.peak };
    });
    const peakDay = dayBuckets.reduce((best, d) => d.level > best.level ? d : best, { dayStart: 0, level: 0, inflow: 0, throughput: 0 });
    const balanceDays = dayBuckets.filter((d) => {
      const wd = new Date(d.dayStart).getDay();
      return wd !== 0 && wd !== 6;
    });
    const sortedLevels = balanceDays.map((d) => d.level).sort((a, b2) => a - b2);
    const heavyLine = sortedLevels.length ? Math.max(1, sortedLevels[Math.floor(sortedLevels.length * 0.75)]) : 1;
    const balanceSeries = balanceDays.map((d) => ({
      key: new Date(d.dayStart).toISOString().slice(0, 10),
      inflow: d.inflow,
      throughput: d.throughput,
      level: d.level
    }));
    const trackingSince = this.#db.prepare("SELECT MIN(ts) AS t FROM pr_events").get()?.t ?? null;
    return {
      generatedAt: now(),
      summary: {
        reviewsAllTime: rhythmItems.length,
        firstReviewAt: rhythmItems.length ? rhythmItems[0].at : null,
        lastReviewAt: rhythmItems.length ? rhythmItems[rhythmItems.length - 1].at : null,
        trackingSince
      },
      latency: {
        count: latHours.length,
        pending: latPending,
        medianHours: median(latHours),
        p90Hours: percentile(latHours, 90),
        fastestHours: latHours.length ? Math.min(...latHours) : null,
        slowestHours: latHours.length ? Math.max(...latHours) : null,
        points: latPoints,
        distribution: latDistribution
      },
      throughput: {
        total: reviewed.length,
        weekly: weeks.map((week) => {
          const cell = tpByWeek.get(week) ?? { quick: 0, review: 0 };
          return { week, quick: cell.quick, review: cell.review, total: cell.quick + cell.review };
        })
      },
      load: {
        daily,
        weekly: loadWeekly,
        peak: { count: peakDay.level, at: peakDay.level > 0 ? new Date(peakDay.dayStart).toISOString().slice(0, 10) : null }
      },
      backlog: {
        waitingCount: waiting.length,
        longestHours: aged.length ? Math.max(...aged.map((a) => a.waitingHours)) : null,
        buckets,
        longest
      },
      distribution: {
        byTeam: topCounts(teamCount),
        byRepo: topCounts(repoCount),
        byAuthorType: ["FTE", "Vendor", "Automated"].map((label) => ({ label, count: authorType[label] })).filter((x) => x.count > 0)
      },
      reach: {
        items: reachItems
      },
      votePattern: {
        byType: ["FTE", "Vendor", "Automated"].filter((t) => voteByType.has(t)).map((t) => ({ label: t, ...voteByType.get(t) })),
        total: voteTotal,
        avgComments,
        commentsMeasured: commentCounts.length
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
        byLatency: depthByLatency
      },
      votePath: {
        measured: votePathMeasured,
        outcomes: voteOutcomes,
        turns: votePathTurns
      },
      reviewCoverage: {
        origins: reviewCoverageOrigins
      },
      reviewRhythm: {
        items: rhythmItems
      },
      balance: {
        days: balanceSeries,
        heavyLine
      },
      authored: {
        open: openAuthored.length,
        completable,
        blocked,
        mergedCount: mergeHours.length,
        medianMergeHours: median(mergeHours),
        openList
      }
    };
  }
  getChangesSeenAt() {
    return this.#getSetting("changes_seen_at");
  }
  setChangesSeenAt(ts = now()) {
    this.#setSetting("changes_seen_at", ts);
  }
  // Prior state of every tracked PR, keyed by canonical, for the reconciler to
  // diff against. Reviewer votes come from the snapshot column.
  listSnapshots() {
    const rows = this.#prep(
      "SELECT canonical, last_commit_sha, is_draft, state, dismissed, reviewers_json FROM prs"
    ).all();
    const map = /* @__PURE__ */ new Map();
    for (const r of rows) {
      map.set(r.canonical, {
        sha: r.last_commit_sha,
        isDraft: !!r.is_draft,
        state: r.state,
        dismissed: !!r.dismissed,
        votes: r.reviewers_json ? JSON.parse(r.reviewers_json) : {}
      });
    }
    return map;
  }
  // Apply a reconcile plan atomically: events, metadata, and the vote snapshot
  // for every PR commit together, so a crash can't half-write a change.
  applyPlan(plan, runId) {
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
  markClosed(canonical, reason, ts = now(), runId) {
    this.appendEvent(canonical, "closed", { reason }, ts, runId);
    this.#prep("UPDATE prs SET state = 'closed', updated_at = ? WHERE canonical = ?").run(ts, canonical);
  }
  #setReviewers(canonical, votes) {
    this.#prep("UPDATE prs SET reviewers_json = ? WHERE canonical = ?").run(JSON.stringify(votes), canonical);
  }
  // Role/teams/reviewState (and the description preview) are cheap metadata that
  // can change without a signature change (a team added, a teammate voting, an
  // edited description), so the poller refreshes them for every mine PR each
  // cycle. No-op for canonicals not yet tracked.
  setOwnership(canonical, role, teams, reviewState, description, isVendor, otherVotes) {
    const prev = this.#prep("SELECT review_state AS s, description AS d FROM prs WHERE canonical = ?").get(canonical);
    const keepDesc = prev?.d && description.length < prev.d.length ? prev.d : description;
    this.#prep(
      "UPDATE prs SET role = ?, teams_json = ?, review_state = ?, description = ?, is_vendor = ?, approvals_json = ? WHERE canonical = ?"
    ).run(role, JSON.stringify(teams), reviewState, keepDesc, isVendor ? 1 : 0, JSON.stringify(otherVotes), canonical);
    if (prev && prev.s !== reviewState) {
      this.appendEvent(canonical, "review_state", { from: prev.s, to: reviewState });
    }
    const row = this.#prep("SELECT snooze_mode AS m FROM prs WHERE canonical = ?").get(canonical);
    if (row?.m === "fte") {
      const by = otherVotes.find((v) => v.vote >= 5 && !isVendorName(v.name))?.name ?? null;
      if (by || reviewState === "covered" || reviewState === "approved") {
        this.appendEvent(canonical, "fte_woke", { by });
        this.setSnooze(canonical, null, null);
      }
    }
  }
  // Mark a PR out of scope (I don't need to review it) or restore it. Parks the
  // PR in its own section rather than deleting it; fully reversible.
  setOutOfScope(canonical, value) {
    this.#prep("UPDATE prs SET out_of_scope = ? WHERE canonical = ?").run(value ? 1 : 0, canonical);
    this.appendEvent(canonical, value ? "out_of_scope" : "in_scope");
  }
  // Move a PR between the quick and full-review lanes (manual triage).
  setLane(canonical, lane) {
    this.#prep("UPDATE prs SET lane = ? WHERE canonical = ?").run(lane, canonical);
    this.appendEvent(canonical, "lane_changed", { lane });
  }
  // Authoritative description write (from `az pr show`, which returns full text,
  // unlike the bulk list). Bypasses the anti-truncation guard used elsewhere.
  setDescription(canonical, description) {
    this.#prep("UPDATE prs SET description = ? WHERE canonical = ?").run(description, canonical);
  }
  // Link the child session that reviewed this PR, so a later re-review can target
  // it. Cleared by passing null.
  setReviewSession(canonical, sessionId) {
    this.#prep("UPDATE prs SET review_session_id = ? WHERE canonical = ?").run(sessionId, canonical);
    this.appendEvent(canonical, "reviewed", sessionId ? { sessionId } : { cleared: true });
  }
  // Fully untrack a PR: delete its row and event history. Used to undo an
  // erroneous add / let the user drop a PR that shouldn't be on the board. Unlike
  // dismiss (which keeps a tombstone so it never resurrects), remove is a clean
  // delete — auto-discovery may re-add it later if it genuinely qualifies.
  removePr(canonical) {
    this.#prep("DELETE FROM pr_events WHERE canonical = ?").run(canonical);
    this.#prep("DELETE FROM prs WHERE canonical = ?").run(canonical);
  }
  // Explicitly record a review outcome: the verdict, the commit reviewed (for
  // re-push detection), and optionally the session that did it. The verdict is
  // reflected into review_state immediately so the board collapses without
  // waiting for the next ADO poll (which then reconciles the same value).
  recordReview(canonical, opts) {
    if (opts.sessionId) this.#prep("UPDATE prs SET review_session_id = ? WHERE canonical = ?").run(opts.sessionId, canonical);
    if (opts.sha) {
      this.#prep("UPDATE prs SET reviewed_sha = ? WHERE canonical = ?").run(opts.sha, canonical);
      this.#prep(`
        UPDATE prs
        SET reviewed_sha_authored_at = CASE WHEN reviewed_sha = last_commit_sha THEN last_commit_at ELSE NULL END
        WHERE canonical = ?
      `).run(canonical);
    }
    const VERDICT_STATES = /* @__PURE__ */ new Set(["approved", "suggestions", "waiting", "rejected"]);
    if (opts.verdict && VERDICT_STATES.has(opts.verdict)) {
      this.#prep("UPDATE prs SET reviewed_at = ? WHERE canonical = ?").run(now(), canonical);
      this.#prep("UPDATE prs SET my_comments = NULL WHERE canonical = ?").run(canonical);
      const prev = this.#prep("SELECT review_state AS s FROM prs WHERE canonical = ?").get(canonical);
      this.#prep("UPDATE prs SET review_state = ? WHERE canonical = ?").run(opts.verdict, canonical);
      if (prev && prev.s !== opts.verdict) {
        this.appendEvent(canonical, "review_state", { from: prev.s, to: opts.verdict });
      }
    }
    this.appendEvent(canonical, "reviewed", {
      verdict: opts.verdict ?? null,
      sha: opts.sha ?? null,
      sessionId: opts.sessionId ?? null
    });
  }
  // Hide a PR: `until` (ISO) for a timed snooze, or mode "fte" to hide until a
  // teammate/FTE approves (the poller wakes it in setOwnership). null clears it.
  setSnooze(canonical, until, mode = until ? "time" : null) {
    this.#prep("UPDATE prs SET snoozed_until = ?, snooze_mode = ? WHERE canonical = ?").run(until, mode, canonical);
    this.appendEvent(canonical, "snoozed", mode ? { until, mode } : { cleared: true });
  }
  // Store completability + comment counts for one of my authored PRs.
  setAuthorMeta(canonical, meta) {
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
  getArchivable(recencyDays) {
    const staleMs = recencyDays * 864e5;
    const now2 = Date.now();
    const rows = this.#prep(`
      SELECT p.repo AS repo, p.number AS number, p.review_session_id AS sessionId,
        p.state AS state, p.updated_at AS updatedAt,
        (SELECT json_extract(e.payload, '$.reason') FROM pr_events e
         WHERE e.canonical = p.canonical AND e.type = 'closed'
         ORDER BY e.ts DESC LIMIT 1) AS closeReason
      FROM prs p
      WHERE p.review_session_id IS NOT NULL AND p.dismissed = 0
      ORDER BY p.updated_at DESC
    `).all();
    return rows.filter((r) => r.state === "closed" || now2 - Date.parse(r.updatedAt) > staleMs).map((r) => ({
      repo: r.repo,
      number: r.number,
      sessionId: r.sessionId,
      status: r.state === "closed" ? r.closeReason ?? "completed" : "stale"
    }));
  }
  // Drop the review-session link on PRs whose sessions were just archived, so
  // they leave the archivable list. Keyed by sessionId (what the banner acts on).
  markReviewSessionsArchived(sessionIds) {
    if (sessionIds.length === 0) return;
    const placeholders = sessionIds.map(() => "?").join(",");
    this.#prep(`UPDATE prs SET review_session_id = NULL WHERE review_session_id IN (${placeholders})`).run(...sessionIds);
  }
  // --- operational logging (pruned by age) ---
  startPollRun(startedAt = now()) {
    const info = this.#prep("INSERT INTO poll_runs (started_at) VALUES (?)").run(startedAt);
    return Number(info.lastInsertRowid);
  }
  finishPollRun(runId, result, finishedAt = now()) {
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
      runId
    );
  }
  // Size of the active queue (what the Board shows): not closed, not dismissed.
  countTracked() {
    const r = this.#prep("SELECT COUNT(*) AS n FROM prs WHERE state != 'closed' AND dismissed = 0").get();
    return r.n;
  }
  // Append one trace line and mirror it to the extension log.
  recordActivity(level, msg, data, runId) {
    this.#prep(
      "INSERT INTO activity_log (ts, level, msg, data, run_id) VALUES (?, ?, ?, ?, ?)"
    ).run(now(), level, msg, data ? JSON.stringify(data) : null, runId ?? null);
    log(data ? `${msg} ${JSON.stringify(data)}` : msg, level === "info" ? void 0 : level);
  }
  listActivity(limit = 100) {
    const rows = this.#prep(
      "SELECT * FROM (SELECT * FROM activity_log ORDER BY id DESC LIMIT ?) ORDER BY id ASC"
    ).all(limit);
    return rows.map(rowToActivity);
  }
  // Trace lines for one run, in order, for the run-detail view.
  listActivityForRun(runId) {
    const rows = this.#prep(
      "SELECT * FROM activity_log WHERE run_id = ? ORDER BY id ASC"
    ).all(runId);
    return rows.map(rowToActivity);
  }
  listPollRuns(limit = 50) {
    const rows = this.#prep("SELECT * FROM poll_runs ORDER BY id DESC LIMIT ?").all(limit);
    return rows.map(rowToRun);
  }
  getRun(id) {
    const row = this.#prep("SELECT * FROM poll_runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : null;
  }
  // Drop operational logs older than the retention window. Cheap; run per cycle.
  pruneLogs(retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
    this.#prep("DELETE FROM activity_log WHERE ts < ?").run(cutoff);
    this.#prep("DELETE FROM poll_runs WHERE started_at < ?").run(cutoff);
  }
  // User config overrides (set from the Settings screen), merged onto defaults.
  getConfigOverrides() {
    const row = this.#prep("SELECT value FROM settings WHERE key = 'config'").get();
    return row ? JSON.parse(row.value) : {};
  }
  saveConfigOverrides(overrides) {
    this.#prep(
      "INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(JSON.stringify(overrides));
  }
  // First-run gate: true once the user has confirmed org/project/team setup.
  // Until then the UI shows the setup screen instead of an empty, mis-configured
  // board (the shipped defaults are one team's, so ownership is wrong otherwise).
  isSetupComplete() {
    return this.#getSetting("setup_complete") === "1";
  }
  markSetupComplete() {
    this.#setSetting("setup_complete", "1");
  }
  #getSetting(key) {
    const row = this.#prep("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value ?? null;
  }
  #setSetting(key, value) {
    this.#prep(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value);
  }
  // Team (container reviewer) names seen during discovery, for the Settings picker.
  getSeenTeams() {
    const v = this.#getSetting("seen_teams");
    return v ? JSON.parse(v) : [];
  }
  addSeenTeams(names) {
    const merged = [.../* @__PURE__ */ new Set([...this.getSeenTeams(), ...names])].sort();
    this.#setSetting("seen_teams", JSON.stringify(merged));
  }
  // One-time, guarded import of the old pr-tracker state file so we have real
  // (mostly stale) PRs to work with. INSERT OR IGNORE won't clobber live rows;
  // updated_at is set to the old last-refreshed time so they read as stale.
  importLegacyState(file, teamPatterns) {
    if (this.#getSetting("legacy_imported")) return { imported: 0 };
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      return { imported: 0 };
    }
    const parsed = JSON.parse(text);
    const prs = parsed.prs ? Object.values(parsed.prs) : [];
    let imported = 0;
    this.#db.exec("BEGIN");
    try {
      for (const p of prs) {
        if (!p.url) continue;
        const teams = (p.reviewers ?? []).filter((r) => r.is_container && r.display_name && teamPatterns.some((pat) => globMatch(pat, r.display_name))).map((r) => r.display_name);
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
          JSON.stringify(votes)
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
  counts() {
    const prs = this.#prep("SELECT COUNT(*) AS n FROM prs").get();
    const events = this.#prep("SELECT COUNT(*) AS n FROM pr_events").get();
    return { prs: prs.n, events: events.n };
  }
  // Read-only import of the legacy pr-tracker involvement archive so Insights
  // has real history. Idempotent: safe to re-run to pick up new departures as
  // pr-tracker keeps appending. Reconstructs a timeline per record; never writes
  // back to the archive.
  importInvolvement(file) {
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      return { imported: 0 };
    }
    let imported = 0;
    this.#db.exec("BEGIN");
    try {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const rec = JSON.parse(trimmed);
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
  #importRecord(rec) {
    const parsed = parseAdoPrUrl(rec.url);
    const added = rec.added_at || rec.archived_at || now();
    this.#prep(`
      INSERT OR IGNORE INTO prs (canonical, org, project, repo, number, title,
                                 author, is_vendor, lane, state, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)
    `).run(
      rec.url,
      parsed?.org ?? "",
      parsed?.project ?? "",
      rec.repo ?? parsed?.repo ?? "",
      rec.pr_number ?? parsed?.number ?? 0,
      rec.title ?? "",
      rec.author_display_name ?? null,
      b(!!rec.is_vendor || !!rec.is_agency),
      rec.lane === "quick" ? "quick" : "review",
      added,
      rec.archived_at ?? added
    );
    if (rec.added_at) this.appendEvent(rec.url, "added", { source: "migration" }, rec.added_at);
    for (const rv of rec.reviews ?? []) {
      this.appendEvent(
        rec.url,
        "reviewed",
        { source: "migration", mode: rv.mode, vote: rv.vote, comments_posted: rv.comments_posted },
        rv.reviewed_at || added
      );
    }
    const terminal = rec.reason === "removed" ? "removed" : "closed";
    this.appendEvent(rec.url, terminal, { source: "migration", reason: rec.reason }, rec.archived_at || added);
  }
  // A record is already imported if its terminal event exists. Dedups by the
  // PR's departure timestamp, so re-running only adds new departures — and it's
  // idempotent against data already in the DB, no separate bookkeeping.
  #recordImported(rec) {
    const terminalTs = rec.archived_at || rec.added_at;
    if (!terminalTs) return false;
    const type = rec.reason === "removed" ? "removed" : "closed";
    return !!this.#prep(
      "SELECT 1 FROM pr_events WHERE canonical = ? AND ts = ? AND type = ? LIMIT 1"
    ).get(rec.url, terminalTs, type);
  }
  close() {
    this.#db.close();
  }
};
function parseAdoPrUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const gitIdx = parts.indexOf("_git");
    const prIdx = parts.indexOf("pullrequest");
    if (gitIdx === -1 || prIdx === -1) return null;
    const org = u.hostname.endsWith("visualstudio.com") ? u.hostname.split(".")[0] : parts[0];
    const project = u.hostname.endsWith("visualstudio.com") ? parts[0] : parts[1];
    return {
      org: org ?? "",
      project: project ?? "",
      repo: parts[gitIdx + 1] ?? "",
      number: Number(parts[prIdx + 1]) || 0
    };
  } catch {
    return null;
  }
}

// server/ado/client.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var pExecFile = promisify(execFile);
var MAX_BUFFER = 64 * 1024 * 1024;
var EXEC_OPTS = { maxBuffer: MAX_BUFFER, encoding: "buffer" };
function decodeAz(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
var IS_WIN = process.platform === "win32";
function azCommand(args) {
  return IS_WIN ? [process.env.ComSpec || "cmd.exe", ["/c", "az", ...args]] : ["az", args];
}
var AdoError = class extends Error {
};
async function azJson(args) {
  try {
    const [cmd, cmdArgs] = azCommand([...args, "-o", "json"]);
    const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
    const text = decodeAz(stdout).trim();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    throw new AdoError(`az ${args[0]} ${args[1] ?? ""} failed: ${err.message}`);
  }
}
async function whoami() {
  const [cmd, cmdArgs] = azCommand(["account", "show", "--query", "user.name", "-o", "tsv"]);
  const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
  const me2 = decodeAz(stdout).trim();
  if (!me2) throw new AdoError("az not logged in (az account show returned nothing)");
  return me2;
}
function listActivePrs(org, project) {
  return azJson(["repos", "pr", "list", "--status", "active", "--org", org, "--project", project, "--top", "2000"]);
}
var ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
var tokenCache = null;
async function adoAccessToken() {
  if (tokenCache && tokenCache.exp - 6e4 > Date.now()) return tokenCache.token;
  const [cmd, cmdArgs] = azCommand(["account", "get-access-token", "--resource", ADO_RESOURCE, "-o", "json"]);
  const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
  const j = JSON.parse(decodeAz(stdout));
  const exp = j.expiresOn ? Date.parse(j.expiresOn) : Date.now() + 50 * 6e4;
  tokenCache = { token: j.accessToken, exp: Number.isNaN(exp) ? Date.now() + 50 * 6e4 : exp };
  return j.accessToken;
}
function countBlobChanges(changes) {
  return changes.filter((change) => change.item?.gitObjectType === "blob").length;
}
async function prChangedFileCount(orgUrl, project, repo, targetBranch, sourceBranch) {
  const base = `${orgUrl.replace(/\/$/, "")}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
  const params = new URLSearchParams({
    baseVersion: targetBranch,
    baseVersionType: "branch",
    targetVersion: sourceBranch,
    targetVersionType: "branch",
    "api-version": "7.1",
    $top: "2000"
  });
  const token = await adoAccessToken();
  let count = 0;
  let skip = 0;
  while (true) {
    params.set("$skip", String(skip));
    const res = await fetch(`${base}/diffs/commits?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new AdoError(`diffs/commits ${res.status} for ${repo} ${sourceBranch}`);
    const j = await res.json();
    const changes = j.changes ?? [];
    count += countBlobChanges(changes);
    if (j.allChangesIncluded) return count;
    if (changes.length === 0) throw new AdoError(`diffs/commits pagination stalled for ${repo} ${sourceBranch}`);
    skip += changes.length;
  }
}
function showPr(id, org) {
  return azJson(["repos", "pr", "show", "--id", String(id), "--org", org]);
}
function listPrPolicies(org, id) {
  return azJson(["repos", "pr", "policy", "list", "--id", String(id), "--org", org]);
}
function fetchPrThreads(orgUrl, project, repoId, prId) {
  return azJson([
    "devops",
    "invoke",
    "--area",
    "git",
    "--resource",
    "pullRequestThreads",
    "--route-parameters",
    `project=${project}`,
    `repositoryId=${repoId}`,
    `pullRequestId=${prId}`,
    "--org",
    orgUrl.replace(/\/$/, ""),
    "--api-version",
    "7.1"
  ]).then((j) => j?.value ?? []);
}

// server/server.ts
import { createServer } from "node:http";

// server/ado/images.ts
import https from "node:https";
function isAllowedImageHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.endsWith("visualstudio.com") || host.endsWith("dev.azure.com");
  } catch {
    return false;
  }
}
function getOnce(url, token) {
  const headers = { Accept: "image/*" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
  });
}
async function fetchAdoImage(url) {
  const token = await adoAccessToken();
  let current = url;
  for (let i = 0; i < 4; i++) {
    const sendAuth = isAllowedImageHost(current);
    const r = await getOnce(current, sendAuth ? token : "");
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && typeof loc === "string") {
      current = new URL(loc, current).toString();
      continue;
    }
    const contentType = r.headers["content-type"] || "application/octet-stream";
    return { status: r.status, contentType, body: r.body };
  }
  throw new Error("too many redirects");
}

// server/respond.ts
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// server/api.ts
function archivePrompt(items) {
  const lines = items.map((a) => `- ${a.repo} #${a.number} (${a.status}) \u2192 session \`${a.sessionId}\``);
  const staleN = items.filter((a) => a.status === "stale").length;
  const closedN = items.length - staleN;
  const parts = [
    closedN > 0 ? `${closedN} closed/merged` : null,
    staleN > 0 ? `${staleN} stale (open but idle past the recency window)` : null
  ].filter(Boolean);
  return [
    `Argus: ${items.length} tracked PR(s) have a linked review session with no further work (${parts.join(" and ")}). Please archive these review sessions:`,
    ``,
    ...lines
  ].join("\n");
}
var INGEST = "http://127.0.0.1:48100/api/pr/record-review";
function recordCmd(canonical) {
  return `Invoke-RestMethod -Method Post -Uri ${INGEST} -ContentType application/json -Body '{"canonical":"${canonical}","verdict":"<approved|suggestions|waiting|rejected>"}'`;
}
function reviewPrompt(pr, skillName) {
  const ref = `**${pr.repo} #${pr.number}** \u2014 ${pr.title}
${pr.canonical}`;
  if (pr.reviewSessionId) {
    return [
      `Argus: time for a **re-review** of ${ref}`,
      ``,
      `The prior review ran in session \`${pr.reviewSessionId}\`. Send that session a message:`,
      `"Time for a re-review: check for new commits/updates on the PR and where things stand, review it with the user, then record the updated verdict yourself by running this in the session's terminal (no canvas needed): \`${recordCmd(pr.canonical)}\`. Do not report back here."`
    ].join("\n");
  }
  return [
    `Argus: please **review** ${ref}`,
    `Lane: ${pr.lane === "quick" ? "quick" : "review"}`,
    ``,
    `Spawn a child session named concisely from the PR's subject with its number (3-5 words + " #${pr.number}", dropping filler like "add"/"update" and NOT prefixing "Review" \u2014 it's implied; e.g. "Add feature flags for Probadge" (#${pr.number}) \u2192 "Probadge Feature Flags #${pr.number}"), and run the ${skillName} skill on it. In the child session's kickoff prompt, include the line \`Lane: ${pr.lane === "quick" ? "quick" : "review"}\` so the ${skillName} skill branches into ${pr.lane === "quick" ? "quick" : "full"} mode automatically. Spawn it decoupled (\`coordinate_with_creator: false\`) so it does not report back into this chat. Spawn it in interactive mode (\`kickoff.mode: "interactive"\`), never autopilot.`,
    ``,
    `As soon as the session exists, invoke the Argus \`linkReviewSession\` action with \`{ "canonical": "${pr.canonical}", "sessionId": "<child session id>" }\`. You do NOT need to wait for or relay the outcome: when the review concludes, the review session records its own verdict headlessly by running \`${recordCmd(pr.canonical)}\` in its terminal \u2014 no canvas required. If that POST fails (Argus not running), it should surface the verdict to Dade so he can record it manually.`
  ].join("\n");
}
function automaticReviewPrompt(pr, skillName) {
  const ref = `**${pr.repo} #${pr.number}** \u2014 ${pr.title}
${pr.canonical}`;
  return [
    `Argus: please run an **automatic review** of ${ref}`,
    `Lane: quick`,
    `Review mode: automatic`,
    ``,
    `Spawn a child session named concisely from the PR's subject with its number (3-5 words + " #${pr.number}", dropping filler like "add"/"update" and NOT prefixing "Review" \u2014 it's implied). Run the ${skillName} skill on it. The child kickoff prompt must include both \`Lane: quick\` and \`Review mode: automatic\`. Spawn it decoupled (\`coordinate_with_creator: false\`) with \`kickoff.mode: "autopilot"\`. Automatic mode is an in-depth full review, not the abbreviated quick-lane flow.`,
    ``,
    `As soon as the session exists, invoke the Argus \`linkReviewSession\` action with \`{ "canonical": "${pr.canonical}", "sessionId": "<child session id>" }\`. The child must inspect and rely on the PR's existing Azure DevOps build/check status and test results. It must not run local test suites, builds, linters, typechecks, or other expensive validation commands. Missing, running, inaccessible, or failed CI evidence means validation is incomplete. When validation is complete and confident with zero findings, it must cast an ADO Approved vote and record Argus verdict \`approved\`. With any finding, uncertainty, incomplete validation, or operational failure, it must post no ADO comments, cast no ADO vote, record only a provisional Argus \`waiting\` verdict when possible, and leave a detailed blocker summary in its own chat. It must never claim success after a partial failure.`
  ].join("\n");
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  return text ? JSON.parse(text) : {};
}
async function handleApi(req, res, ctx) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const route = url.pathname;
  if (!route.startsWith("/api/")) return false;
  if (route === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      boot_at: ctx.bootAt,
      store: ctx.store.counts(),
      migrated: ctx.migrated,
      poller: ctx.pollerStatus(),
      setup_complete: ctx.store.isSetupComplete()
    });
    return true;
  }
  if (route === "/api/prs") {
    sendJson(res, 200, { prs: ctx.store.listPrs() });
    return true;
  }
  if (route === "/api/pr") {
    const canonical = url.searchParams.get("canonical");
    if (!canonical) sendJson(res, 400, { error: "canonical required" });
    else sendJson(res, 200, { pr: ctx.store.getPr(canonical), events: ctx.store.listEvents(canonical), deploy: ctx.store.getDeploy(canonical) });
    return true;
  }
  if (route === "/api/deploys") {
    const cfg = ctx.getConfig();
    sendJson(res, 200, { window: cfg.deployWindowDays, timeline: ctx.store.deployTimeline(cfg.deployWindowDays, Object.keys(cfg.repoPipelines)) });
    return true;
  }
  if (route === "/api/pr/find") {
    const number = Number(url.searchParams.get("number"));
    if (!Number.isInteger(number) || number <= 0) sendJson(res, 400, { error: "valid number required" });
    else sendJson(res, 200, { canonical: ctx.store.findCanonicalByNumber(number) });
    return true;
  }
  if (route === "/api/pr/track" && req.method === "POST") {
    const body = await readJsonBody(req);
    const number = Number(body.number);
    if (!Number.isInteger(number) || number <= 0) sendJson(res, 400, { error: "valid number required" });
    else {
      const result = await ctx.trackPr(number);
      sendJson(res, result.ok ? 200 : 409, result);
    }
    return true;
  }
  if (route === "/api/pr/refresh" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical) sendJson(res, 400, { error: "canonical required" });
    else {
      await ctx.refreshPr(body.canonical);
      sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
    }
    return true;
  }
  if (route === "/api/pr/snooze" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical) sendJson(res, 400, { error: "canonical required" });
    else {
      ctx.store.setSnooze(body.canonical, body.until ?? null, body.mode ?? (body.until ? "time" : null));
      sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
    }
    return true;
  }
  if (route === "/api/pr/lane" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical || body.lane !== "quick" && body.lane !== "review") {
      sendJson(res, 400, { error: "canonical and lane (quick|review) required" });
    } else {
      ctx.store.setLane(body.canonical, body.lane);
      sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
    }
    return true;
  }
  if (route === "/api/pr/review" && req.method === "POST") {
    const body = await readJsonBody(req);
    const pr = body.canonical ? ctx.store.getPr(body.canonical) : null;
    if (!pr) sendJson(res, 400, { error: "canonical required / not found" });
    else if (body.automatic !== void 0 && typeof body.automatic !== "boolean") sendJson(res, 400, { error: "automatic must be boolean" });
    else if (body.automatic && pr.lane !== "quick") sendJson(res, 400, { error: "automatic review requires quick lane" });
    else {
      await ctx.dispatch(body.automatic ? automaticReviewPrompt(pr, ctx.getConfig().reviewSkillName) : reviewPrompt(pr, ctx.getConfig().reviewSkillName));
      sendJson(res, 200, { ok: true, reReview: !!pr.reviewSessionId });
    }
    return true;
  }
  if (route === "/api/pr/record-review" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical) sendJson(res, 400, { error: "canonical required" });
    else {
      ctx.recordReview(body.canonical, { verdict: body.verdict, sha: body.sha, sessionId: body.sessionId });
      sendJson(res, 200, { ok: true });
    }
    return true;
  }
  if (route === "/api/pr/remove" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical) sendJson(res, 400, { error: "canonical required" });
    else {
      ctx.store.removePr(body.canonical);
      sendJson(res, 200, { ok: true });
    }
    return true;
  }
  if (route === "/api/pr/scope" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.canonical) sendJson(res, 400, { error: "canonical required" });
    else {
      ctx.store.setOutOfScope(body.canonical, !!body.outOfScope);
      sendJson(res, 200, { pr: ctx.store.getPr(body.canonical) });
    }
    return true;
  }
  if (route === "/api/img") {
    const target = url.searchParams.get("url");
    if (!target || !isAllowedImageHost(target)) {
      res.writeHead(400).end("bad url");
      return true;
    }
    try {
      const img = await fetchAdoImage(target);
      res.writeHead(img.status, { "content-type": img.contentType, "cache-control": "private, max-age=3600" });
      res.end(img.body);
    } catch {
      res.writeHead(502).end("image proxy error");
    }
    return true;
  }
  if (route === "/api/refresh" && req.method === "POST") {
    sendJson(res, 200, { summary: await ctx.reconcile() });
    return true;
  }
  if (route === "/api/config") {
    if (req.method === "POST") sendJson(res, 200, { config: ctx.saveConfig(await readJsonBody(req)) });
    else sendJson(res, 200, { config: ctx.getConfig() });
    return true;
  }
  if (route === "/api/setup" && req.method === "POST") {
    const body = await readJsonBody(req);
    const { installPrReviewSkill, ...overrides } = body;
    const config = ctx.saveConfig(overrides);
    ctx.markSetupComplete();
    const skill = installPrReviewSkill ? ctx.installBaselineSkill() : { installed: false, reason: "skipped" };
    sendJson(res, 200, { config, setup_complete: true, skill });
    return true;
  }
  if (route === "/api/load/detail") {
    const key = url.searchParams.get("key");
    const granularity = url.searchParams.get("granularity");
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) sendJson(res, 400, { error: "key (YYYY-MM-DD) required" });
    else if (granularity !== "day" && granularity !== "week") sendJson(res, 400, { error: "granularity (day or week) required" });
    else {
      const cfg = ctx.getConfig();
      const work = { endHour: cfg.workEndHour, days: cfg.workDays };
      const detail = granularity === "week" ? ctx.store.loadWeekDetail(key, cfg.recencyDays, work) : ctx.store.loadDayDetail(key, cfg.recencyDays, work);
      sendJson(res, 200, { detail });
    }
    return true;
  }
  if (route === "/api/changes") {
    sendJson(res, 200, { changes: ctx.store.listUnreadChanges() });
    return true;
  }
  if (route === "/api/insights") {
    const cfg = ctx.getConfig();
    sendJson(res, 200, {
      insights: ctx.store.computeInsights(cfg.recencyDays, { endHour: cfg.workEndHour, days: cfg.workDays })
    });
    return true;
  }
  if (route === "/api/changes/read" && req.method === "POST") {
    const { canonical } = await readJsonBody(req);
    if (!canonical) {
      sendJson(res, 400, { error: "canonical required" });
      return true;
    }
    ctx.store.markChangesReadForPr(canonical);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (route === "/api/changes/read-all" && req.method === "POST") {
    ctx.store.markAllChangesRead();
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (route === "/api/archivable") {
    sendJson(res, 200, { archivable: ctx.store.getArchivable(ctx.getConfig().recencyDays) });
    return true;
  }
  if (route === "/api/archive" && req.method === "POST") {
    const items = ctx.store.getArchivable(ctx.getConfig().recencyDays);
    if (items.length > 0) {
      await ctx.dispatch(archivePrompt(items));
      ctx.store.markReviewSessionsArchived(items.map((i) => i.sessionId));
    }
    sendJson(res, 200, { dispatched: items.length });
    return true;
  }
  if (route === "/api/teams") {
    sendJson(res, 200, { teams: ctx.store.getSeenTeams() });
    return true;
  }
  if (route === "/api/activity") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    sendJson(res, 200, { entries: ctx.store.listActivity(limit) });
    return true;
  }
  if (route === "/api/pr-activity") {
    const nowMs = Date.now();
    const untilRaw = url.searchParams.get("until");
    const sinceRaw = url.searchParams.get("since");
    const untilMs = untilRaw ? Date.parse(untilRaw) : nowMs;
    if (Number.isNaN(untilMs)) {
      sendJson(res, 400, { error: "until must be ISO8601" });
      return true;
    }
    const sinceMs = sinceRaw ? Date.parse(sinceRaw) : untilMs - 24 * 60 * 60 * 1e3;
    if (Number.isNaN(sinceMs)) {
      sendJson(res, 400, { error: "since must be ISO8601" });
      return true;
    }
    sendJson(res, 200, {
      since: new Date(sinceMs).toISOString(),
      until: new Date(untilMs).toISOString(),
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      events: ctx.store.listPrActivity(sinceMs, untilMs)
    });
    return true;
  }
  if (route === "/api/runs") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    sendJson(res, 200, { runs: ctx.store.listPollRuns(limit) });
    return true;
  }
  if (route === "/api/run") {
    const id = Number(url.searchParams.get("id"));
    if (!id) sendJson(res, 400, { error: "id required" });
    else
      sendJson(res, 200, {
        run: ctx.store.getRun(id),
        entries: ctx.store.listActivityForRun(id),
        changes: ctx.store.listRunEvents(id)
      });
    return true;
  }
  sendJson(res, 404, { error: "not found" });
  return true;
}

// server/static.ts
import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path2 from "node:path";
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function serveStatic(res, distDir, route) {
  const rel = route === "/" ? "index.html" : route.replace(/^\/+/, "");
  const target = path2.join(distDir, rel);
  if (!target.startsWith(distDir) || !await exists(target)) {
    return serveIndex(res, distDir);
  }
  const body = await readFile(target);
  res.statusCode = 200;
  res.setHeader("Content-Type", CONTENT_TYPES[path2.extname(target)] || "application/octet-stream");
  res.end(body);
}
async function serveIndex(res, distDir) {
  try {
    const html = await readFile(path2.join(distDir, "index.html"));
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  } catch {
    res.statusCode = 500;
    res.end("Argus client not built. Run `npm run build`.");
  }
}

// server/server.ts
var STABLE_PORT_BASE = 48200;
var STABLE_PORT_SPAN = 1e3;
function stablePort(instanceId) {
  let hash = 0;
  for (const ch of instanceId) hash = hash * 31 + ch.charCodeAt(0) | 0;
  return STABLE_PORT_BASE + Math.abs(hash) % STABLE_PORT_SPAN;
}
async function startServer(instance, ctx) {
  const server = createServer(async (req, res) => {
    try {
      if (await handleApi(req, res, ctx)) return;
      if (req.method === "GET") {
        const route = new URL(req.url || "/", "http://127.0.0.1").pathname;
        return await serveStatic(res, ctx.distDir, route);
      }
      res.statusCode = 404;
      res.end();
    } catch (err) {
      log(`http error: ${err.message}`, "error");
      res.statusCode = 500;
      res.end();
    }
  });
  const port = stablePort(instance.instanceId);
  await new Promise((resolve) => {
    server.once("error", () => server.listen(0, "127.0.0.1", resolve));
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  instance.server = server;
  instance.url = `http://127.0.0.1:${boundPort}/`;
}
async function stopInstance(instance) {
  if (!instance.server) return;
  await new Promise((resolve) => instance.server.close(() => resolve()));
  instance.server = null;
}
function startIngestServer(ctx, port) {
  const server = createServer(async (req, res) => {
    try {
      if (await handleApi(req, res, ctx)) return;
      res.statusCode = 404;
      res.end();
    } catch (err) {
      log(`ingest http error: ${err.message}`, "error");
      res.statusCode = 500;
      res.end();
    }
  });
  let bound = false;
  let watch = null;
  const attempt = () => new Promise((resolve) => {
    const onError = () => resolve(false);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(true);
    });
  });
  const tryBind = async () => {
    if (bound) return;
    if (await attempt()) {
      bound = true;
      if (watch) {
        clearInterval(watch);
        watch = null;
      }
      log(`ingest server listening on 127.0.0.1:${port}`);
    }
  };
  void tryBind().then(() => {
    if (!bound) {
      log(`ingest port ${port} owned by another host; watching to reclaim if it frees`);
      watch = setInterval(() => void tryBind(), 5e3);
    }
  });
  return {
    close: () => {
      if (watch) {
        clearInterval(watch);
        watch = null;
      }
      if (bound) server.close();
    }
  };
}

// server/config.ts
function defaultConfig() {
  const [startHour, endHour] = parseRange(process.env.ARGUS_WORK_HOURS, 9, 17);
  const [dayStart, dayEnd] = parseRange(process.env.ARGUS_WORK_DAYS, 1, 5);
  return {
    me: process.env.ARGUS_ME ?? null,
    avatarUrl: process.env.ARGUS_AVATAR_URL ?? "",
    orgUrl: process.env.ARGUS_ORG_URL ?? "https://dev.azure.com/worldwidelearning",
    orgSlug: process.env.ARGUS_ORG_SLUG ?? "worldwidelearning",
    project: process.env.ARGUS_PROJECT ?? "LPE",
    teamPatterns: splitList(process.env.ARGUS_TEAM_PATTERNS ?? "*Content Lifecycle Engg*,*ASN UI stewards*"),
    teamLabels: {
      "[TEAM FOUNDATION]\\ASN UI stewards": "stewards",
      "[TEAM FOUNDATION]\\MCAPS E&O WWL LPT - Content Lifecycle Engg": "content FTE"
    },
    periods: [],
    reviewSkillName: process.env.ARGUS_REVIEW_SKILL ?? "pr-review",
    deployWindowDays: Number(process.env.ARGUS_DEPLOY_WINDOW_DAYS ?? 14),
    // Seeded repo -> Official build-pipeline definition id, for deploy tracking.
    // Update when a tracked repo gains or loses a deploy pipeline. LPE-specific.
    repoPipelines: {
      "LPE.UI": 4573,
      "LPE.Starfleet.ContentService": 4686,
      "LPE.AdminConsole": 4553,
      "LPE.AdminService": 4544,
      "LPE.Starfleet.ContentRecommendations": 4652,
      "LPE.FeatureFlags": 4594
    },
    recencyDays: Number(process.env.ARGUS_RECENCY_DAYS ?? 7),
    retentionDays: Number(process.env.ARGUS_LOG_RETENTION_DAYS ?? 2),
    workStartHour: startHour,
    workEndHour: endHour,
    workDays: inclusiveRange(dayStart, dayEnd)
  };
}
function mergeConfig(base, overrides) {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}
function parseRange(value, defA, defB) {
  const m = value?.match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [defA, defB];
}
function inclusiveRange(a, b2) {
  const out = [];
  for (let i = a; i <= b2; i++) out.push(i);
  return out;
}
function splitList(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// server/ado/ownership.ts
function classifyOwnership(pr, me2, teamPatterns) {
  const reviewers = pr.reviewers ?? [];
  const teams = [];
  const teamVotes = [];
  const otherVotes = [];
  let directReviewer = false;
  let myVote = 0;
  for (const r of reviewers) {
    const vote = r.vote ?? 0;
    if (r.uniqueName === me2) {
      directReviewer = true;
      myVote = vote;
    }
    if (r.isContainer && r.displayName) {
      for (const pat of teamPatterns) {
        if (matchGlob(r.displayName, pat)) {
          teams.push(r.displayName);
          teamVotes.push(vote);
          break;
        }
      }
    } else if (!r.isContainer && r.uniqueName !== me2 && r.displayName && vote !== 0) {
      otherVotes.push({ name: r.displayName, vote });
    }
  }
  const authored = pr.createdBy?.uniqueName === me2;
  const role = authored ? "author" : directReviewer ? "reviewer" : teams.length ? "team" : null;
  let reviewState = null;
  if (role === "reviewer") {
    reviewState = voteToState(myVote);
  } else if (role === "team") {
    const allTeamsApproved = teamVotes.length > 0 && teamVotes.every((v) => v === 10 || v === 5);
    if (allTeamsApproved) {
      reviewState = "covered";
    } else if (teamVotes.includes(-10)) {
      reviewState = "rejected";
    } else if (teamVotes.includes(-5)) {
      reviewState = "waiting";
    } else {
      reviewState = "needs";
    }
  }
  return { role, teams, reviewState, otherVotes };
}
var voteToState = (v) => v === -10 ? "rejected" : v === -5 ? "waiting" : v === 10 ? "approved" : v === 5 ? "suggestions" : "needs";
function matchGlob(value, pattern) {
  const rx = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$", "i");
  return rx.test(value);
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// server/ado/authorMeta.ts
var RESOLVED_THREAD = /* @__PURE__ */ new Set(["fixed", "wontfix", "closed", "bydesign"]);
async function fetchAuthorMeta(pr, orgUrl) {
  const meta = {
    completable: false,
    blockers: [],
    activeComments: 0,
    resolvedComments: 0,
    mergeStatus: pr.mergeStatus
  };
  try {
    const policies = await listPrPolicies(orgUrl, pr.number) ?? [];
    meta.blockers = policies.filter((p) => p.configuration?.isBlocking && p.status !== "approved" && p.status !== "notApplicable").map((p) => p.configuration?.type?.displayName ?? "policy").filter((name, i, arr) => arr.indexOf(name) === i);
    meta.completable = meta.blockers.length === 0 && !pr.isDraft && pr.mergeStatus === "succeeded";
  } catch {
  }
  try {
    if (pr.repoId) {
      const threads = await fetchPrThreads(orgUrl, pr.project, pr.repoId, pr.number);
      const real = threads.filter(
        (t) => !t.isDeleted && (t.comments ?? []).some((c) => c.commentType !== "system")
      );
      meta.resolvedComments = real.filter((t) => RESOLVED_THREAD.has((t.status ?? "").toLowerCase())).length;
      meta.activeComments = real.length - meta.resolvedComments;
    }
  } catch {
  }
  return meta;
}

// server/ado/pipelines.ts
var FETCH_TIMEOUT_MS = 2e4;
async function adoGet(url) {
  const token = await adoAccessToken();
  const ctrl = new AbortController();
  const timer2 = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ADO GET ${res.status} ${res.statusText} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer2);
  }
}
function orgBase(orgSlug, project) {
  return `https://dev.azure.com/${orgSlug}/${encodeURIComponent(project)}/_apis`;
}
var ENV_MATCHERS = {
  dev: { include: ["dev"], require: ["deploy", "release"], exclude: ["pre-deploy", "validation", "apply tag", "tag", "buddy"] },
  ppe: { include: ["ppe"], require: ["deploy", "release"], exclude: ["pre-deploy", "validation", "apply tag", "tag"] },
  prod: { include: ["prod"], require: ["deploy", "release"], exclude: ["pre-deploy", "validation", "apply tag", "tag"] }
};
function matchEnvStage(name, m) {
  const n = (name || "").toLowerCase();
  if (!m.include.some((k) => n.includes(k))) return false;
  if (m.require.length && !m.require.some((k) => n.includes(k))) return false;
  if (m.exclude.some((k) => n.includes(k))) return false;
  return true;
}
var SUCCESSISH = /* @__PURE__ */ new Set(["succeeded", "succeededwithissues", "partiallysucceeded"]);
async function buildForCommit(orgSlug, project, defId, commit, mergedAtMs) {
  const minTime = new Date(mergedAtMs - 24 * 60 * 60 * 1e3).toISOString();
  const params = new URLSearchParams({
    "api-version": "7.1",
    definitions: String(defId),
    minTime,
    maxBuildsPerDefinition: "75",
    queryOrder: "queueTimeAscending"
  });
  const { value } = await adoGet(`${orgBase(orgSlug, project)}/build/builds?${params}`);
  return (value ?? []).find((b2) => b2.sourceVersion === commit) ?? null;
}
async function stagesFor(orgSlug, project, buildId) {
  const { records } = await adoGet(
    `${orgBase(orgSlug, project)}/build/builds/${buildId}/timeline?api-version=7.1`
  );
  return (records ?? []).filter((r) => r.type === "Stage");
}
function envState(stages, env) {
  const st = stages.find((s) => matchEnvStage(s.name ?? "", ENV_MATCHERS[env]));
  if (!st) return null;
  return { state: st.state ?? null, result: st.result ?? null, finishedAt: st.finishTime ?? null };
}
async function resolveDeploy(orgSlug, project, repoPipelines, repo, mergeCommit, mergedAtMs) {
  const empty = { found: false, reason: null, buildId: null, buildNumber: null, buildUrl: null, dev: null, ppe: null, prod: null, terminal: false };
  const defId = repoPipelines[repo];
  if (!defId) return { ...empty, reason: "no-pipeline", terminal: true };
  const build = await buildForCommit(orgSlug, project, defId, mergeCommit, mergedAtMs);
  if (!build) {
    const stale = Date.now() - mergedAtMs > 60 * 60 * 1e3;
    return { ...empty, reason: stale ? "no-build" : null, terminal: stale };
  }
  const stages = await stagesFor(orgSlug, project, build.id);
  const dev = envState(stages, "dev");
  const ppe = envState(stages, "ppe");
  const prod = envState(stages, "prod");
  const prodDone = !!prod && (prod.state === "completed" || SUCCESSISH.has((prod.result ?? "").toLowerCase()));
  return {
    found: true,
    reason: null,
    buildId: build.id,
    buildNumber: build.buildNumber ?? null,
    buildUrl: `https://dev.azure.com/${orgSlug}/${encodeURIComponent(project)}/_build/results?buildId=${build.id}&view=results`,
    dev,
    ppe,
    prod,
    terminal: prodDone
  };
}

// server/ado/reconcile.ts
function reconcile(currents, snapshots, opts) {
  const nowIso = new Date(opts.nowMs).toISOString();
  const items = [];
  const stats = {
    mine: currents.length,
    dismissed: 0,
    newRecent: 0,
    newStale: 0,
    changed: 0,
    unchanged: 0
  };
  for (const c of currents) {
    const snap = snapshots.get(c.canonical);
    if (snap?.dismissed) {
      stats.dismissed += 1;
      continue;
    }
    const votes = Object.fromEntries(c.reviewers.map((r) => [r.id, r.vote]));
    if (!snap) {
      if (opts.nowMs - Date.parse(c.createdAt) > opts.recencyDays * 864e5) {
        stats.newStale += 1;
        continue;
      }
      stats.newRecent += 1;
      items.push({
        upsert: toUpsert(c),
        isAdd: true,
        lane: suggestLane(c),
        events: [{ canonical: c.canonical, type: "added", ts: nowIso }],
        votes
      });
      continue;
    }
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
function diffEvents(c, snap, votes, ts, me2) {
  const events = [];
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
      if (m?.isContainer) continue;
      events.push({
        canonical: c.canonical,
        type: "vote_changed",
        payload: { reviewer: id, name: m?.displayName ?? null, vote, mine: !!(me2 && m?.uniqueName === me2) },
        ts
      });
    }
  }
  return events;
}
function toUpsert(c) {
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
    lastCommitAt: c.createdAt,
    // proxy; the bulk list carries no commit time
    prCreatedAt: c.createdAt,
    sourceBranch: c.sourceBranch,
    targetBranch: c.targetBranch
  };
}
function suggestLane(_c) {
  return "review";
}

// server/ado/poller.ts
var me = null;
var whoamiCache = null;
var authOk = true;
var inFlight = null;
var currentRunId = null;
var lastRunAt = null;
var lastSummary = null;
var lastError = null;
var timer = null;
function getPollerStatus() {
  return { me, authOk, running: !!inFlight, currentRunId, lastRunAt, lastSummary, lastError };
}
function reconcileOnce(ctx) {
  if (inFlight) return inFlight;
  inFlight = runReconcile(ctx).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
async function runReconcile(ctx) {
  const cfg = ctx.getConfig();
  const runId = ctx.store.startPollRun();
  currentRunId = runId;
  const note = (level, msg, data) => ctx.store.recordActivity(level, msg, data, runId);
  try {
    note("info", "reconcile started");
    let identity = cfg.me;
    if (!identity) {
      if (!whoamiCache) {
        note("info", "resolving identity via az\u2026");
        whoamiCache = await whoami();
      }
      identity = whoamiCache;
      const overrides = ctx.store.getConfigOverrides();
      if (!overrides.me) ctx.store.saveConfigOverrides({ ...overrides, me: identity });
    }
    me = identity;
    note("info", `identity: ${identity}`);
    note("info", `listing active PRs in ${cfg.project}\u2026`);
    const raw = await listActivePrs(cfg.orgUrl, cfg.project);
    authOk = true;
    note("info", `found ${raw?.length ?? 0} active PRs in ${cfg.project}`);
    const mine = [];
    for (const p of raw ?? []) {
      const own = classifyOwnership(p, identity, cfg.teamPatterns);
      if (own.role) mine.push(normalizePr(p, cfg.orgSlug, cfg.project, own));
    }
    note("info", `matched ${mine.length} as mine (author, reviewer, or team)`);
    const seenTeams = /* @__PURE__ */ new Set();
    for (const p of raw ?? []) {
      for (const r of p.reviewers ?? []) {
        if (r.isContainer && r.displayName) seenTeams.add(r.displayName);
      }
    }
    if (seenTeams.size) ctx.store.addSeenTeams([...seenTeams]);
    const snapshots = ctx.store.listSnapshots();
    const plan = reconcile(mine, snapshots, { recencyDays: cfg.recencyDays, nowMs: Date.now(), me: identity });
    const s = plan.stats;
    note("info", `${s.changed + s.unchanged} already tracked`, { changed: s.changed, unchanged: s.unchanged });
    if (s.newStale) note("info", `skipped ${s.newStale} untracked older than ${cfg.recencyDays}d`);
    if (s.dismissed) note("info", `skipped ${s.dismissed} dismissed`);
    if (s.newRecent) note("info", `adding ${s.newRecent} new PR(s)`);
    const applied = ctx.store.applyPlan(plan, runId);
    for (const m of mine)
      ctx.store.setOwnership(m.canonical, m.role, m.teams, m.reviewState, m.description, m.isVendor, m.otherVotes);
    const authored = mine.filter((m) => m.role === "author");
    if (authored.length) {
      note("info", `enriching ${authored.length} authored PR(s) with policy + comments`);
      for (const m of authored) ctx.store.setAuthorMeta(m.canonical, await fetchAuthorMeta(m, cfg.orgUrl));
    }
    if (applied.events) {
      note("info", `recorded ${applied.events} event(s)`, { added: applied.added, updated: applied.updated });
    }
    const needAuthor = ctx.store.prsMissingAuthor(50);
    if (needAuthor.length) {
      note("info", `backfilling author on ${needAuthor.length} migrated PR(s)`);
      for (const p of needAuthor) {
        const raw2 = await showPr(p.number, cfg.orgUrl);
        const name = raw2?.createdBy?.displayName;
        if (name) ctx.store.setAuthor(p.canonical, name);
      }
    }
    const needComments = ctx.store.prsNeedingCommentCount();
    if (needComments.length) {
      note("info", `counting my comments on ${needComments.length} reviewed PR(s)`);
      for (const p of needComments) {
        try {
          const threads = await fetchPrThreads(cfg.orgUrl, p.project, p.repo, p.number);
          let n = 0;
          for (const t of threads) for (const c of t.comments ?? []) if (c.commentType !== "system" && c.author?.uniqueName === identity) n++;
          ctx.store.setMyComments(p.canonical, n);
        } catch {
        }
      }
    }
    const newPrs = new Set(plan.items.filter((item) => item.isAdd).map((item) => item.upsert.canonical));
    const needFiles = ctx.store.prsNeedingFileCount(20, newPrs);
    if (needFiles.length) {
      note("info", `sizing ${needFiles.length} PR(s)`);
      for (const p of needFiles) {
        try {
          const count = await prChangedFileCount(cfg.orgUrl, cfg.project, p.repo, p.targetBranch, p.sourceBranch);
          if (count !== null) ctx.store.setChangedFiles(p.canonical, count, p.sha);
        } catch {
        }
      }
    }
    note("info", "checking for merged/abandoned PRs\u2026");
    const { closed } = await closeDeparted(ctx.store, cfg.orgUrl, mine.map((m) => m.canonical), snapshots, runId);
    note("info", closed ? `closed ${closed} departed PR(s)` : "no departed PRs closed");
    const deployRepos = Object.keys(cfg.repoPipelines);
    const needMerge = ctx.store.prsNeedingMergeInfo(cfg.deployWindowDays, deployRepos);
    for (const p of needMerge) {
      const raw2 = await showPr(p.number, cfg.orgUrl);
      if (raw2?.lastMergeCommit?.commitId) ctx.store.setMergeInfo(p.canonical, raw2.lastMergeCommit.commitId, raw2.closedDate ?? null);
    }
    const needDeploy = ctx.store.prsNeedingDeploy(cfg.deployWindowDays, deployRepos);
    if (needDeploy.length) {
      note("info", `resolving deploys for ${needDeploy.length} merged PR(s)`);
      for (const p of needDeploy) {
        try {
          const deploy = await resolveDeploy(cfg.orgSlug, p.project, cfg.repoPipelines, p.repo, p.mergeCommit, Date.parse(p.mergedAt));
          ctx.store.setDeploy(p.canonical, deploy);
        } catch {
        }
      }
    }
    const tracked = ctx.store.countTracked();
    note("info", `queue now ${tracked} tracked`);
    lastSummary = { mine: mine.length, tracked, ...applied, closed };
    lastRunAt = (/* @__PURE__ */ new Date()).toISOString();
    lastError = null;
    ctx.store.finishPollRun(runId, { ok: true, ...lastSummary });
    note("info", "reconcile done", { ...lastSummary });
    ctx.store.pruneLogs(cfg.retentionDays);
    return lastSummary;
  } catch (err) {
    lastError = err.message;
    if (err instanceof AdoError) {
      authOk = false;
      whoamiCache = null;
    }
    ctx.store.finishPollRun(runId, { ok: false, error: lastError });
    note("error", `reconcile failed: ${lastError}`);
    return null;
  } finally {
    currentRunId = null;
  }
}
async function closeDeparted(store2, orgUrl, mineCanonicals, snapshots, runId) {
  const mineSet = new Set(mineCanonicals);
  let closed = 0;
  const archivable = [];
  for (const [canonical, snap] of snapshots) {
    if (snap.state === "closed" || snap.dismissed || mineSet.has(canonical)) continue;
    const id = numberFromCanonical(canonical);
    const pr = id ? await showPr(id, orgUrl) : null;
    if (pr && (pr.status === "completed" || pr.status === "abandoned")) {
      const rec = store2.getPr(canonical);
      store2.markClosed(canonical, pr.status, void 0, runId);
      if (pr.status === "completed" && pr.lastMergeCommit?.commitId) {
        store2.setMergeInfo(canonical, pr.lastMergeCommit.commitId, pr.closedDate ?? null);
      }
      closed += 1;
      if (rec?.reviewSessionId) {
        archivable.push({ repo: rec.repo, number: rec.number, status: pr.status, sessionId: rec.reviewSessionId });
      }
    }
  }
  return { closed, archivable };
}
function numberFromCanonical(canonical) {
  const m = canonical.match(/pullrequest\/(\d+)/);
  return m ? Number(m[1]) : null;
}
async function resolveIdentity(ctx) {
  const cfg = ctx.getConfig();
  if (cfg.me) return cfg.me;
  if (!whoamiCache) whoamiCache = await whoami();
  return whoamiCache;
}
async function refreshPr(ctx, canonical) {
  const cfg = ctx.getConfig();
  const id = numberFromCanonical(canonical);
  if (!id) return;
  const raw = await showPr(id, cfg.orgUrl);
  if (!raw) return;
  if (raw.status === "completed" || raw.status === "abandoned") {
    ctx.store.markClosed(canonical, raw.status);
    return;
  }
  const identity = await resolveIdentity(ctx);
  const own = classifyOwnership(raw, identity, cfg.teamPatterns);
  const norm = normalizePr(raw, cfg.orgSlug, cfg.project, own);
  const changedFiles = await prChangedFileCount(
    cfg.orgUrl,
    norm.project,
    norm.repo,
    norm.targetBranch,
    norm.sourceBranch
  );
  if (changedFiles === null) throw new AdoError(`Unable to count changed files for ${norm.repo} #${norm.number}`);
  ctx.store.upsertPr({
    canonical: norm.canonical,
    org: norm.org,
    project: norm.project,
    repo: norm.repo,
    number: norm.number,
    title: norm.title,
    description: norm.description,
    author: norm.author,
    isVendor: norm.isVendor,
    role: norm.role,
    teams: norm.teams,
    isDraft: norm.isDraft,
    lastCommitSha: norm.sha,
    lastCommitAt: norm.createdAt,
    prCreatedAt: norm.createdAt,
    sourceBranch: norm.sourceBranch,
    targetBranch: norm.targetBranch
  });
  ctx.store.setOwnership(canonical, own.role ?? "reviewer", own.teams, own.reviewState, norm.description, norm.isVendor, own.otherVotes);
  ctx.store.setDescription(canonical, norm.description);
  ctx.store.setChangedFiles(canonical, changedFiles, norm.sha);
}
async function trackByNumber(ctx, id) {
  const cfg = ctx.getConfig();
  const raw = await showPr(id, cfg.orgUrl);
  if (!raw) return { ok: false, reason: "not-found" };
  if (raw.status === "completed" || raw.status === "abandoned") return { ok: false, reason: "closed" };
  const identity = await resolveIdentity(ctx);
  const own = classifyOwnership(raw, identity, cfg.teamPatterns);
  const role = own.role ?? "reviewer";
  const reviewState = own.role === null ? own.reviewState ?? "needs" : own.reviewState;
  const effective = { ...own, role, reviewState };
  const norm = normalizePr(raw, cfg.orgSlug, cfg.project, effective);
  const existed = !!ctx.store.getPr(norm.canonical);
  ctx.store.upsertPr({
    canonical: norm.canonical,
    org: norm.org,
    project: norm.project,
    repo: norm.repo,
    number: norm.number,
    title: norm.title,
    description: norm.description,
    author: norm.author,
    isVendor: norm.isVendor,
    role: norm.role,
    teams: norm.teams,
    isDraft: norm.isDraft,
    lastCommitSha: norm.sha,
    lastCommitAt: norm.createdAt,
    prCreatedAt: norm.createdAt,
    sourceBranch: norm.sourceBranch,
    targetBranch: norm.targetBranch
  });
  ctx.store.setOwnership(norm.canonical, effective.role, effective.teams, effective.reviewState, norm.description, norm.isVendor, effective.otherVotes);
  ctx.store.setDescription(norm.canonical, norm.description);
  if (!existed) ctx.store.appendEvent(norm.canonical, "added", { source: "manual" });
  return { ok: true, canonical: norm.canonical };
}
function startPoller(ctx) {
  scheduleNext(ctx);
}
function stopPoller() {
  if (timer) clearTimeout(timer);
  timer = null;
}
function scheduleNext(ctx) {
  timer = setTimeout(async () => {
    try {
      if (inWorkHours(/* @__PURE__ */ new Date(), ctx.getConfig())) await reconcileOnce(ctx);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      scheduleNext(ctx);
    }
  }, msUntilNextHalfHour());
}
function msUntilNextHalfHour(now2 = /* @__PURE__ */ new Date()) {
  const next = new Date(now2);
  next.setSeconds(0, 0);
  next.setMinutes(now2.getMinutes() < 30 ? 30 : 60);
  return next.getTime() - now2.getTime();
}
function inWorkHours(date, cfg) {
  return cfg.workDays.includes(date.getDay()) && date.getHours() >= cfg.workStartHour && date.getHours() < cfg.workEndHour;
}

// server/extension.ts
var __dirname = path3.dirname(fileURLToPath(import.meta.url));
var DIST_DIR = path3.join(__dirname, "dist");
var BOOT_AT = (/* @__PURE__ */ new Date()).toISOString();
var ONEDRIVE_ROOT = process.env.OneDriveCommercial || process.env.OneDrive;
var DB_FILE = process.env.ARGUS_DB_FILE || (ONEDRIVE_ROOT ? path3.join(ONEDRIVE_ROOT, "Desktop", "argus.db") : path3.join(__dirname, "data", "argus.db"));
var INVOLVEMENT_FILE = process.env.ARGUS_INVOLVEMENT_FILE;
var LEGACY_STATE_FILE = process.env.ARGUS_LEGACY_STATE_FILE;
var store = new ArgusStore(DB_FILE);
var migrated = INVOLVEMENT_FILE ? store.importInvolvement(INVOLVEMENT_FILE) : { imported: 0 };
var getConfig = () => mergeConfig(defaultConfig(), store.getConfigOverrides());
var saveConfig = (overrides) => {
  store.saveConfigOverrides(overrides);
  return getConfig();
};
var legacyImported = LEGACY_STATE_FILE ? store.importLegacyState(LEGACY_STATE_FILE, getConfig().teamPatterns) : { imported: 0 };
if (!store.isSetupComplete() && (store.counts().prs > 0 || Object.keys(store.getConfigOverrides()).length > 0)) {
  store.markSetupComplete();
}
var pollerCtx = { store, getConfig };
var instances = /* @__PURE__ */ new Map();
var pollerRunning = false;
async function countMyComments(canonical) {
  try {
    const cfg = getConfig();
    const pr = store.getPr(canonical);
    if (!cfg.me || !pr) return;
    const threads = await fetchPrThreads(cfg.orgUrl, pr.project, pr.repo, pr.number);
    let n = 0;
    for (const t of threads) for (const c of t.comments ?? []) if (c.commentType !== "system" && c.author?.uniqueName === cfg.me) n++;
    store.setMyComments(canonical, n);
  } catch {
  }
}
function doRecordReview(canonical, opts) {
  store.recordReview(canonical, opts);
  void countMyComments(canonical);
}
function installBaselineSkill() {
  const src = path3.join(__dirname, "skills", "pr-review");
  if (!existsSync(src)) return { installed: false, reason: "bundled skill not found" };
  const skillsRoot = path3.join(process.env.COPILOT_HOME || path3.join(homedir(), ".copilot"), "skills");
  const dest = path3.join(skillsRoot, "pr-review");
  if (existsSync(dest)) return { installed: false, reason: "a pr-review skill already exists; left it untouched" };
  try {
    cpSync(src, dest, { recursive: true });
    return { installed: true };
  } catch (err) {
    return { installed: false, reason: err.message };
  }
}
var serverCtx = () => ({
  store,
  bootAt: BOOT_AT,
  migrated,
  distDir: DIST_DIR,
  reconcile: () => reconcileOnce(pollerCtx),
  refreshPr: (canonical) => refreshPr(pollerCtx, canonical),
  trackPr: (number) => trackByNumber(pollerCtx, number),
  recordReview: doRecordReview,
  dispatch: (message) => session2.send(message),
  pollerStatus: getPollerStatus,
  getConfig,
  saveConfig,
  markSetupComplete: () => store.markSetupComplete(),
  installBaselineSkill
});
var session2 = await joinSession({
  canvases: [
    createCanvas({
      id: "argus",
      displayName: "Argus",
      description: "React + TanStack canvas served by its own Node process.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      actions: [
        {
          name: "linkReviewSession",
          description: "Link the child session reviewing a PR so re-reviews can re-engage it. Call after spawning the review session.",
          inputSchema: {
            type: "object",
            properties: { canonical: { type: "string" }, sessionId: { type: "string" } },
            required: ["canonical", "sessionId"],
            additionalProperties: false
          },
          handler: async (ctx) => {
            const { canonical, sessionId } = ctx.input ?? {};
            if (canonical && sessionId) store.setReviewSession(canonical, sessionId);
            return { ok: !!(canonical && sessionId) };
          }
        },
        {
          name: "recordReview",
          description: "Record a review outcome for a PR: the verdict, the reviewed commit sha (for re-push detection), and optionally the session that did it.",
          inputSchema: {
            type: "object",
            properties: {
              canonical: { type: "string" },
              verdict: { type: "string", description: "approved | suggestions | rejected | waiting | reviewed" },
              sha: { type: "string", description: "head commit sha reviewed" },
              sessionId: { type: "string" }
            },
            required: ["canonical"],
            additionalProperties: false
          },
          handler: async (ctx) => {
            const { canonical, verdict, sha, sessionId } = ctx.input ?? {};
            if (!canonical) return { ok: false };
            doRecordReview(canonical, { verdict, sha, sessionId });
            return { ok: true };
          }
        }
      ],
      open: async (ctx) => {
        let instance = instances.get(ctx.instanceId);
        if (!instance) {
          instance = { instanceId: ctx.instanceId, server: null, url: null };
          instances.set(ctx.instanceId, instance);
          await startServer(instance, serverCtx());
        }
        if (!pollerRunning) {
          pollerRunning = true;
          log("argus: canvas opened; starting poller in this host");
          startPoller(pollerCtx);
        }
        return { title: "Argus", url: instance.url };
      },
      onClose: async (ctx) => {
        const instance = instances.get(ctx.instanceId);
        if (!instance) return;
        instances.delete(ctx.instanceId);
        await stopInstance(instance);
        if (instances.size === 0 && pollerRunning) {
          pollerRunning = false;
          log("argus: last canvas closed; stopping poller in this host");
          stopPoller();
        }
      }
    })
  ]
});
setSession(session2);
var INGEST_PORT = Number(process.env.ARGUS_INGEST_PORT ?? 48100);
var ingestServer = startIngestServer(serverCtx(), INGEST_PORT);
log(`argus loaded; store ${JSON.stringify(store.counts())}, migrated ${migrated.imported}, legacy ${legacyImported.imported}`);
var shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`argus shutting down on ${signal}`);
  stopPoller();
  if (ingestServer) ingestServer.close();
  await Promise.race([
    Promise.all([...instances.values()].map(stopInstance)),
    new Promise((resolve) => setTimeout(resolve, 1e3))
  ]);
  store.close();
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
