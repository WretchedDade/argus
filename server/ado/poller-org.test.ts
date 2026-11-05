import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArgusStore } from "../db.ts";
import {
    backfillAuthors,
    backfillRepoNames,
    closeDeparted,
    orgFromCanonical,
} from "./poller.ts";
import type { AdoRawPr } from "./types.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-poller-org-test-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const cfg = {
    orgUrl: "https://dev.azure.com/org-b",
    orgSlug: "org-b",
    project: "Project",
};
const rowA = "https://org-a.visualstudio.com/Project/_git/repo/pullrequest/7";
const rowB = "https://org-b.visualstudio.com/Project/_git/repo/pullrequest/8";

function add(canonical: string, org: string, number: number): void {
    store.upsertPr({
        canonical,
        org,
        project: "Project",
        repo: "repo",
        number,
        title: "t",
        description: "",
        author: "",
        isVendor: false,
        role: "reviewer",
        teams: [],
        isDraft: false,
        sourceBranch: "refs/heads/f",
        targetBranch: "refs/heads/main",
        lastCommitSha: "sha",
        lastCommitAt: new Date().toISOString(),
        prCreatedAt: new Date().toISOString(),
    });
}

try {
    assert.equal(orgFromCanonical(rowA), "org-a");
    assert.equal(
        orgFromCanonical("https://dev.azure.com/Org-B/P/_git/r/pullrequest/1"),
        "Org-B",
    );
    assert.equal(orgFromCanonical("pr-1"), null);

    add(rowA, "org-a", 7);
    add(rowB, "org-b", 8);

    // A lookup in the configured org (B) would return an unrelated, completed PR.
    const calls: string[] = [];
    const show = async (id: number, org: string) => {
        calls.push(`${org}#${id}`);
        return {
            status: "completed",
            createdBy: { displayName: "Someone Else" },
            repository: { name: "other-repo" },
        } as unknown as AdoRawPr;
    };

    const rows = [
        { canonical: rowA, number: 7 },
        { canonical: rowB, number: 8 },
    ];
    await backfillAuthors(store, cfg, rows, show);
    await backfillRepoNames(store, cfg, rows, show);
    assert.deepEqual(calls, [
        "https://dev.azure.com/org-b#8",
        "https://dev.azure.com/org-b#8",
    ]);
    assert.equal(store.getPr(rowA)?.author, "");
    assert.equal(store.getPr(rowA)?.repo, "repo");

    calls.length = 0;
    const result = await closeDeparted(
        store,
        cfg,
        [],
        store.listSnapshots(),
        1,
        show,
    );
    assert.equal(result.closed, 1);
    assert.deepEqual(calls, ["https://dev.azure.com/org-b#8"]);
    assert.notEqual(store.getPr(rowA)?.state, "closed");
    assert.equal(store.getPr(rowB)?.state, "closed");
} finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
console.log("poller org self-check OK");
