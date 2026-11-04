import type { DatabaseSync } from "node:sqlite";

// Rules for this list:
// 1. Add a new entry at the end. Never edit or reorder a released entry.
// 2. Each entry runs once. `PRAGMA user_version` stores how many have run.
// 3. All pending entries run in one transaction, so a failure changes nothing.
// 4. Keep entries safe for a user who upgrades and keeps their history.
export interface Migration {
    up(db: DatabaseSync): void;
}

const BASE_SCHEMA = `
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

-- One-time tokens for automatic reviews. Stored in the shared DB so every host
-- that serves the ingest port sees the tokens issued by any other host.
CREATE TABLE IF NOT EXISTS automatic_review_tokens (
  canonical TEXT NOT NULL,
  token TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  PRIMARY KEY (canonical, token)
);
`;

// Columns that earlier releases added one by one.
const LEGACY_COLUMNS: [table: string, column: string, type: string][] = [
    ["prs", "reviewers_json", "TEXT"],
    ["pr_events", "run_id", "INTEGER"], // links an event to its poll run
    ["poll_runs", "tracked", "INTEGER"], // queue size at end of run
    ["prs", "role", "TEXT"], // author | reviewer | team
    ["prs", "teams_json", "TEXT"], // matched team display names
    ["prs", "required_approver_groups_json", "TEXT"],
    ["prs", "review_state", "TEXT"], // needs | covered | approved | ...
    ["prs", "description", "TEXT"], // PR description body (for card preview)
    ["prs", "out_of_scope", "INTEGER NOT NULL DEFAULT 0"], // user marked "not my review"
    ["prs", "snooze_mode", "TEXT"], // null | "time" | "fte"
    ["prs", "reviewed_sha", "TEXT"], // commit sha at the time of my recorded review
    ["prs", "reviewed_at", "TEXT"], // when I recorded my verdict (latency end)
    ["prs", "reviewed_sha_authored_at", "TEXT"], // authored date of reviewed_sha (latency start)
    ["prs", "my_comments", "INTEGER"], // # of comments I authored on this PR
    ["prs", "other_comments", "INTEGER"], // # of non-system comments authored by others
    ["prs", "approvals_json", "TEXT"], // individuals who approved (name + vote)
    ["prs", "author_meta_json", "TEXT"], // completability + comment counts for authored PRs
    ["prs", "source_branch", "TEXT"], // PR source branch
    ["prs", "target_branch", "TEXT"], // PR target branch
    ["prs", "changed_files", "INTEGER"], // # of files changed in the PR
    ["prs", "changed_files_sha", "TEXT"], // head sha the file count was computed at
];

// Settings flags from the releases that ran one-time fixes at every start.
const LEGACY_RESET_FLAGS = [
    "changed_files_reset", // the first file-count pass stored 0s
    "changed_files_blob_count_reset", // pre-blob-only counts were inflated
];

function addMissingColumns(db: DatabaseSync): void {
    for (const [table, column, type] of LEGACY_COLUMNS) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
        }[];
        if (!cols.some((c) => c.name === column)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
    }
}

function runLegacyFixes(db: DatabaseSync): void {
    const hasFlag = db.prepare("SELECT 1 FROM settings WHERE key = ?");
    const setFlag = db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    for (const flag of LEGACY_RESET_FLAGS) {
        if (hasFlag.get(flag)) continue;
        db.exec(
            "UPDATE prs SET changed_files = NULL, changed_files_sha = NULL",
        );
        setFlag.run(flag, new Date().toISOString());
    }
    // Backfill reviewed_at from the latest recorded verdict event.
    db.exec(`
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
    // Backfill the reviewed sha's authored date when it is still the head.
    db.exec(`
      UPDATE prs SET reviewed_sha_authored_at = last_commit_at
      WHERE reviewed_sha IS NOT NULL AND reviewed_sha_authored_at IS NULL
        AND reviewed_sha = last_commit_sha AND last_commit_at IS NOT NULL
    `);
}

export const migrations: Migration[] = [
    {
        // The full schema as of the first versioned release. Databases from
        // earlier releases have no version, so this entry also brings them up.
        up(db) {
            db.exec(BASE_SCHEMA);
            addMissingColumns(db);
            runLegacyFixes(db);
        },
    },
];

export function runMigrations(
    db: DatabaseSync,
    list: Migration[] = migrations,
): void {
    // IMMEDIATE takes the write lock first, so a second process waits here and
    // then sees the new version instead of repeating the work.
    db.exec("BEGIN IMMEDIATE");
    try {
        const { user_version: current } = db
            .prepare("PRAGMA user_version")
            .get() as { user_version: number };
        for (let i = current; i < list.length; i++) list[i].up(db);
        if (current < list.length) {
            db.exec(`PRAGMA user_version = ${list.length}`);
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}
