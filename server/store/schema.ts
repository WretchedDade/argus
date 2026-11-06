// The first versioned schema, one string per table. Never edit it: add a migration instead.

export const PRS_TABLE = `
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
`;

export const PR_EVENTS_TABLE = `
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
`;

// Operational logs, pruned by age (see pruneLogs). poll_runs is one row per
// reconcile cycle; activity_log is the granular trace within/around a run.
export const POLL_RUNS_TABLE = `
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
`;

export const ACTIVITY_LOG_TABLE = `
CREATE TABLE IF NOT EXISTS activity_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  level  TEXT NOT NULL,
  msg    TEXT NOT NULL,
  data   TEXT,
  run_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts);
`;

export const SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Per-event "read" marks for the notifications bell. An event is unread when it
// is a surfaced change, newer than the changes_seen_at watermark, and absent here.
export const CHANGES_READ_TABLE = `
CREATE TABLE IF NOT EXISTS changes_read (event_id INTEGER PRIMARY KEY, read_at TEXT NOT NULL);
`;

// One-time tokens for automatic reviews. Stored in the shared DB so every host
// that serves the ingest port sees the tokens issued by any other host.
export const AUTOMATIC_REVIEW_TOKENS_TABLE = `
CREATE TABLE IF NOT EXISTS automatic_review_tokens (
  canonical TEXT NOT NULL,
  token TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  PRIMARY KEY (canonical, token)
);
`;

export const BASE_SCHEMA = [
    PRS_TABLE,
    PR_EVENTS_TABLE,
    POLL_RUNS_TABLE,
    ACTIVITY_LOG_TABLE,
    SETTINGS_TABLE,
    CHANGES_READ_TABLE,
    AUTOMATIC_REVIEW_TOKENS_TABLE,
].join("\n");
