import assert from "node:assert/strict";
import { reconcile, type Snapshot } from "./reconcile.ts";
import type { CurrentPr } from "./types.ts";

// Minimal PR factory; override only what a case cares about.
function pr(overrides: Partial<CurrentPr> = {}): CurrentPr {
  return {
    canonical: "https://worldwidelearning.visualstudio.com/LPE/_git/r/pullrequest/1",
    org: "worldwidelearning",
    project: "LPE",
    repo: "r",
    repoId: "repo-guid",
    number: 1,
    title: "t",
    description: "",
    author: "a",
    isVendor: false,
    role: "reviewer",
    teams: [],
    reviewState: "needs",
    otherVotes: [],
    isDraft: false,
    status: "active",
    mergeStatus: "succeeded",
    createdAt: new Date().toISOString(),
    sha: "sha1",
    targetBranch: "main",
    sourceBranch: "f",
    reviewers: [],
    ...overrides,
  };
}

function snap(overrides: Partial<Snapshot> = {}): Snapshot {
  return { sha: "sha1", isDraft: false, state: "pending", dismissed: false, votes: {}, ...overrides };
}

const nowMs = Date.now();
const key = pr().canonical;
const opts = { recencyDays: 7, nowMs };
const types = (p: ReturnType<typeof reconcile>) => p.items[0]?.events.map((e) => e.type) ?? [];

// New recent PR -> add.
{
  const plan = reconcile([pr()], new Map(), opts);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].isAdd, true);
  assert.deepEqual(types(plan), ["added"]);
}

// Unchanged signature -> nothing.
{
  const plan = reconcile([pr()], new Map([[key, snap()]]), opts);
  assert.equal(plan.items.length, 0);
}

// New commit -> commit_pushed.
{
  const plan = reconcile([pr({ sha: "sha2" })], new Map([[key, snap({ sha: "sha1" })]]), opts);
  assert.deepEqual(types(plan), ["commit_pushed"]);
}

// Reviewer vote moved -> vote_changed.
{
  const plan = reconcile([pr({ reviewers: [{ id: "u1", vote: 10, displayName: "U One", isContainer: false }] })], new Map([[key, snap({ votes: { u1: 0 } })]]), opts);
  assert.deepEqual(types(plan), ["vote_changed"]);
}

// Dismissed PR is never resurrected.
{
  const plan = reconcile([pr({ sha: "sha2" })], new Map([[key, snap({ dismissed: true })]]), opts);
  assert.equal(plan.items.length, 0);
}

// Stale untracked PR is ignored.
{
  const old = new Date(nowMs - 30 * 86_400_000).toISOString();
  const plan = reconcile([pr({ createdAt: old })], new Map(), opts);
  assert.equal(plan.items.length, 0);
}

console.log("reconcile self-check OK");
