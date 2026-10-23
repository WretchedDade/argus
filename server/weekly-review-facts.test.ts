import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArgusStore } from "./db.ts";
import { countReviewComments } from "./ado/client.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-weekly-review-test-"));
const dbFile = path.join(dir, "argus.db");
let store!: ArgusStore;
let storeOpen = false;

try {
  const startKey = "2026-10-19";
  const at = (day: number, hour = 9) => new Date(2026, 9, 19 + day, hour).toISOString();
  const canonical = (n: number) => `https://example.test/r/pullrequest/${n}`;
  store = new ArgusStore(dbFile);
  storeOpen = true;

  const addPr = (number: number, author: string, isVendor: boolean) => {
    store.upsertPr({
      canonical: canonical(number),
      org: "o",
      project: "p",
      repo: number === 2 ? "beta" : "alpha",
      number,
      title: `PR ${number}`,
      description: "",
      author,
      isVendor,
      role: "reviewer",
      teams: [],
      isDraft: false,
      lastCommitSha: `sha-${number}`,
      lastCommitAt: null,
      prCreatedAt: null,
      sourceBranch: null,
      targetBranch: null,
    });
  };

  addPr(1, "Ada", false);
  addPr(2, "Dependabot", false);
  addPr(3, "Vendor Dev", true);
  store.setLane(canonical(1), "quick");
  store.setChangedFiles(canonical(1), 7, "sha-1");
  store.setCommentCounts(canonical(1), 4, 6);
  store.setChangedFiles(canonical(2), 1, "sha-2");
  store.setChangedFiles(canonical(3), 1, "sha-3");
  store.setCommentCounts(canonical(2), 0, 2);

  store.appendEvent(canonical(1), "reviewed", { verdict: "approved" }, at(-1, 23));
  store.appendEvent(canonical(1), "reviewed", { verdict: "waiting" }, at(0, 0));
  store.appendEvent(canonical(2), "reviewed", { verdict: "approved" }, at(1));
  store.appendEvent(canonical(1), "reviewed", { verdict: "approved" }, at(2));
  store.appendEvent(canonical(3), "reviewed", { verdict: "suggestions" }, at(6, 23));
  store.appendEvent(canonical(2), "reviewed", { sessionId: "migration-only" }, at(3));
  store.appendEvent(canonical(2), "reviewed", { verdict: null }, at(4));
  store.appendEvent(canonical(2), "reviewed", { verdict: "approved" }, at(7, 0));
  store.appendEvent(canonical(1), "commit_pushed", { from: "sha-0", to: "sha-1" }, at(-2));
  store.appendEvent(canonical(1), "commit_pushed", { from: "sha-1", to: "sha-2" }, at(1));

  assert.deepEqual(
    store.prsNeedingCommentCount().map((pr) => pr.canonical),
    [canonical(3)],
    "A recorded review stays eligible for comment backfill after its current review state changes.",
  );
  const facts = store.weeklyReviewFacts(startKey);
  assert.equal(facts.startKey, startKey);
  assert.equal(facts.endKey, "2026-10-26");
  assert.equal(facts.actionCount, 4);
  assert.equal(facts.uniquePrCount, 3);
  assert.deepEqual(facts.coverage, { sizeKnown: 3, commentsKnown: 2, scoreKnown: 2 });
  assert.deepEqual(facts.effort, { total: 10, average: 5 });

  const first = facts.prs[0];
  assert.equal(first.canonical, canonical(3));
  assert.equal(first.authorType, "Vendor");
  assert.equal(first.changedFiles, 1);
  assert.equal(first.totalComments, null);
  assert.equal(first.otherComments, null);

  const repeated = facts.prs.find((pr) => pr.canonical === canonical(1));
  assert.deepEqual(repeated, {
    canonical: canonical(1),
    repo: "alpha",
    number: 1,
    title: "PR 1",
    author: "Ada",
    authorType: "FTE",
    reviewActions: 2,
    lifetimeReviewActions: 3,
    updateEpisodes: 2,
    latestReviewAt: at(2),
    finalLane: "quick",
    changedFiles: 7,
    totalComments: 4,
    otherComments: 6,
    effort: {
      score: 8,
      size: 3,
      updates: 1,
      depth: 2,
      discussion: 1,
      revisits: 1,
    },
  });
  assert.equal(facts.prs.find((pr) => pr.canonical === canonical(2))?.authorType, "Automated");
  assert.equal(facts.prs.find((pr) => pr.canonical === canonical(2))?.updateEpisodes, 0);
  assert.equal(facts.prs.find((pr) => pr.canonical === canonical(2))?.effort?.score, 2);
  assert.equal(first.effort, null);
  assert.deepEqual(
    facts.prs.map((pr) => pr.canonical),
    [canonical(3), canonical(1), canonical(2)],
    "PRs sort by latest review descending, then repo, number, and canonical.",
  );
  assert.deepEqual(
    countReviewComments([
      { comments: [
        { commentType: "text", author: { uniqueName: "dade@microsoft.com" } },
        { commentType: "text", author: { uniqueName: "github-copilot" } },
        { commentType: "system", author: { uniqueName: "system" } },
      ] },
      { isDeleted: true, comments: [{ commentType: "text", author: { uniqueName: "someone@microsoft.com" } }] },
    ], "dade@microsoft.com"),
    { mine: 1, others: 1 },
  );
  store.close();
  storeOpen = false;
} finally {
  if (storeOpen) store.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("weekly review facts self-check OK");
