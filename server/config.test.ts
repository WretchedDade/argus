import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { handleApi, type ApiContext } from "./api.ts";
import { defaultConfig, loadLocalConfig, mergeConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-config-test-"));
const file = path.join(dir, "config.json");
const store = new ArgusStore(path.join(dir, "argus.db"));
let config = {
    ...defaultConfig(),
    orgUrl: "",
    orgSlug: "",
    project: "",
};
const configured = {
    orgUrl: "https://dev.azure.com/example-org",
    orgSlug: "example-org",
    project: "ExampleProject",
};
const context: ApiContext = {
    store,
    bootAt: new Date().toISOString(),
    migrated: { imported: 0 },
    reconcile: async () => null,
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
    getConfig: () => config,
    saveConfig: (overrides) => {
        config = mergeConfig(config, overrides);
        store.saveConfigOverrides(overrides);
        return config;
    },
    markSetupComplete: () => store.markSetupComplete(),
    installBaselineSkill: () => ({ installed: false, reason: "skipped" }),
};
const server = createServer((req, res) => {
    void handleApi(req, res, context).catch((err: unknown) => {
        console.error(err);
        res.writeHead(500).end();
    });
});

try {
    assert.deepEqual(loadLocalConfig(file), {});
    writeFileSync(file, JSON.stringify(configured));
    assert.deepEqual(loadLocalConfig(file), configured);

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const health = async () => {
        const response = await fetch(`${base}/api/health`);
        return (await response.json()) as { setup_complete: boolean };
    };
    assert.equal((await health()).setup_complete, false);

    config = mergeConfig(config, configured);
    store.markSetupComplete();
    assert.equal((await health()).setup_complete, true);

    for (const field of ["orgUrl", "orgSlug", "project"] as const) {
        config = { ...defaultConfig(), ...configured, [field]: "" };
        assert.equal(
            (await health()).setup_complete,
            false,
            `completed stores still need ${field}`,
        );
    }

    config = { ...defaultConfig(), orgUrl: "", orgSlug: "", project: "" };
    config.me = "reviewer@example.test";
    store.saveConfigOverrides({ me: config.me });
    assert.equal((await health()).setup_complete, false);

    const invalidSetup = await fetch(`${base}/api/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ me: config.me }),
    });
    assert.equal(invalidSetup.status, 400);
    assert.equal((await health()).setup_complete, false);

    const validSetup = await fetch(`${base}/api/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configured),
    });
    assert.equal(validSetup.status, 200);
    assert.equal((await health()).setup_complete, true);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message: string) => errors.push(message);
    try {
        for (const invalid of [
            { workDays: null },
            { teamPatterns: null },
            { workDays: ["Monday"] },
            { teamPatterns: [3] },
            { teamLabels: { team: 3 } },
            { periods: [null] },
            { periods: [{ label: "Week", start: 3, end: "2026-10-28" }] },
            { orgUrl: null },
            { workStartHour: "9" },
            { me: false },
            [],
            null,
        ]) {
            writeFileSync(file, JSON.stringify(invalid));
            const previousErrors = errors.length;
            assert.deepEqual(
                loadLocalConfig(file),
                {},
                JSON.stringify(invalid),
            );
            assert.equal(errors.length, previousErrors + 1);
        }
        writeFileSync(file, "{");
        assert.deepEqual(loadLocalConfig(file), {});
    } finally {
        console.error = originalError;
    }

    const overrides = {
        ...configured,
        me: null,
        teamPatterns: ["*Example Team*"],
        teamLabels: { team: "example" },
        workDays: [1, 2, 3, 4, 5],
        periods: [{ label: "Week", start: "2026-10-26", end: "2026-10-30" }],
    };
    writeFileSync(file, JSON.stringify({ ...overrides, unknownSetting: true }));
    assert.deepEqual(loadLocalConfig(file), overrides);

    const post = (route: string, body: unknown) =>
        fetch(`${base}${route}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    const before = JSON.stringify(config);
    const unsafe = [
        { project: "x & calc.exe" },
        { project: 'x" --output json & calc' },
        { project: "x|calc" },
        { project: "x\ncalc" },
        { project: "$(calc)" },
        { project: "..\\..\\x" },
        { project: "-x" },
        { orgSlug: "org;calc" },
        { orgUrl: "https://dev.azure.com/org & calc" },
        { orgUrl: "https://user:pw@dev.azure.com/org" },
        { orgUrl: "file:///c:/windows" },
        { orgUrl: "javascript:alert(1)" },
        { recencyDays: 1.5 },
        { recencyDays: 0 },
        { recencyDays: 100000 },
        { retentionDays: -1 },
        { workStartHour: 24 },
        { workEndHour: 25 },
        { workDays: [7] },
        { adoAuth: "cmd" },
    ];
    for (const route of ["/api/config", "/api/setup"]) {
        for (const body of unsafe) {
            const response = await post(route, body);
            assert.equal(
                response.status,
                400,
                `${route} ${JSON.stringify(body)}`,
            );
        }
    }
    assert.equal(JSON.stringify(config), before, "rejected input is not saved");

    const accepted = await post("/api/config", {
        project: "My Project (1)".replace(/[()]/g, ""),
        recencyDays: 14,
        workStartHour: 8,
        workEndHour: 24,
        unknownKey: "ignored",
    });
    assert.equal(accepted.status, 200);
    assert.equal(config.project, "My Project 1");
    assert.equal(config.recencyDays, 14);
    assert.equal(Object.hasOwn(config, "unknownKey"), false);

    // Saved settings that are unsafe are dropped when read back.
    const errorsBefore = errors.length;
    console.error = (message: string) => errors.push(message);
    try {
        store.saveConfigOverrides({
            project: "x & calc",
            recencyDays: 3,
        } as never);
        assert.deepEqual(store.getConfigOverrides(), { recencyDays: 3 });
        assert.equal(errors.length, errorsBefore + 1);

        // Unsafe environment values fall back to safe defaults.
        process.env.ARGUS_PROJECT = "x & calc";
        process.env.ARGUS_RECENCY_DAYS = "abc";
        const fromEnv = defaultConfig();
        assert.equal(fromEnv.project, "");
        assert.equal(fromEnv.recencyDays, 7);
    } finally {
        console.error = originalError;
        delete process.env.ARGUS_PROJECT;
        delete process.env.ARGUS_RECENCY_DAYS;
    }
} finally {
    await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
}

console.log("config self-check OK");
