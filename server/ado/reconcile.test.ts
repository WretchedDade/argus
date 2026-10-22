import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { countBlobChanges } from "./client.ts";
import { reconcile, type Snapshot } from "./reconcile.ts";
import { ArgusStore } from "../db.ts";
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

assert.equal(countBlobChanges([
  ...Array.from({ length: 15 }, () => ({ item: { gitObjectType: "blob" } })),
  ...Array.from({ length: 11 }, () => ({ item: { gitObjectType: "tree" } })),
]), 15);

// New PRs bypass the historical backfill cap without being selected twice.
{
  const dir = mkdtempSync(path.join(tmpdir(), "argus-test-"));
  try {
    const store = new ArgusStore(path.join(dir, "argus.db"));
    const newPrs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const canonical = `${key}-${i}`;
      if (i < 25) newPrs.add(canonical);
      store.upsertPr({
        canonical,
        org: "worldwidelearning",
        project: "LPE",
        repo: "r",
        number: i + 1,
        title: "t",
        description: "",
        author: "a",
        isVendor: false,
        role: "reviewer",
        teams: [],
        isDraft: false,
        lastCommitSha: "sha1",
        lastCommitAt: null,
        prCreatedAt: null,
        sourceBranch: `f-${i}`,
        targetBranch: "main",
      });
    }
    const selected = store.prsNeedingFileCount(20, newPrs);
    assert.equal(selected.length, 45);
    assert.equal(selected.filter((item) => newPrs.has(item.canonical)).length, 25);
    assert.equal(selected.filter((item) => !newPrs.has(item.canonical)).length, 20);
    assert.equal(new Set(selected.map((item) => item.canonical)).size, selected.length);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The blob-only migration invalidates counts cached by the old tree-inclusive query.
{
  const dir = mkdtempSync(path.join(tmpdir(), "argus-test-"));
  const dbFile = path.join(dir, "argus.db");
  try {
    const store = new ArgusStore(dbFile);
    store.upsertPr({
      canonical: key,
      org: "worldwidelearning",
      project: "LPE",
      repo: "r",
      number: 1,
      title: "t",
      description: "",
      author: "a",
      isVendor: false,
      role: "reviewer",
      teams: [],
      isDraft: false,
      lastCommitSha: "sha1",
      lastCommitAt: null,
      prCreatedAt: null,
      sourceBranch: "f",
      targetBranch: "main",
    });
    store.setChangedFiles(key, 23, "sha1");
    store.close();

    const db = new DatabaseSync(dbFile);
    db.prepare("DELETE FROM settings WHERE key = ?").run("changed_files_blob_count_reset");
    db.close();

    const migrated = new ArgusStore(dbFile);
    assert.equal(migrated.getPr(key)?.changedFiles, null);
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Reads clear expired timed snoozes but preserve future ones.
{
  const dir = mkdtempSync(path.join(tmpdir(), "argus-test-"));
  try {
    const store = new ArgusStore(path.join(dir, "argus.db"));
    store.upsertPr({
      canonical: key,
      org: "worldwidelearning",
      project: "LPE",
      repo: "r",
      number: 1,
      title: "t",
      description: "",
      author: "a",
      isVendor: false,
      role: "reviewer",
      teams: [],
      isDraft: false,
      lastCommitSha: "sha1",
      lastCommitAt: null,
      prCreatedAt: null,
      sourceBranch: "f",
      targetBranch: "main",
    });
    store.setSnooze(key, "2000-01-01T00:00:00.000Z");
    assert.equal(store.getPr(key)?.snoozedUntil, null);
    assert.equal(store.getPr(key)?.snoozeMode, null);

    store.setSnooze(key, "2100-01-01T00:00:00.000Z");
    assert.equal(store.getPr(key)?.snoozedUntil, "2100-01-01T00:00:00.000Z");
    assert.equal(store.getPr(key)?.snoozeMode, "time");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("reconcile self-check OK");
