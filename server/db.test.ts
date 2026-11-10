import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-db-test-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const canonical =
    "https://worldwidelearning.visualstudio.com/LPE/_git/repo/pullrequest/42";

try {
    store.upsertPr({
        canonical,
        org: "worldwidelearning",
        project: "LPE",
        repo: "repo",
        number: 42,
        title: "Track completed reviews",
        description: "",
        author: "Author",
        isVendor: false,
        role: "reviewer",
        teams: [],
        isDraft: false,
        sourceBranch: "refs/heads/feature",
        targetBranch: "refs/heads/main",
        lastCommitSha: "sha-1",
        lastCommitAt: new Date().toISOString(),
        prCreatedAt: new Date().toISOString(),
    });

    assert.equal(store.getPr(canonical)?.reviewCount, 0);
    assert.deepEqual(store.getPr(canonical)?.requiredApproverGroups, []);
    store.setOwnership(
        canonical,
        "team",
        ["Optional team"],
        "needs",
        "",
        false,
        [],
        ["Required team"],
    );
    assert.deepEqual(store.getPr(canonical)?.requiredApproverGroups, [
        "Required team",
    ]);
    assert.deepEqual(store.listPrs()[0]?.requiredApproverGroups, [
        "Required team",
    ]);
    store.setOwnership(
        canonical,
        "team",
        ["Optional team"],
        "needs",
        "",
        false,
        [],
        [],
    );
    assert.deepEqual(store.getPr(canonical)?.requiredApproverGroups, []);
    assert.deepEqual(store.getPr(canonical)?.teams, ["Optional team"]);

    store.setReviewSession(canonical, "session-1");
    const pendingReview = store.getPr(canonical);
    const week = new Date().toISOString().slice(0, 10);
    const pendingFacts = store.weeklyReviewFacts(week);
    store.recordReview(canonical, {
        verdict: "waiting",
        sha: "sha-1",
        provisional: true,
    });
    assert.deepEqual(store.getPr(canonical), pendingReview);
    assert.deepEqual(store.weeklyReviewFacts(week), pendingFacts);
    assert.equal(
        store.listEvents(canonical).at(-1)?.type,
        "review_provisional",
    );
    assert.equal(
        store.listEvents(canonical).at(-1)?.payload?.verdict,
        "waiting",
    );
    store.recordReview(canonical, {});
    assert.equal(store.getPr(canonical)?.reviewCount, 0);

    store.recordReview(canonical, { verdict: "waiting", sha: "sha-1" });
    store.recordReview(canonical, { verdict: "approved", sha: "sha-2" });

    assert.equal(store.getPr(canonical)?.reviewCount, 2);
    assert.equal(store.listPrs()[0]?.reviewCount, 2);
    const completedReview = store.getPr(canonical);
    const completedFacts = store.weeklyReviewFacts(week);
    store.recordReview(canonical, {
        verdict: "waiting",
        sha: "sha-3",
        provisional: true,
    });
    assert.deepEqual(store.getPr(canonical), completedReview);
    assert.deepEqual(store.weeklyReviewFacts(week), completedFacts);

    const other = "https://example.test/pr/8";
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);
    const t1 = store.issueAutomaticReviewToken(canonical);
    const t2 = store.issueAutomaticReviewToken(canonical);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), false);
    assert.equal(
        store.checkVerdictAllowed(canonical, "approved", "bad"),
        false,
    );
    assert.equal(store.checkVerdictAllowed(canonical, "waiting"), true);
    assert.equal(store.checkVerdictAllowed(other, "approved"), true);
    // Overlapping reviews of one PR each keep a valid token.
    assert.equal(store.checkVerdictAllowed(canonical, "approved", t1), true);
    assert.equal(store.checkVerdictAllowed(canonical, "approved", t1), false);
    assert.equal(store.checkVerdictAllowed(canonical, "approved", t2), true);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);
    // A stale token expires so it cannot block approvals forever.
    store.issueAutomaticReviewToken(canonical, Date.now() - 7 * 3600e3);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);
    // A second store on the same file (another host) sees the tokens.
    const t3 = store.issueAutomaticReviewToken(canonical);
    const peer = new ArgusStore(path.join(dir, "argus.db"));
    assert.equal(peer.checkVerdictAllowed(canonical, "approved"), false);
    assert.equal(peer.checkVerdictAllowed(canonical, "approved", t3), true);
    // A consumed token cannot approve again while another token is outstanding.
    const t4 = store.issueAutomaticReviewToken(canonical);
    store.issueAutomaticReviewToken(canonical);
    assert.equal(peer.checkVerdictAllowed(canonical, "approved", t4), true);
    assert.equal(store.checkVerdictAllowed(canonical, "approved", t4), false);
    peer.close();

    // Only one host holds the poll lease; another takes over after expiry.
    const host2 = new ArgusStore(path.join(dir, "argus.db"));
    const t0 = Date.now();
    assert.equal(store.acquirePollLease("a", 1000, t0), true);
    assert.equal(host2.acquirePollLease("b", 1000, t0 + 500), false);
    assert.equal(store.acquirePollLease("a", 1000, t0 + 500), true); // renew
    assert.equal(host2.acquirePollLease("b", 1000, t0 + 1200), false);
    assert.equal(host2.acquirePollLease("b", 1000, t0 + 1600), true); // expired
    assert.equal(store.acquirePollLease("a", 1000, t0 + 1700), false);
    store.releasePollLease("a"); // not the owner: no effect
    assert.equal(store.acquirePollLease("a", 1000, t0 + 1700), false);
    host2.releasePollLease("b");
    assert.equal(store.acquirePollLease("a", 1000, t0 + 1700), true);
    store.releasePollLease("a");
    host2.close();

    // A database from before the token table keeps its history after an upgrade.
    const legacyFile = path.join(dir, "legacy.db");
    const seeded = new ArgusStore(legacyFile);
    seeded.upsertPr({
        ...store.getPr(canonical)!,
        lastCommitSha: "sha-1",
        lastCommitAt: new Date().toISOString(),
        prCreatedAt: new Date().toISOString(),
    } as never);
    seeded.close();
    const raw = new DatabaseSync(legacyFile);
    raw.exec("DROP TABLE automatic_review_tokens");
    raw.exec("PRAGMA user_version = 0");
    raw.close();
    const upgraded = new ArgusStore(legacyFile);
    assert.equal(upgraded.getPr(canonical)?.number, 42);
    const t5 = upgraded.issueAutomaticReviewToken(canonical);
    assert.equal(upgraded.checkVerdictAllowed(canonical, "approved"), false);
    assert.equal(upgraded.checkVerdictAllowed(canonical, "approved", t5), true);
    upgraded.close();
} finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
