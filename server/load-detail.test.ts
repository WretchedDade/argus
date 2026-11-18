import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ArgusStore } from "./db.ts";
import { describe, it, vi, afterEach, type TestContext } from "vitest";

describe("server/load-detail", () => {
    afterEach(() => vi.useRealTimers());
    it("keeps weekly chart totals consistent with detail rows", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-load-test-"));
        const dbFile = path.join(dir, "argus.db");

        try {
            const monday = new Date();
            monday.setUTCHours(0, 0, 0, 0);
            monday.setUTCDate(
                monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7,
            );
            const at = (day: number, hour: number) =>
                new Date(
                    monday.getTime() + day * 86_400_000 + hour * 3_600_000,
                ).toISOString();
            const weekKey = monday.toISOString().slice(0, 10);
            const canonical = (n: number) =>
                `https://example.test/r/pullrequest/${n}`;

            let store = new ArgusStore(dbFile);
            for (let n = 1; n <= 4; n++) {
                store.upsertPr({
                    canonical: canonical(n),
                    org: "o",
                    project: "p",
                    repo: "r",
                    number: n,
                    title: `PR ${n}`,
                    description: "",
                    author: "a",
                    isVendor: false,
                    role: "reviewer",
                    teams: [],
                    isDraft: false,
                    lastCommitSha: null,
                    lastCommitAt: null,
                    prCreatedAt: null,
                    sourceBranch: null,
                    targetBranch: null,
                });
            }
            store.close();

            const db = new DatabaseSync(dbFile);
            const update = db.prepare(
                "UPDATE prs SET added_at = ?, updated_at = ?, review_state = ?, reviewed_at = ? WHERE canonical = ?",
            );
            update.run(at(0, 9), at(6, 12), "needs", null, canonical(1));
            update.run(
                at(0, 10),
                at(1, 15),
                "approved",
                at(1, 15),
                canonical(2),
            );
            update.run(at(1, 8), at(6, 12), "needs", null, canonical(3));
            update.run(at(4, 20), at(5, 1), "needs", null, canonical(4));
            db.close();

            store = new ArgusStore(dbFile);
            store.appendEvent(
                canonical(2),
                "reviewed",
                { verdict: "approved" },
                at(1, 15),
            );
            store.appendEvent(
                canonical(2),
                "reviewed",
                { verdict: "approved" },
                at(1, 16),
            );
            store.appendEvent(
                canonical(2),
                "reviewed",
                { verdict: "approved" },
                at(2, 10),
            );
            store.appendEvent(canonical(4), "closed", {}, at(5, 1));

            const bucket = store
                .computeInsights(30)
                .load.weekly.find((item) => item.key === weekKey);
            const detail = store.loadWeekDetail(weekKey, 30);
            assert.deepEqual(
                {
                    inflow: detail.arrived.length,
                    throughput: detail.reviewed.length,
                    peak: detail.onPlate.length,
                },
                {
                    inflow: bucket?.inflow,
                    throughput: bucket?.throughput,
                    peak: bucket?.backlog,
                },
            );
            assert.equal(
                store.loadDayDetail(at(1, 0).slice(0, 10), 30).reviewed.length,
                1,
            );
            assert.equal(
                store.loadDayDetail(at(2, 0).slice(0, 10), 30).reviewed.length,
                1,
            );
            assert.equal(
                detail.reviewed.length,
                1,
                "Weekly throughput counts each PR once across repeat reviews.",
            );
            assert.equal(detail.peakDayKey, at(1, 0).slice(0, 10));
            assert.equal(detail.arrived.at(-1)?.dayKey, at(4, 0).slice(0, 10));
            store.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    function loadFixture(t: TestContext, arrivals: string[]) {
        const previousTimezone = process.env.TZ;
        process.env.TZ = "UTC";
        t.onTestFinished(() => {
            if (previousTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = previousTimezone;
        });
        vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(
            Date.parse("2026-11-18T12:00:00Z"),
        );
        const dir = mkdtempSync(path.join(tmpdir(), "argus-load-boundaries-"));
        const file = path.join(dir, "argus.db");
        const store = new ArgusStore(file);
        const db = new DatabaseSync(file);
        t.onTestFinished(() => {
            db.close();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        });
        const canonical = (n: number) => `https://example.test/pr/${n}`;
        for (const [i, addedAt] of arrivals.entries()) {
            store.upsertPr({
                canonical: canonical(i + 1),
                org: "o",
                project: "p",
                repo: "r",
                number: i + 1,
                title: `PR ${i + 1}`,
                description: "",
                author: "a",
                role: "reviewer",
                isVendor: false,
                isDraft: false,
                teams: [],
                lastCommitSha: null,
                lastCommitAt: null,
                prCreatedAt: null,
                sourceBranch: null,
                targetBranch: null,
            });
            db.prepare(
                "UPDATE prs SET added_at = ?, updated_at = ? WHERE canonical = ?",
            ).run(addedAt, "2026-11-18T09:00:00Z", canonical(i + 1));
        }
        return { store, db, canonical };
    }

    it("daily inflow rolls to custom workdays while weekly inflow keeps arrival dates", (t) => {
        const { store } = loadFixture(t, [
            "2026-11-13T15:59:00Z",
            "2026-11-13T16:00:00Z",
            "2026-11-14T10:00:00Z",
            "2026-11-16T16:00:00Z",
            "2026-11-17T10:00:00Z",
        ]);
        const work = { endHour: 16, days: [1, 3, 5] };
        const load = store.computeInsights(30, work).load;
        for (const [day, expected] of [
            ["2026-11-13", [1]],
            ["2026-11-16", [2, 3]],
            ["2026-11-17", []],
            ["2026-11-18", [4, 5]],
        ] as const) {
            const detail = store.loadDayDetail(day, 30, work);
            assert.deepEqual(
                detail.arrived.map((p) => p.number),
                expected,
                day,
            );
            assert.equal(
                load.daily.find((bucket) => bucket.key === day)?.inflow,
                expected.length,
                day,
            );
        }
        for (const [week, expected] of [
            ["2026-11-09", [1, 2, 3]],
            ["2026-11-16", [4, 5]],
        ] as const) {
            const detail = store.loadWeekDetail(week, 30, work);
            assert.deepEqual(
                detail.arrived.map((p) => p.number),
                expected,
                week,
            );
            assert.equal(
                load.weekly.find((bucket) => bucket.key === week)?.inflow,
                expected.length,
                week,
            );
        }
    });

    it("chart and drill-down load agree on verdict, coverage, closure, and stale boundaries", (t) => {
        const { store, db, canonical } = loadFixture(
            t,
            new Array<string>(13).fill("2026-11-13T09:00:00Z"),
        );
        const verdicts = ["approved", "suggestions", "waiting", "rejected"];
        for (const [i, verdict] of verdicts.entries()) {
            db.prepare(
                "UPDATE prs SET review_state = ?, reviewed_at = ? WHERE number = ?",
            ).run(verdict, "2026-11-16T13:00:00Z", i + 1);
        }
        db.exec(`
UPDATE prs SET review_state = 'approved', updated_at = '2026-11-16T13:00:00Z' WHERE number = 5;
UPDATE prs SET review_state = 'covered', updated_at = '2026-11-16T00:00:00Z' WHERE number = 6;
UPDATE prs SET updated_at = '2026-11-15T00:00:00Z' WHERE number = 8;
UPDATE prs SET snooze_mode = 'time', snoozed_until = '2026-11-20T12:00:00Z' WHERE number = 9;
UPDATE prs SET role = 'author' WHERE number = 10;
UPDATE prs SET is_draft = 1 WHERE number = 11;
UPDATE prs SET dismissed = 1 WHERE number = 12;
UPDATE prs SET out_of_scope = 1 WHERE number = 13;
`);
        store.appendEvent(canonical(7), "closed", {}, "2026-11-16T00:00:00Z");
        store.appendEvent(canonical(7), "closed", {}, "2026-11-17T12:00:00Z");
        for (const at of [
            "2026-11-16T13:00:00Z",
            "2026-11-16T14:00:00Z",
            "2026-11-17T10:00:00Z",
        ]) {
            store.appendEvent(
                canonical(1),
                "reviewed",
                { verdict: "approved" },
                at,
            );
        }
        const load = store.computeInsights(1).load;
        for (const [day, expected] of [
            ["2026-11-13", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
            ["2026-11-15", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
            ["2026-11-16", [1, 2, 3, 4, 5, 9]],
            ["2026-11-17", [9]],
            ["2026-11-18", [9]],
        ] as const) {
            const detail = store.loadDayDetail(day, 1);
            assert.deepEqual(
                detail.onPlate.map((p) => p.number),
                expected,
                day,
            );
            if (day === "2026-11-15") continue;
            const bucket = load.daily.find((bucket) => bucket.key === day);
            assert.deepEqual(
                bucket,
                {
                    key: day,
                    inflow: detail.arrived.length,
                    throughput: detail.reviewed.length,
                    backlog: expected.length,
                },
                day,
            );
        }
        for (const week of ["2026-11-09", "2026-11-16"]) {
            const detail = store.loadWeekDetail(week, 1);
            assert.deepEqual(
                load.weekly.find((bucket) => bucket.key === week),
                {
                    key: week,
                    inflow: detail.arrived.length,
                    throughput: detail.reviewed.length,
                    backlog: detail.onPlate.length,
                },
            );
        }
        assert.equal(store.loadDayDetail("2026-11-16", 1).reviewed.length, 1);
        assert.equal(store.loadDayDetail("2026-11-17", 1).reviewed.length, 1);
        assert.equal(store.loadWeekDetail("2026-11-16", 1).reviewed.length, 1);
    });
});
