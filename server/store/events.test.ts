import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";
import * as events from "./events.ts";
import { describe, it } from "vitest";

describe("server/store/events", () => {
    function open(): DatabaseSync {
        const db = new DatabaseSync(":memory:");
        for (const m of migrations) m.up(db);
        return db;
    }

    function addPr(
        db: DatabaseSync,
        canonical: string,
        role = "reviewer",
    ): void {
        db.prepare(
            `INSERT INTO prs (canonical, org, project, repo, number, title, state, role, added_at, updated_at)
         VALUES (?, 'o', 'p', 'r', 1, 't', 'active', ?, 'x', 'x')`,
        ).run(canonical, role);
    }

    it("events are appended and listed in order", () => {
        const db = open();
        events.appendEvent(
            db,
            "c",
            "added",
            { a: 1 },
            "2026-01-01T00:00:00.000Z",
        );
        events.appendEvent(
            db,
            "c",
            "closed",
            undefined,
            "2026-01-02T00:00:00.000Z",
        );
        const list = events.listEvents(db, "c");
        assert.deepEqual(
            list.map((e) => e.type),
            ["added", "closed"],
        );
        assert.deepEqual(list[0].payload, { a: 1 });
        db.close();
    });

    it("the unread feed hides read changes", () => {
        const db = open();
        addPr(db, "c");
        events.setChangesSeenAt(db, "2000-01-01T00:00:00.000Z");
        events.appendEvent(db, "c", "added");
        events.appendEvent(db, "c", "lane_changed");
        assert.equal(events.listUnreadChanges(db).length, 1);
        events.markChangesReadForPr(db, "c");
        assert.equal(events.listUnreadChanges(db).length, 0);
        db.close();
    });

    it("markAllChangesRead moves the watermark", () => {
        const db = open();
        addPr(db, "c");
        events.setChangesSeenAt(db, "2000-01-01T00:00:00.000Z");
        events.appendEvent(
            db,
            "c",
            "added",
            undefined,
            "2001-01-01T00:00:00.000Z",
        );
        assert.equal(events.listUnreadChanges(db).length, 1);
        events.markAllChangesRead(db);
        assert.equal(events.listUnreadChanges(db).length, 0);
        db.close();
    });

    it("listPrActivity relabels authored events inside the window", () => {
        const db = open();
        addPr(db, "c", "author");
        events.appendEvent(
            db,
            "c",
            "added",
            undefined,
            "2026-01-01T12:00:00.000Z",
        );
        events.appendEvent(
            db,
            "c",
            "lane_changed",
            undefined,
            "2026-01-01T12:00:00.000Z",
        );
        const from = Date.parse("2026-01-01T00:00:00.000Z");
        const rows = events.listPrActivity(db, from, from + 86_400_000);
        assert.deepEqual(
            rows.map((r) => r.type),
            ["authored_opened"],
        );
        assert.deepEqual(events.listPrActivity(db, 0, from), []);
        db.close();
    });
});
