import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BASE_SCHEMA } from "./schema.ts";

function dump(sql: string): string[] {
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    const rows = db
        .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { type: string; name: string; sql: string }[];
    db.close();
    return rows.map((r) => `${r.type} ${r.name}: ${r.sql}`);
}

test("BASE_SCHEMA creates the base tables and indexes", () => {
    const names = dump(BASE_SCHEMA).map((r) => r.split(":")[0]);
    assert.deepEqual(names, [
        "table activity_log",
        "table automatic_review_tokens",
        "table changes_read",
        "index idx_activity_ts",
        "index idx_events_canonical",
        "index idx_events_ts",
        "index idx_pollruns_started",
        "table poll_runs",
        "table pr_events",
        "table prs",
        "table settings",
    ]);
});

test("BASE_SCHEMA can run twice", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(BASE_SCHEMA);
    db.exec(BASE_SCHEMA);
    db.close();
});
