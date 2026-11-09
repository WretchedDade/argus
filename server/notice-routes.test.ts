import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { hc } from "hono/client";
import { handleApi, type ApiContext } from "./api.ts";
import { isHonoRoute, type AppType } from "./app.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";
import type { Notice } from "./notices.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-notice-routes-"));
const store = new ArgusStore(path.join(dir, "argus.db"));
const notices: Notice[] = [
    {
        id: "storage",
        kind: "storage",
        title: "Storage",
        detail: "",
        prompt: "choose storage",
    },
    {
        id: "skill",
        kind: "skill-update",
        title: "Skill",
        detail: "",
        prompt: "merge skill",
    },
    { id: "app-update:1.0.0", kind: "app-update", title: "Update", detail: "" },
];
let updatesEnabled = true;
const dispatched: string[] = [];
const ctx = {
    store,
    getConfig: () => ({ ...defaultConfig(), checkForUpdates: updatesEnabled }),
    getNotices: () => notices,
    dispatch: async (message: string) => {
        dispatched.push(message);
    },
} as unknown as ApiContext;
const server = createServer((req, res) => {
    void handleApi(req, res, ctx).catch(() => res.writeHead(500).end());
});

try {
    for (const route of [
        "/api/notices",
        "/api/notices/act",
        "/api/notices/check",
        "/api/notices/dismiss",
        "/api/version",
        "/api/skill/replace",
        "/api/update/apply",
        "/api/update/status",
    ])
        assert.equal(isHonoRoute(route), true, route);
    assert.equal(isHonoRoute("/api/notices-other"), false);
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = hc<AppType>(`http://127.0.0.1:${address.port}`, {
        headers: { "content-type": "application/json" },
    }).api;
    const send = async (route: string, method = "POST", body?: unknown) =>
        fetch(`http://127.0.0.1:${address.port}${route}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const expect = async (
        response: Response,
        status: number,
        body: unknown,
    ) => {
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), body);
    };

    for (const route of [
        "/api/version",
        "/api/notices",
        "/api/update/status",
    ]) {
        assert.equal((await send(route, "HEAD")).status, 404);
    }
    await expect(await send("/api/version", "GET"), 200, { version: null });
    ctx.appVersion = "0.12.3";
    await expect(await send("/api/version", "GET"), 200, { version: "0.12.3" });
    store.dismissNotice("skill");
    const visible: unknown = await (await client.notices.$get()).json();
    assert.deepEqual(visible, {
        notices: [
            { id: "storage", kind: "storage", title: "Storage", detail: "" },
            {
                id: "app-update:1.0.0",
                kind: "app-update",
                title: "Update",
                detail: "",
            },
        ],
    });
    await expect(
        await send("/api/notices/act", "POST", { id: "missing" }),
        404,
        { error: "no action for that notice" },
    );
    await expect(
        await send("/api/notices/act", "POST", { id: "storage" }),
        200,
        { ok: true },
    );
    assert.equal(store.getDismissedNotices().includes("storage"), false);
    await expect(await send("/api/notices/act", "POST", { id: "skill" }), 200, {
        ok: true,
    });
    assert.deepEqual(dispatched, ["choose storage", "merge skill"]);
    store.restoreNotice("skill");
    const dispatch = ctx.dispatch;
    ctx.dispatch = async () => {
        throw new Error("Dispatch failed");
    };
    assert.equal(
        (await send("/api/notices/act", "POST", { id: "skill" })).status,
        500,
    );
    assert.equal(store.getDismissedNotices().includes("skill"), false);
    ctx.dispatch = dispatch;
    for (const id of ["", 1, null]) {
        await expect(await send("/api/notices/dismiss", "POST", { id }), 400, {
            error: "id is required",
        });
    }
    await expect(
        await send("/api/notices/dismiss", "POST", { id: "storage" }),
        200,
        { ok: true },
    );
    assert.ok(store.getDismissedNotices().includes("storage"));
    await expect(await send("/api/notices/check"), 501, {
        error: "Update check is not available.",
    });
    ctx.checkForUpdatesNow = async () => ({
        ok: true,
        latest: "1.0.0",
        updateAvailable: true,
    });
    updatesEnabled = false;
    await expect(await send("/api/notices/check"), 409, {
        error: "Update checks are turned off.",
    });
    updatesEnabled = true;
    store.dismissNotice("app-update:1.0.0");
    await expect(await send("/api/notices/check"), 200, {
        ok: true,
        latest: "1.0.0",
        updateAvailable: true,
    });
    assert.equal(
        store.getDismissedNotices().includes("app-update:1.0.0"),
        false,
    );
    await expect(await send("/api/skill/replace"), 501, {
        error: "Replacing the skill needs the Copilot app.",
    });
    ctx.useBundledSkill = () => {
        throw new Error("Cannot write skill");
    };
    store.restoreNotice("skill");
    await expect(await send("/api/skill/replace"), 500, {
        error: "Cannot write skill",
    });
    assert.equal(store.getDismissedNotices().includes("skill"), false);
    ctx.useBundledSkill = () => ({ backupPath: "skill.backup" });
    await expect(await send("/api/skill/replace"), 200, {
        ok: true,
        backupPath: "skill.backup",
    });
    assert.ok(store.getDismissedNotices().includes("skill"));
    await expect(await send("/api/update/apply"), 501, {
        error: "Installing needs the Copilot app. Upgrade by hand with install.ps1 from the release ZIP.",
    });
    await expect(await send("/api/update/status", "GET"), 200, {
        phase: "idle",
        error: null,
    });
    let finishUpdate!: () => void;
    ctx.applyUpdate = async (setPhase) => {
        setPhase("installing");
        await new Promise<void>((resolve) => {
            finishUpdate = resolve;
        });
    };
    await expect(await send("/api/update/apply"), 202, {
        phase: "installing",
        error: null,
    });
    await expect(await send("/api/update/apply"), 409, {
        error: "An update is already running.",
    });
    assert.equal(
        store.getDismissedNotices().includes("app-update:1.0.0"),
        false,
    );
    finishUpdate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(await send("/api/update/status", "GET"), 200, {
        phase: "done",
        error: null,
    });
    assert.ok(store.getDismissedNotices().includes("app-update:1.0.0"));
    ctx.applyUpdate = async () => {
        throw new Error("Update failed");
    };
    store.restoreNotice("app-update:1.0.0");
    assert.equal((await send("/api/update/apply")).status, 202);
    await expect(await send("/api/update/status", "GET"), 200, {
        phase: "error",
        error: "Update failed",
    });
    assert.equal(
        store.getDismissedNotices().includes("app-update:1.0.0"),
        false,
    );
    ctx.getNotices = () => [];
    await expect(await send("/api/skill/replace"), 404, {
        error: "No skill update is pending.",
    });
    await expect(await send("/api/update/apply"), 404, {
        error: "No update is available to install.",
    });
    await expect(await send("/api/notices/check", "GET"), 404, {
        error: "not found",
    });
    await expect(await send("/api/notices/dismiss", "POST", "{"), 400, {
        error: "id is required",
    });
    await expect(await send("/api/notices/dismiss"), 400, {
        error: "id is required",
    });
    await expect(await send("/api/notices/act"), 404, {
        error: "no action for that notice",
    });
    const url = `http://127.0.0.1:${address.port}/api/notices`;
    await expect(
        await fetch(url, { headers: { Origin: "https://evil.example" } }),
        403,
        { error: "Untrusted origin." },
    );
    await expect(
        await fetch(`${url}/dismiss`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "{}",
        }),
        415,
        { error: "Content-Type must be application/json." },
    );
    assert.equal((await client.notices.$get()).status, 200);
} finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
