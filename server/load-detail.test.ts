import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-load-test-"));
const dbFile = path.join(dir, "argus.db");

try {
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
    const at = (day: number, hour: number) =>
        new Date(
            monday.getTime() + day * 86_400_000 + hour * 3_600_000,
        ).toISOString();
    const weekKey = monday.toISOString().slice(0, 10);
    const canonical = (n: number) => `https://example.test/r/pullrequest/${n}`;

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
    update.run(at(0, 10), at(1, 15), "approved", at(1, 15), canonical(2));
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

console.log("load detail self-check OK");
