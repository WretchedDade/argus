import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";
import * as activity from "./activity.ts";

function open(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    for (const m of migrations) m.up(db);
    return db;
}

test("a poll run is recorded and finished", () => {
    const db = open();
    const id = activity.startPollRun(db, "2026-01-01T00:00:00.000Z");
    activity.finishPollRun(db, id, { ok: true, mine: 2, added: 1 });
    const run = activity.getRun(db, id);
    assert.equal(run?.ok, true);
    assert.equal(run?.mine, 2);
    assert.equal(run?.tracked, null);
    assert.equal(activity.listPollRuns(db).length, 1);
    db.close();
});

test("activity lines are listed in order and per run", () => {
    const db = open();
    const id = activity.startPollRun(db);
    activity.recordActivity(db, "info", "one", { a: 1 }, id);
    activity.recordActivity(db, "info", "two");
    assert.deepEqual(
        activity.listActivity(db).map((e) => e.msg),
        ["one", "two"],
    );
    assert.deepEqual(
        activity.listActivityForRun(db, id).map((e) => e.data),
        [{ a: 1 }],
    );
    db.close();
});

test("the poll lease blocks another owner until it expires", () => {
    const db = open();
    assert.equal(activity.acquirePollLease(db, "a", 1000, 0), true);
    assert.equal(activity.acquirePollLease(db, "b", 1000, 500), false);
    assert.equal(activity.acquirePollLease(db, "b", 1000, 1000), true);
    activity.releasePollLease(db, "b");
    assert.equal(activity.acquirePollLease(db, "a", 1000, 1001), true);
    db.close();
});

test("pruneLogs drops old rows only", () => {
    const db = open();
    activity.startPollRun(db, "2000-01-01T00:00:00.000Z");
    activity.startPollRun(db);
    activity.pruneLogs(db, 30);
    assert.equal(activity.listPollRuns(db).length, 1);
    db.close();
});
