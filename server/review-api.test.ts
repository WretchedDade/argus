import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { handleApi, type ApiContext } from "./api.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-review-api-test-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const canonical =
    "https://worldwidelearning.visualstudio.com/LPE/_git/repo/pullrequest/42";
const recorded: (string | undefined)[] = [];
const prompts: string[] = [];
let failDispatch = false;
const context: ApiContext = {
    store,
    bootAt: new Date().toISOString(),
    reconcile: async () => null,
    refreshPr: async () => {},
    trackPr: async () => ({ ok: false }),
    recordReview: (_canonical, opts) => recorded.push(opts.verdict),
    dispatch: async (message) => {
        if (failDispatch) throw new Error("dispatch failed");
        prompts.push(message);
    },
    pollerStatus: () => ({
        me: null,
        authOk: true,
        running: false,
        currentRunId: null,
        lastRunAt: null,
        lastSummary: null,
        lastError: null,
    }),
    getConfig: () => defaultConfig(),
    saveConfig: () => defaultConfig(),
    markSetupComplete: () => {},
    installBaselineSkill: () => ({ installed: false, reason: "skipped" }),
};
const server = createServer((req, res) => {
    void handleApi(req, res, context).catch(() => {
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
    store.setLane(canonical, "quick");

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, body: unknown) =>
        fetch(`${base}${route}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    const verdict = (v: string, token?: string) =>
        post("/api/pr/record-review", { canonical, verdict: v, token });

    // Without an automatic review, tokenless approvals work.
    assert.equal((await verdict("approved")).status, 200);
    assert.equal(recorded.length, 1);

    const dispatched = await post("/api/pr/review", {
        canonical,
        automatic: true,
    });
    assert.equal(dispatched.status, 200);
    const token = /"token":"([^"]+)"/.exec(prompts[0] ?? "")?.[1];
    assert.ok(token, "automatic prompt carries a token");

    recorded.length = 0;
    assert.equal((await verdict("approved")).status, 403);
    assert.equal((await verdict("approved", "wrong")).status, 403);
    assert.equal(recorded.length, 0, "rejected approvals are not recorded");
    assert.equal((await verdict("waiting")).status, 200);
    assert.equal((await verdict("approved", token)).status, 200);
    assert.deepEqual(recorded, ["waiting", "approved"]);
    assert.equal(
        (await verdict("approved", token)).status,
        200,
        "no outstanding tokens remain after the review",
    );

    // A failed dispatch revokes its own token only.
    const keep = store.issueAutomaticReviewToken(canonical);
    failDispatch = true;
    const failed = await post("/api/pr/review", { canonical, automatic: true });
    assert.equal(failed.status, 500);
    failDispatch = false;
    assert.equal(store.checkVerdictAllowed(canonical, "approved", keep), true);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);
} finally {
    await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
