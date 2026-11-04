import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ArgusStore, resolveOutOfScope } from "./db.ts";
import type { Plan } from "./ado/reconcile.ts";
import type { PrUpsert } from "./types.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-archive-test-"));
const DAY = 86_400_000;

function upsert(n: number, repo = "repo"): PrUpsert {
    return {
        canonical: `https://example.test/LPE/_git/${repo}/pullrequest/${n}`,
        org: "example",
        project: "LPE",
        repo,
        number: n,
        title: `PR ${n}`,
        description: "",
        author: "Author",
        isVendor: false,
        role: "team",
        teams: [],
        isDraft: false,
        sourceBranch: "refs/heads/f",
        targetBranch: "refs/heads/main",
        lastCommitSha: "sha-1",
        lastCommitAt: new Date().toISOString(),
        prCreatedAt: new Date().toISOString(),
    };
}

const events = (s: ArgusStore, c: string): string[] =>
    s.listEvents(c).map((e) => e.type);

function setUpdated(file: string, c: string, ms: number): void {
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE prs SET updated_at = ? WHERE canonical = ?").run(
        new Date(ms).toISOString(),
        c,
    );
    raw.close();
}

try {
    // The surface rule: an out repo still shows PRs the user is named on.
    assert.equal(resolveOutOfScope(null, "out", "team"), true);
    assert.equal(resolveOutOfScope(null, "out", null), true);
    assert.equal(resolveOutOfScope(null, "out", "reviewer"), false);
    assert.equal(resolveOutOfScope(null, "out", "author"), false);
    assert.equal(resolveOutOfScope(null, "in", "team"), false);
    assert.equal(resolveOutOfScope("out", "in", "author"), true);
    assert.equal(resolveOutOfScope("in", "out", "team"), false);

    // Stale sweep.
    const file = path.join(dir, "sweep.db");
    const s = new ArgusStore(file);
    const t0 = Date.now();
    const fresh = upsert(1);
    const old = upsert(2);
    const snoozed = upsert(3);
    const midReview = upsert(4);
    const manual = upsert(5);
    for (const p of [fresh, old, snoozed, midReview, manual]) s.upsertPr(p);
    s.setSnooze(snoozed.canonical, new Date(t0 + 5 * DAY).toISOString());
    s.setReviewSession(midReview.canonical, "session-1");
    for (const p of [old, snoozed, midReview, manual])
        setUpdated(file, p.canonical, t0 - 40 * DAY);
    setUpdated(file, fresh.canonical, t0 - 29 * DAY);

    const candidates = s.staleCandidates(t0).map((c) => c.canonical);
    assert.ok(candidates.includes(old.canonical));
    assert.ok(candidates.includes(manual.canonical));
    assert.ok(!candidates.includes(fresh.canonical), "29 days is not stale");
    assert.ok(!candidates.includes(snoozed.canonical), "snoozed is skipped");
    assert.ok(!candidates.includes(midReview.canonical), "mid-review skipped");

    assert.equal(s.isStaleSweepApproved(), false);
    assert.equal(s.archiveStale([old.canonical], t0), 1);
    assert.equal(s.getPr(old.canonical)?.dismissedReason, "stale");
    assert.ok(events(s, old.canonical).includes("archived"));
    assert.equal(
        s.listPrs().some((p) => p.canonical === old.canonical),
        false,
    );
    assert.equal(s.listArchived().length, 1);
    assert.equal(s.countTracked(), 4);

    // Auto-revive: a change plan clears the archive and the review session.
    s.setReviewSession(old.canonical, "session-2");
    const plan = {
        items: [
            {
                upsert: upsert(2),
                events: [
                    {
                        canonical: old.canonical,
                        type: "new_commits",
                        ts: new Date().toISOString(),
                    },
                ],
                revive: true,
                isAdd: false,
                votes: {},
            },
        ],
    } as unknown as Plan;
    s.applyPlan(plan, 1);
    const revived = s.getPr(old.canonical);
    assert.equal(revived?.dismissed, false);
    assert.equal(revived?.dismissedReason, null);
    assert.equal(revived?.reviewSessionId, null);
    assert.ok(events(s, old.canonical).includes("revived"));

    // A manual dismissal is never revived and never archived again.
    const rawDb = new DatabaseSync(file);
    rawDb
        .prepare(
            "UPDATE prs SET dismissed = 1, dismissed_reason = 'user', dismissed_at = ? WHERE canonical = ?",
        )
        .run(new Date().toISOString(), manual.canonical);
    rawDb.close();
    s.applyPlan(
        {
            items: [
                {
                    upsert: upsert(5),
                    events: [
                        {
                            canonical: manual.canonical,
                            type: "new_commits",
                            ts: new Date().toISOString(),
                        },
                    ],
                    revive: true,
                    isAdd: false,
                    votes: {},
                },
            ],
        } as unknown as Plan,
        2,
    );
    assert.equal(s.getPr(manual.canonical)?.dismissed, true);
    assert.equal(s.getPr(manual.canonical)?.dismissedReason, "user");
    assert.equal(s.restorePr(manual.canonical), false);

    // Approval is remembered.
    s.approveStaleSweep();
    assert.equal(s.isStaleSweepApproved(), true);

    // A manual restore resets the clock: the PR is not archived again at once.
    setUpdated(file, fresh.canonical, t0 - 40 * DAY);
    s.archiveStale(undefined, t0);
    assert.equal(s.getPr(fresh.canonical)?.dismissedReason, "stale");
    assert.equal(s.restorePr(fresh.canonical), true);
    assert.equal(s.getPr(fresh.canonical)?.dismissed, false);
    assert.equal(s.archiveStale(undefined, t0), 0);

    // A restore also resets the recency the Board reads.
    assert.ok(
        Date.parse(s.getPr(fresh.canonical)?.updatedAt ?? "") > t0 - DAY,
        "restore resets updated_at",
    );

    // An old verdict does not hide a newer, unfinished review session.
    const reReview = upsert(6);
    s.upsertPr(reReview);
    s.recordReview(reReview.canonical, { verdict: "approved" });
    setUpdated(file, reReview.canonical, t0 - 40 * DAY);
    assert.ok(
        s.staleCandidates(t0).some((c) => c.canonical === reReview.canonical),
        "finished review is stale",
    );
    s.setReviewSession(reReview.canonical, "session-3");
    assert.ok(
        !s.staleCandidates(t0).some((c) => c.canonical === reReview.canonical),
        "re-review in progress is skipped",
    );
    s.recordReview(reReview.canonical, {
        verdict: "approved",
        sessionId: "session-3",
    });
    assert.ok(
        s.staleCandidates(t0).some((c) => c.canonical === reReview.canonical),
        "completed review with a linked session is stale",
    );

    // Events that share one millisecond keep their order (the clock is frozen).
    const sameMs = upsert(8);
    s.upsertPr(sameMs);
    setUpdated(file, sameMs.canonical, t0 - 40 * DAY);
    mock.timers.enable({ apis: ["Date"], now: t0 });
    try {
        s.setReviewSession(sameMs.canonical, "session-4");
        s.recordReview(sameMs.canonical, {
            verdict: "approved",
            sessionId: "session-4",
        });
    } finally {
        mock.timers.reset();
    }
    assert.ok(
        s.staleCandidates(t0).some((c) => c.canonical === sameMs.canonical),
        "completed review in the same millisecond is stale",
    );

    // A refresh that sees a new commit revives a stale archive.
    const refreshed = upsert(7);
    s.upsertPr(refreshed);
    setUpdated(file, refreshed.canonical, t0 - 40 * DAY);
    s.archiveStale([refreshed.canonical], t0);
    s.reviveStaleOnChange(refreshed.canonical, "sha-1", false);
    assert.equal(s.getPr(refreshed.canonical)?.dismissed, true, "no change");
    s.reviveStaleOnChange(refreshed.canonical, "sha-2", false);
    assert.equal(s.getPr(refreshed.canonical)?.dismissed, false);
    s.close();

    // Repo scope policy.
    const file2 = path.join(dir, "scope.db");
    const p = new ArgusStore(file2);
    const team = upsert(10, "noise");
    const mine = upsert(11, "noise");
    mine.role = "reviewer";
    const pinned = upsert(12, "noise");
    for (const u of [team, mine, pinned]) p.upsertPr(u);
    p.setOutOfScope(pinned.canonical, false); // explicit "in" override
    const outResult = p.setRepoScope("noise", "out");
    assert.deepEqual(outResult, { archived: 1, revived: 0, kept: 1 });
    assert.equal(p.getPr(team.canonical)?.dismissedReason, "out_of_scope");
    assert.equal(p.getPr(team.canonical)?.outOfScope, true);
    assert.equal(p.getPr(mine.canonical)?.dismissed, false, "named reviewer");
    assert.equal(p.getPr(pinned.canonical)?.dismissed, false, "override");
    assert.equal(p.countTracked(), 2);
    assert.deepEqual(
        p.listRepoScopes().find((r) => r.repo === "noise"),
        { repo: "noise", scope: "out", open: 2, hidden: 1 },
    );

    // Moving the repo back in revives what the policy archived.
    const inResult = p.setRepoScope("noise", "in");
    assert.deepEqual(inResult, { archived: 0, revived: 1, kept: 0 });
    assert.equal(p.getPr(team.canonical)?.dismissed, false);
    assert.ok(events(p, team.canonical).includes("revived"));

    // Per-PR overrides survive a repo default change, even for named roles.
    p.setOutOfScope(mine.canonical, true);
    assert.equal(p.getPr(mine.canonical)?.dismissedReason, "out_of_scope");
    p.setRepoScope("noise", "out");
    assert.equal(p.getPr(mine.canonical)?.dismissed, true, "explicit out kept");
    p.setRepoScope("noise", "in");
    assert.equal(p.getPr(mine.canonical)?.dismissed, true, "still out");
    assert.equal(p.restorePr(mine.canonical), true);

    // A per-PR "out" archives, and manual restore sets an "in" override.
    p.setOutOfScope(team.canonical, true);
    assert.equal(p.getPr(team.canonical)?.dismissedReason, "out_of_scope");
    assert.equal(p.restorePr(team.canonical), true);
    assert.equal(p.getPr(team.canonical)?.dismissed, false);
    assert.equal(p.getPr(team.canonical)?.outOfScope, false);
    p.close();

    // A database from before scope_override keeps its out-of-scope PRs, archived.
    const file3 = path.join(dir, "old.db");
    const seed = new ArgusStore(file3);
    seed.upsertPr(upsert(20));
    seed.close();
    const raw = new DatabaseSync(file3);
    raw.exec("UPDATE prs SET out_of_scope = 1");
    raw.exec("DROP TABLE repo_scopes");
    raw.exec("ALTER TABLE prs DROP COLUMN scope_override");
    raw.exec("PRAGMA user_version = 2");
    raw.close();
    const migrated = new ArgusStore(file3);
    const m = migrated.getPr(upsert(20).canonical);
    assert.equal(m?.dismissedReason, "out_of_scope");
    assert.equal(migrated.listPrs().length, 0);
    migrated.close();
} finally {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* a failed test can leave a database open */
    }
}
