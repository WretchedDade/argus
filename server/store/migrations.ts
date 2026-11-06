import type { DatabaseSync } from "node:sqlite";
import { BASE_SCHEMA } from "./schema.ts";

// Rules for this list:
// 1. Add a new entry at the end. Never edit or reorder a released entry.
// 2. Each entry runs once. `PRAGMA user_version` stores how many have run.
// 3. All pending entries run in one transaction, so a failure changes nothing.
// 4. Keep entries safe for a user who upgrades and keeps their history.
export interface Migration {
    up(db: DatabaseSync): void;
}

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
    {
        // Repo scope policy. `scope_override` is the per-PR choice ('in' | 'out');
        // `out_of_scope` stays as the effective value the board queries read.
        // Existing out-of-scope PRs keep that choice as an override.
        up(db) {
            const cols = db.prepare("PRAGMA table_info(prs)").all() as {
                name: string;
            }[];
            if (!cols.some((c) => c.name === "scope_override"))
                db.exec("ALTER TABLE prs ADD COLUMN scope_override TEXT");
            db.exec(`
UPDATE prs SET scope_override = 'out' WHERE out_of_scope = 1 AND scope_override IS NULL;
CREATE TABLE IF NOT EXISTS repo_scopes (
  repo  TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('in', 'out'))
);`);
        },
    },
    {
        // Older versions stored the PR creation date as the commit time. Clear
        // those values so the poller reads the real commit time from ADO.
        up(db) {
            db.exec(`
UPDATE prs SET last_commit_at = NULL WHERE last_commit_at = pr_created_at;
UPDATE prs SET reviewed_sha_authored_at = NULL WHERE reviewed_sha_authored_at = pr_created_at;`);
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
