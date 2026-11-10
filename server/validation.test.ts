import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { ApiContext } from "./api.ts";
import { createHonoHandler } from "./app.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";

test("API validation rejects malformed JSON and invalid field types before actions", async () => {
    const store = new ArgusStore(":memory:");
    let actions = 0;
    const context: ApiContext = {
        store,
        bootAt: new Date().toISOString(),
        reconcile: async () => null,
        deleteAllData: async () => {},
        trackPr: async () => ({ ok: false }),
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
        markSetupComplete: () => {},
        installBaselineSkill: () => ({ installed: false }),
        getConfig: defaultConfig,
        saveConfig: () => {
            actions++;
            return defaultConfig();
        },
        refreshPr: async () => {
            actions++;
        },
        recordReview: () => {
            actions++;
        },
        getNotices: () => [],
    };
    const server = createServer(createHonoHandler(context));
    try {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`;
        for (const route of [
            "/pr/refresh",
            "/config",
            "/setup",
            "/changes/read",
            "/notices/dismiss",
        ]) {
            const response = await fetch(`${base}${route}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{",
            });
            assert.equal(response.status, 400, route);
            assert.deepEqual(await response.json(), {
                error: "Malformed JSON in request body",
            });
        }
        for (const [route, body] of [
            ["/pr/refresh", { canonical: 42 }],
            ["/pr/record-review", { canonical: "missing", release: "yes" }],
            ["/pr/scope", { canonical: "missing", outOfScope: "false" }],
            ["/pr/snooze", { canonical: "missing", until: {} }],
            ["/archive/sweep", { canonicals: "not-an-array" }],
            ["/changes/read", { canonical: ["missing"] }],
            ["/notices/dismiss", null],
            ["/config", null],
            ["/setup", { installPrReviewSkill: "yes" }],
        ] as const) {
            const response = await fetch(`${base}${route}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            assert.equal(response.status, 400, route);
            assert.equal(
                typeof ((await response.json()) as { error: unknown }).error,
                "string",
            );
        }
        assert.equal(actions, 0);
        assert.equal(store.isStaleSweepApproved(), false);
        for (const route of [
            "/activity?limit=invalid",
            "/runs?limit=1.5",
            "/run?id=-1",
        ]) {
            const response = await fetch(`${base}${route}`);
            assert.equal(response.status, 400, route);
            assert.equal(
                typeof ((await response.json()) as { error: unknown }).error,
                "string",
            );
        }
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        store.close();
    }
});
