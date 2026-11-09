import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { type ApiContext } from "../api.ts";
import { createHonoHandler } from "../app.ts";
import { defaultConfig } from "../config.ts";
import { ArgusStore } from "../db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-delete-all-test-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const canonical =
    "https://worldwidelearning.visualstudio.com/LPE/_git/repo/pullrequest/42";
const context = {
    store,
    getConfig: () => defaultConfig(),
    deleteAllData: async () => store.deleteAllData(),
} as unknown as ApiContext;
const handler = createHonoHandler(context);
const server = createServer((req, res) => {
    void handler(req, res).catch(() => {
        res.writeHead(500).end();
    });
});

try {
    store.upsertPr({
        canonical,
        org: "worldwidelearning",
        project: "LPE",
        repo: "repo",
        number: 42,
        title: "Title",
        description: "Description",
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
    store.appendEvent(canonical, "reviewed", { verdict: "approved" });
    store.issueAutomaticReviewToken(canonical);
    store.recordActivity("info", "polled", { title: "Title" });
    store.markSetupComplete();
    store.saveConfigOverrides({ project: "LPE" });
    assert.equal(store.listPrs().length, 1);

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const post = (body: unknown) =>
        fetch(`http://127.0.0.1:${address.port}/api/data/delete-all`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

    // Without the confirm word, nothing is deleted.
    assert.equal((await post({})).status, 400);
    assert.equal((await post(null)).status, 400);
    assert.equal(store.listPrs().length, 1);

    assert.equal((await post({ confirm: "delete" })).status, 200);
    assert.equal(store.listPrs().length, 0);
    assert.equal(store.getPr(canonical), null);
    assert.equal(store.listActivity(100).length, 0);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);

    // Config and setup state stay.
    assert.equal(store.isSetupComplete(), true);
    assert.equal(store.getConfigOverrides().project, "LPE");
} finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
