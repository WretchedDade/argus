import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";
import * as events from "./events.ts";
import * as prs from "./prs.ts";
import type { PrUpsert } from "../types.ts";

function open(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    for (const m of migrations) m.up(db);
    return db;
}

function pr(canonical: string, over: Partial<PrUpsert> = {}): PrUpsert {
    return {
        canonical,
        org: "o",
        project: "p",
        repo: "r",
        number: 1,
        title: "title",
        description: "",
        author: "alice",
        isVendor: false,
        role: "reviewer",
        teams: [],
        isDraft: false,
        lastCommitSha: "sha1",
        lastCommitAt: null,
        prCreatedAt: null,
        sourceBranch: null,
        targetBranch: null,
        ...over,
    };
}

test("upsertPr inserts, then refreshes ADO columns and keeps triage columns", () => {
    const db = open();
    prs.upsertPr(db, pr("c", { title: "one" }));
    prs.setLane(db, "c", "quick");
    prs.upsertPr(db, pr("c", { title: "two" }));
    const row = prs.getPr(db, "c");
    assert.equal(row?.title, "two");
    assert.equal(row?.lane, "quick");
    assert.equal(prs.findCanonicalByNumber(db, 1), "c");
    assert.equal(prs.findCanonicalByNumber(db, 99), null);
});

test("listPrs hides dismissed and closed PRs by default", () => {
    const db = open();
    prs.upsertPr(db, pr("a", { number: 1 }));
    prs.upsertPr(db, pr("b", { number: 2 }));
    prs.markClosed(db, "b", "merged");
    assert.deepEqual(
        prs.listPrs(db).map((p) => p.canonical),
        ["a"],
    );
    assert.equal(prs.listPrs(db, { includeClosed: true }).length, 2);
});

test("repo scope archives out PRs, keeps named ones, and revives on change", () => {
    const db = open();
    prs.upsertPr(db, pr("t", { number: 1, repo: "x", role: "team" }));
    prs.upsertPr(db, pr("r", { number: 2, repo: "x", role: "reviewer" }));
    const out = prs.setRepoScope(db, "x", "out");
    assert.equal(out.archived, 1);
    assert.equal(out.kept, 1);
    assert.equal(prs.getPr(db, "t")?.dismissed, true);
    assert.equal(prs.listArchived(db).length, 1);
    const back = prs.setRepoScope(db, "x", null);
    assert.equal(back.revived, 1);
    assert.equal(prs.getPr(db, "t")?.dismissed, false);
});

test("restorePr keeps an out-of-scope PR visible", () => {
    const db = open();
    prs.upsertPr(db, pr("t", { repo: "x", role: "team" }));
    prs.setRepoScope(db, "x", "out");
    assert.equal(prs.restorePr(db, "t"), true);
    const row = prs.getPr(db, "t");
    assert.equal(row?.dismissed, false);
    assert.equal(row?.outOfScope, false);
    assert.equal(prs.restorePr(db, "t"), false);
});

test("automatic review tokens gate the approved verdict", () => {
    const db = open();
    assert.equal(prs.checkVerdictAllowed(db, "c", "approved"), true);
    const token = prs.issueAutomaticReviewToken(db, "c", 1000);
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "approved", undefined, 2000),
        false,
    );
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "waiting", undefined, 2000),
        true,
    );
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "approved", token, 2000),
        true,
    );
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "approved", undefined, 2000),
        true,
    );
});

test("automatic review tokens expire and can be revoked", () => {
    const db = open();
    prs.issueAutomaticReviewToken(db, "c", 0);
    const later = 7 * 60 * 60 * 1000;
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "approved", undefined, later),
        true,
    );
    const token = prs.issueAutomaticReviewToken(db, "c", later);
    prs.revokeAutomaticReviewToken(db, "c", token);
    assert.equal(
        prs.checkVerdictAllowed(db, "c", "approved", undefined, later),
        true,
    );
});

test("recordReview sets state and appends review events", () => {
    const db = open();
    prs.upsertPr(db, pr("c"));
    prs.recordReview(db, "c", {
        verdict: "approved",
        sha: "sha1",
        sessionId: "s1",
    });
    const row = prs.getPr(db, "c");
    assert.equal(row?.reviewState, "approved");
    assert.equal(row?.reviewedSha, "sha1");
    assert.equal(row?.reviewSessionId, "s1");
    const types = events.listEvents(db, "c").map((e) => e.type);
    assert.deepEqual(types, ["review_state", "reviewed"]);
});

test("staleCandidates and archiveStale respect snooze and the preview list", () => {
    const db = open();
    prs.upsertPr(db, pr("old", { number: 1 }));
    prs.upsertPr(db, pr("snoozed", { number: 2 }));
    prs.setSnooze(db, "snoozed", "2999-01-01T00:00:00.000Z");
    const later = Date.now() + 60 * 86_400_000;
    const ids = prs.staleCandidates(db, later, 30).map((c) => c.canonical);
    assert.deepEqual(ids, ["old"]);
    assert.equal(prs.archiveStale(db, ["other"], later), 0);
    assert.equal(prs.archiveStale(db, ["old"], later), 1);
    assert.equal(prs.getPr(db, "old")?.dismissedReason, "stale");
});

test("applyPlan rolls back every change when one item fails", () => {
    const db = open();
    const good = {
        upsert: pr("good"),
        events: [],
        votes: {},
        revive: false,
        isAdd: true,
    };
    const bad = { ...good, upsert: null as unknown as PrUpsert };
    assert.throws(() => prs.applyPlan(db, { items: [good, bad] } as never));
    assert.equal(prs.getPr(db, "good"), null);
});

test("removePr deletes the row and its events", () => {
    const db = open();
    prs.upsertPr(db, pr("c"));
    prs.setLane(db, "c", "quick");
    prs.removePr(db, "c");
    assert.equal(prs.getPr(db, "c"), null);
    assert.equal(events.listEvents(db, "c").length, 0);
});

test("stale sweep approval is stored as a setting", () => {
    const db = open();
    assert.equal(prs.isStaleSweepApproved(db), false);
    prs.approveStaleSweep(db);
    assert.equal(prs.isStaleSweepApproved(db), true);
});
