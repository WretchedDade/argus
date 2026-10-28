import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
    store.recordReview(canonical, {});
    assert.equal(store.getPr(canonical)?.reviewCount, 0);

    store.recordReview(canonical, { verdict: "waiting", sha: "sha-1" });
    store.recordReview(canonical, { verdict: "approved", sha: "sha-2" });

    assert.equal(store.getPr(canonical)?.reviewCount, 2);
    assert.equal(store.listPrs()[0]?.reviewCount, 2);
} finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
}

console.log("db review-count self-check OK");
