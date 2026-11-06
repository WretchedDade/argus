import assert from "node:assert/strict";
import { test } from "node:test";
import { PrSchema, PrsResponseSchema, type Pr } from "./pr.ts";

const pr: Pr = {
    canonical: "org/proj/repo/1",
    org: "org",
    project: "proj",
    repo: "repo",
    number: 1,
    title: "Title",
    description: "",
    author: null,
    isVendor: false,
    role: "reviewer",
    teams: [],
    requiredApproverGroups: [],
    reviewState: "needs",
    otherVotes: [{ name: "a", vote: 10 }],
    lane: "review",
    state: "pending",
    isDraft: false,
    dismissed: false,
    dismissedReason: null,
    dismissedAt: null,
    outOfScope: false,
    snoozedUntil: null,
    snoozeMode: null,
    lastCommitSha: null,
    lastCommitAt: null,
    prCreatedAt: null,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    reviewSessionId: null,
    reviewedSha: null,
    reviewCount: 0,
    coveredAt: null,
    changedFiles: null,
    authorMeta: null,
};

test("PrSchema accepts a valid Pr", () => {
    assert.deepEqual(PrSchema.parse(pr), pr);
});

test("PrSchema rejects a bad enum value and a missing field", () => {
    assert.equal(PrSchema.safeParse({ ...pr, lane: "other" }).success, false);
    const { title: _title, ...missing } = pr;
    assert.equal(PrSchema.safeParse(missing).success, false);
});

test("PrsResponseSchema rejects a malformed list", () => {
    assert.equal(PrsResponseSchema.safeParse({ prs: [{}] }).success, false);
    assert.equal(PrsResponseSchema.parse({ prs: [pr] }).prs.length, 1);
});
