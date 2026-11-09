import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createServer } from "node:http";
import type { ApiContext } from "./api.ts";
import { createHonoHandler } from "./app.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";
import { logger } from "./log.ts";

test("HTTP diagnostics identify failures once without logging request data", async () => {
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
        appVersion: "0.0.0",
        checkForUpdatesNow: async () => {
            throw new Error("private-upstream-text");
        },
        getNotices: () => [
            {
                id: "skill-update:test",
                kind: "skill-update",
                title: "Test",
                detail: "Test",
            },
        ],
        useBundledSkill: () => {
            throw new Error("private-upstream-text");
        },
    };
    const handler = createHonoHandler(context);
    const server = createServer((req, res) => {
        void handler(req, res).catch(() => {
            res.writeHead(500).end();
        });
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const lines: string[] = [];
    const output = mock.method(process.stderr, "write", (line: string) => {
        lines.push(line);
        return true;
    });
    const previousLevel = logger.level;
    logger.level = "info";
    try {
        const healthy = await fetch(`${base}/api/version?token=private-query`);
        assert.equal(healthy.status, 200);
        assert.ok(healthy.headers.get("X-Request-Id"));
        assert.equal(lines.length, 0);

        const failed = await fetch(
            `${base}/api/skill/replace?token=private-query`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "private-token",
                },
                body: JSON.stringify({ title: "private-title" }),
            },
        );
        assert.equal(failed.status, 500);
        assert.equal(lines.length, 1);
        const entry = JSON.parse(lines[0]) as {
            level: number;
            status: number;
            requestId: string;
            route: string;
            durationMs: number;
        };
        assert.equal(entry.level, 50);
        assert.equal(entry.status, 500);
        assert.equal(entry.route, "/api/skill/replace");
        assert.equal(entry.requestId, failed.headers.get("X-Request-Id"));
        assert.ok(entry.durationMs >= 0);
        assert.doesNotMatch(lines.join(""), /private-/);

        const unexpected = await fetch(`${base}/api/notices/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        assert.equal(unexpected.status, 500);
        assert.equal(lines.length, 2);
        assert.equal(
            (JSON.parse(lines[1]) as { requestId: string }).requestId,
            unexpected.headers.get("X-Request-Id"),
        );
        assert.doesNotMatch(lines[1], /private-/);
        logger.level = "debug";
        await fetch(`${base}/api/version`);
        assert.equal(lines.length, 3);
        assert.equal((JSON.parse(lines[2]) as { level: number }).level, 20);
    } finally {
        logger.level = previousLevel;
        output.mock.restore();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        store.close();
    }
});
