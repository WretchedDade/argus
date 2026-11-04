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
  reviewers_json    TEXT,
  role              TEXT,
  teams_json        TEXT,
  required_approver_groups_json TEXT,
  review_state      TEXT,
  description       TEXT,
  out_of_scope      INTEGER NOT NULL DEFAULT 0,
  snooze_mode       TEXT,
  reviewed_sha      TEXT,
  reviewed_at       TEXT,
  reviewed_sha_authored_at TEXT,
  my_comments       INTEGER,
  other_comments    INTEGER,
  approvals_json    TEXT,
  author_meta_json  TEXT,
  source_branch     TEXT,
  target_branch     TEXT,
  changed_files     INTEGER,
  changed_files_sha TEXT
);

CREATE TABLE IF NOT EXISTS pr_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical TEXT NOT NULL,
  ts        TEXT NOT NULL,
  type      TEXT NOT NULL,
  payload   TEXT,
  run_id    INTEGER
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
  error       TEXT,
  tracked     INTEGER
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

export const migrations: Migration[] = [
    {
        // The full schema as of the first versioned release. Databases that
        // already have these tables keep their data and just get a version.
        up(db) {
            db.exec(BASE_SCHEMA);
        },
    },
    {
        // One row: the host that may poll now. Hosts share the database file.
        up(db) {
            db.exec(`
CREATE TABLE IF NOT EXISTS poll_lease (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  owner      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);`);
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
