import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { hc } from "hono/client";
import type { ApiContext } from "../api.ts";
import { createHonoHandler, type AppType } from "../app.ts";
import { defaultConfig } from "../config.ts";
import { ArgusStore } from "../db.ts";

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
    deleteAllData: async () => {},
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
    void createHonoHandler(context)(req, res).catch(() => {
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

    const client = hc<AppType>(base, {
        headers: { "content-type": "application/json" },
    }).api;
    const get = async (route: string) => {
        const response = await fetch(`${base}${route}`);
        return {
            status: response.status,
            body: (await response.json()) as unknown,
        };
    };
    assert.deepEqual((await get("/api/pr")).body, {
        error: "canonical required",
    });
    assert.deepEqual((await get("/api/pr/find?number=0")).body, {
        error: "valid number required",
    });
    assert.equal((await get("/api/pr/find?number=1.5")).status, 400);
    assert.deepEqual((await get("/api/pr/find?number=42")).body, { canonical });
    assert.deepEqual((await get("/api/pr/find?number=42&number=99")).body, {
        canonical,
    });
    assert.deepEqual((await get("/api/pr/find?number=99")).body, {
        canonical: null,
    });
    assert.equal((await client.prs.$get()).status, 200);
    assert.equal((await post("/api/prs", {})).status, 200);
    assert.equal((await post("/api/pr/refresh", {})).status, 400);
    assert.equal((await fetch(`${base}/api/pr/refresh`)).status, 404);
    assert.equal(
        (await fetch(`${base}/api/archived`, { method: "OPTIONS" })).status,
        200,
    );
    assert.equal(
        (await fetch(`${base}/api/prs`, { method: "HEAD" })).status,
        200,
    );
    const detail = await client.pr.$get({ query: { canonical } });
    assert.equal(detail.status, 200);
    assert.equal(
        ((await detail.json()) as { pr: { canonical: string } }).pr.canonical,
        canonical,
    );
    assert.deepEqual((await get("/api/pr?canonical=missing")).body, {
        pr: null,
        events: [],
    });
    assert.deepEqual(
        (
            await get(
                `/api/pr?canonical=${encodeURIComponent(canonical)}&canonical=missing`,
            )
        ).body,
        (await get(`/api/pr?canonical=${encodeURIComponent(canonical)}`)).body,
    );
    assert.equal(
        (await client.pr.track.$post({ json: { number: 42 } })).status,
        409,
    );
    assert.equal((await post("/api/pr/track", { number: "42" })).status, 409);
    assert.equal((await post("/api/pr/track", {})).status, 400);
    for (const route of [
        "refresh",
        "snooze",
        "remove",
        "scope",
        "restore",
        "record-review",
    ])
        assert.deepEqual(await (await post(`/api/pr/${route}`, {})).json(), {
            error: "canonical required",
        });
    assert.equal(
        (await post("/api/pr/lane", { canonical, lane: "review" })).status,
        404,
    );
    assert.equal(store.getPr(canonical)?.lane, "quick");
    for (const body of [
        {},
        { mode: "invalid" },
        { mode: null },
        { mode: "quick" },
        { mode: "full" },
        { mode: "automatic" },
        { mode: true },
        { automatic: true },
        { automatic: false },
        { automatic: "yes" },
    ]) {
        assert.equal(
            (await post("/api/pr/review", { canonical, ...body })).status,
            400,
        );
    }
    assert.equal(prompts.length, 0, "Invalid requests do not start a review.");
    assert.equal(store.getPr(canonical)?.lane, "quick");
    assert.equal((await post("/api/pr/review", {})).status, 400);
    for (const [mode, lane] of [
        ["for-me", "quick"],
        ["with-me", "review"],
    ] as const) {
        assert.equal(
            (await client.pr.review.$post({ json: { canonical, mode } }))
                .status,
            200,
        );
        assert.equal(store.getPr(canonical)?.lane, lane);
        assert.match(prompts.at(-1) ?? "", new RegExp(`Review mode: ${mode}`));
        assert.equal(
            (
                await client.pr.review.$post({
                    json: { canonical, mode: "delegate" },
                })
            ).status,
            200,
        );
        assert.equal(store.getPr(canonical)?.lane, lane);
        assert.match(prompts.at(-1) ?? "", /Review mode: delegate/);
        const token = /"token":"([^"]+)"/.exec(prompts.at(-1) ?? "")?.[1];
        assert.ok(token);
        assert.equal(
            (
                await post("/api/pr/record-review", {
                    canonical,
                    token,
                    release: true,
                })
            ).status,
            200,
        );
    }
    failDispatch = true;
    assert.equal(
        (await post("/api/pr/review", { canonical, mode: "for-me" })).status,
        500,
    );
    failDispatch = false;
    assert.equal(store.getPr(canonical)?.lane, "review");
    prompts.length = 0;
    const until = new Date(Date.now() + 60_000).toISOString();
    assert.equal(
        (await client.pr.snooze.$post({ json: { canonical, until } })).status,
        200,
    );
    assert.equal(store.getPr(canonical)?.snoozeMode, "time");
    await post("/api/pr/snooze", { canonical });
    assert.equal(store.getPr(canonical)?.snoozedUntil, null);
    assert.equal(
        (await client.pr.refresh.$post({ json: { canonical } })).status,
        200,
    );
    assert.equal(
        (await client.pr.scope.$post({ json: { canonical, outOfScope: true } }))
            .status,
        200,
    );
    assert.equal(store.getPr(canonical)?.outOfScope, true);
    assert.deepEqual(
        await (await client.pr.restore.$post({ json: { canonical } })).json(),
        { restored: true },
    );
    assert.equal(store.getPr(canonical)?.outOfScope, false);
    assert.equal((await client.archived.$get()).status, 200);
    assert.equal((await client.archive.preview.$get()).status, 200);
    assert.equal(
        (await post("/api/repo-scopes", { repo: "repo", scope: "invalid" }))
            .status,
        400,
    );
    assert.equal((await post("/api/repo-scopes", {})).status, 400);
    assert.equal(
        (
            await client["repo-scopes"].$post({
                json: { repo: "repo", scope: "in" },
            })
        ).status,
        200,
    );
    assert.equal((await client["repo-scopes"].$get()).status, 200);
    assert.deepEqual(
        await (
            await client.archive.sweep.$post({ json: { canonicals: [] } })
        ).json(),
        { archived: 0 },
    );
    assert.equal(store.isStaleSweepApproved(), true);
    assert.equal((await client.archivable.$get()).status, 200);
    assert.deepEqual(await (await client.archive.$post()).json(), {
        dispatched: 0,
    });
    const image = await client.img.$get({
        query: { url: "https://example.test/image.png" },
    });
    assert.equal(image.status, 400);
    assert.equal(image.headers.get("content-type"), null);
    assert.equal(await image.text(), "bad url");
    assert.equal((await fetch(`${base}/api/pr/unknown`)).status, 404);
    assert.equal(
        (
            await fetch(`${base}/api/prs`, {
                headers: { Origin: "https://example.test" },
            })
        ).status,
        403,
    );

    // Without an automatic review, tokenless approvals work.
    assert.equal((await verdict("approved")).status, 200);
    assert.equal(recorded.length, 1);

    const dispatched = await post("/api/pr/review", {
        canonical,
        mode: "delegate",
    });
    assert.equal(dispatched.status, 200);
    assert.equal(store.getPr(canonical)?.lane, "review");
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

    // An escalation releases its token without recording a verdict.
    const dispatchedAgain = await post("/api/pr/review", {
        canonical,
        mode: "delegate",
    });
    assert.equal(dispatchedAgain.status, 200);
    assert.match(prompts.at(-1) ?? "", /Review mode: delegate/);
    const releaseToken = /"token":"([^"]+)"/.exec(prompts.at(-1) ?? "")?.[1];
    assert.ok(releaseToken);
    assert.equal((await verdict("approved")).status, 403);
    recorded.length = 0;
    const released = await post("/api/pr/record-review", {
        canonical,
        token: releaseToken,
        release: true,
    });
    assert.equal(released.status, 200);
    assert.equal(recorded.length, 0, "a release records no verdict");
    assert.equal((await verdict("approved")).status, 200);

    // A failed dispatch revokes its own token only.
    const keep = store.issueAutomaticReviewToken(canonical);
    failDispatch = true;
    const failed = await post("/api/pr/review", {
        canonical,
        mode: "delegate",
    });
    assert.equal(failed.status, 500);
    failDispatch = false;
    assert.equal(store.checkVerdictAllowed(canonical, "approved", keep), true);
    assert.equal(store.checkVerdictAllowed(canonical, "approved"), true);
    store.setReviewSession(canonical, "review-session");
    const reReview = await post("/api/pr/review", {
        canonical,
        mode: "with-me",
    });
    assert.deepEqual(await reReview.json(), { ok: true, reReview: true });
    assert.match(prompts.at(-1) ?? "", /Review mode: with-me/);
    assert.equal(
        (await post("/api/pr/review", { canonical, mode: "for-me" })).status,
        200,
    );
    assert.match(prompts.at(-1) ?? "", /review-session/);
    assert.match(prompts.at(-1) ?? "", /Review mode: for-me/);
    assert.equal(store.getPr(canonical)?.lane, "quick");
    store.markClosed(canonical, "completed");
    failDispatch = true;
    assert.equal((await client.archive.$post()).status, 500);
    assert.equal(store.getPr(canonical)?.reviewSessionId, "review-session");
    failDispatch = false;
    assert.deepEqual(await (await client.archive.$post()).json(), {
        dispatched: 1,
    });
    assert.match(prompts.at(-1) ?? "", /review-session/);
    assert.equal(store.getPr(canonical)?.reviewSessionId, null);
    assert.deepEqual(await (await client.archive.$post()).json(), {
        dispatched: 0,
    });
    assert.equal(
        (await client.pr.remove.$post({ json: { canonical } })).status,
        200,
    );
    assert.equal(store.getPr(canonical), null);
} finally {
    await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
