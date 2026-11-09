import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { hc } from "hono/client";
import { handleApi, type ApiContext } from "../api.ts";
import { isHonoRoute, type AppType } from "../app.ts";
import { defaultConfig } from "../config.ts";
import { ArgusStore } from "../db.ts";
import { ActivityFeedSchema } from "#shared/schemas/activity";

test("activity routes belong to Hono", () => {
    for (const route of [
        "/api/activity",
        "/api/pr-activity",
        "/api/runs",
        "/api/run",
        "/api/changes",
        "/api/changes/read",
        "/api/changes/read-all",
    ])
        assert.equal(isHonoRoute(route), true, route);
    assert.equal(isHonoRoute("/api/activity/missing"), false);
});

test("activity API preserves logs, run detail, change actions, and the Clio feed", async () => {
    const store = new ArgusStore(":memory:");
    const context: ApiContext = {
        store,
        bootAt: new Date().toISOString(),
        reconcile: async () => null,
        deleteAllData: async () => {},
        refreshPr: async () => {},
        trackPr: async () => ({ ok: false }),
        recordReview: () => {},
        dispatch: async () => {},
        pollerStatus: () => ({
            me: null,
            authOk: true,
            running: false,
            currentRunId: null,
            lastRunAt: null,
            lastSummary: null,
            lastError: null,
        }),
        getConfig: defaultConfig,
        saveConfig: defaultConfig,
        markSetupComplete: () => {},
        installBaselineSkill: () => ({ installed: false }),
    };
    const server = createServer((req, res) => {
        void handleApi(req, res, context).catch(() => {
            res.writeHead(500).end();
        });
    });
    try {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}`;
        const client = hc<AppType>(base, {
            headers: { "content-type": "application/json" },
        }).api;
        const get = async (route: string) => {
            const response = await fetch(`${base}/api/${route}`);
            assert.equal(response.status, 200, route);
            return response.json() as Promise<unknown>;
        };
        const post = (route: string, body = "") =>
            fetch(`${base}/api/${route}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body,
            });
        const runId = store.startPollRun("2026-01-02T00:00:00.000Z");
        store.finishPollRun(runId, { ok: true, added: 2 });
        store.recordActivity("info", "first", { count: 2 }, runId);
        store.recordActivity("info", "second");
        assert.deepEqual(await get("activity"), {
            entries: store.listActivity(),
        });
        assert.deepEqual(await get("activity?limit=1"), {
            entries: store.listActivity(1),
        });
        assert.deepEqual(await get("activity?limit=1&limit=2"), {
            entries: store.listActivity(1),
        });
        const postActivity = await post("activity");
        assert.equal(postActivity.status, 200);
        assert.deepEqual(await postActivity.json(), {
            entries: store.listActivity(),
        });
        assert.deepEqual(await get("runs"), { runs: store.listPollRuns() });
        assert.deepEqual(await get("runs?limit=0"), { runs: [] });
        assert.deepEqual(await get("runs?limit=1"), {
            runs: store.listPollRuns(1),
        });
        assert.deepEqual(
            await (await client.runs.$get({ query: { limit: "1" } })).json(),
            { runs: store.listPollRuns(1) },
        );

        const canonical =
            "https://example.test/project/_git/repo/pullrequest/1";
        store.upsertPr({
            canonical,
            org: "example",
            project: "project",
            repo: "repo",
            number: 1,
            title: "Test PR",
            description: "",
            author: "Author",
            isVendor: false,
            role: "author",
            teams: [],
            isDraft: false,
            sourceBranch: "feature",
            targetBranch: "main",
            lastCommitSha: "sha",
            lastCommitAt: "2026-01-02T00:00:00.000Z",
            prCreatedAt: "2026-01-02T00:00:00.000Z",
        });
        store.appendEvent(
            canonical,
            "added",
            {},
            "2026-01-02T00:00:00.000Z",
            runId,
        );
        store.appendEvent(
            canonical,
            "closed",
            { reason: "completed" },
            "2026-01-03T00:00:00.000Z",
            runId,
        );
        assert.deepEqual(await get(`run?id=${runId}`), {
            run: store.getRun(runId),
            entries: store.listActivityForRun(runId),
            changes: store.listRunEvents(runId),
        });
        assert.deepEqual(await get("run?id=9999"), {
            run: null,
            entries: [],
            changes: [],
        });
        for (const query of ["", "?id=0", "?id=invalid"]) {
            const response = await fetch(`${base}/api/run${query}`);
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: "id required" });
        }

        const until = "2026-01-03T00:00:00.000Z";
        const feed = ActivityFeedSchema.parse(
            await get(`pr-activity?until=${until}`),
        );
        assert.equal(feed.since, "2026-01-02T00:00:00.000Z");
        assert.equal(feed.until, until);
        assert.ok(Number.isFinite(Date.parse(feed.generatedAt)));
        assert.deepEqual(
            feed.events,
            store.listPrActivity(Date.parse(feed.since), Date.parse(until)),
        );
        assert.deepEqual(
            feed.events.map((event) => event.type),
            ["authored_opened"],
        );
        const explicit = ActivityFeedSchema.parse(
            await get(`pr-activity?since=${until}&until=2026-01-04T00:00:00Z`),
        );
        assert.deepEqual(
            explicit.events.map((event) => event.type),
            ["authored_merged"],
        );
        const current = ActivityFeedSchema.parse(await get("pr-activity"));
        assert.equal(
            Date.parse(current.until) - Date.parse(current.since),
            86_400_000,
        );
        for (const field of ["since", "until"]) {
            const response = await fetch(
                `${base}/api/pr-activity?${field}=invalid`,
            );
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), {
                error: `${field} must be ISO8601`,
            });
        }

        store.appendEvent(canonical, "added");
        assert.deepEqual(await get("changes"), {
            changes: store.listUnreadChanges(),
        });
        assert.ok(store.listUnreadChanges().length > 0);
        const invalid = await post("changes/read", "{}");
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), { error: "canonical required" });
        const empty = await post("changes/read");
        assert.equal(empty.status, 400);
        assert.deepEqual(await empty.json(), { error: "canonical required" });
        const read = await client.changes.read.$post({ json: { canonical } });
        assert.equal(read.status, 200);
        assert.deepEqual(await read.json(), { ok: true });
        assert.deepEqual(await get("changes"), { changes: [] });
        store.appendEvent(canonical, "fte_woke");
        assert.ok(store.listUnreadChanges().length > 0);
        const readAll = await client.changes["read-all"].$post();
        assert.equal(readAll.status, 200);
        assert.deepEqual(await readAll.json(), { ok: true });
        assert.deepEqual(await get("changes"), { changes: [] });
        assert.equal((await fetch(`${base}/api/changes/read`)).status, 404);
        assert.equal((await fetch(`${base}/api/changes/read-all`)).status, 404);
        assert.equal(
            (
                await fetch(`${base}/api/activity`, {
                    headers: { origin: "http://untrusted.example" },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await fetch(`${base}/api/changes/read`, {
                    method: "POST",
                    headers: { "content-type": "text/plain" },
                    body: "{}",
                })
            ).status,
            415,
        );
        for (let i = 0; i < 105; i++) {
            store.recordActivity("info", "entry");
            if (i < 55) store.startPollRun();
        }
        const activity = await client.activity.$get({
            query: { limit: undefined },
        });
        assert.equal((await activity.json()).entries.length, 100);
        const runs = await client.runs.$get({ query: { limit: undefined } });
        assert.equal((await runs.json()).runs.length, 50);
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
        store.close();
    }
});
