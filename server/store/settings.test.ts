import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { BASE_SCHEMA } from "./schema.ts";
import * as settings from "./settings.ts";

function open(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(BASE_SCHEMA);
    return db;
}

test("settings functions work on a bare database handle", () => {
    const db = open();
    assert.equal(settings.isSetupComplete(db), false);
    settings.markSetupComplete(db);
    assert.equal(settings.isSetupComplete(db), true);
    db.close();
});

test("dismissNotice and restoreNotice keep a set of ids", () => {
    const db = open();
    settings.dismissNotice(db, "a");
    settings.dismissNotice(db, "b");
    settings.dismissNotice(db, "a");
    assert.deepEqual(settings.getDismissedNotices(db), ["a", "b"]);
    settings.restoreNotice(db, "a");
    assert.deepEqual(settings.getDismissedNotices(db), ["b"]);
    db.close();
});

test("addSeenTeams merges and sorts names", () => {
    const db = open();
    settings.addSeenTeams(db, ["b", "a"]);
    settings.addSeenTeams(db, ["c", "a"]);
    assert.deepEqual(settings.getSeenTeams(db), ["a", "b", "c"]);
    db.close();
});

test("getUpdateCheck returns null until a check is saved", () => {
    const db = open();
    assert.equal(settings.getUpdateCheck(db), null);
    settings.setUpdateCheck(db, { checkedAt: 5, release: null });
    assert.deepEqual(settings.getUpdateCheck(db), {
        checkedAt: 5,
        release: null,
    });
    db.close();
});
