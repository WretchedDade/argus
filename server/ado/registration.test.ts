import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { handleApi, type ApiContext } from "../api.ts";
import { defaultConfig } from "../config.ts";
import { ArgusStore } from "../db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-registration-test-"));
const file = path.join(dir, "registration.json");
const envKeys = [
    "DEVSTART_ADO_CONFIG_PATH",
    "DEVSTART_ADO_CLIENT_ID",
    "DEVSTART_ADO_TENANT_ID",
] as const;
const previous = envKeys.map((key) => process.env[key]);
process.env.DEVSTART_ADO_CONFIG_PATH = file;
delete process.env.DEVSTART_ADO_CLIENT_ID;
delete process.env.DEVSTART_ADO_TENANT_ID;
const store = new ArgusStore(path.join(dir, "argus.db"));
const config = { ...defaultConfig(), adoAuth: "az" as const };
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
    saveConfig: () => {
        throw new Error(
            "Saving registration must not change provider settings",
        );
    },
    markSetupComplete: () => {},
    installBaselineSkill: () => ({ installed: false, reason: "skipped" }),
};
const server = createServer((req, res) => {
    void handleApi(req, res, context).catch(() => res.writeHead(500).end());
});
const valid = {
    clientId: "11111111-2222-3333-4444-555555555555",
    tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};
try {
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/auth/registration`;
    const post = (body: unknown) =>
        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    assert.deepEqual(await (await fetch(url)).json(), {
        clientId: "",
        tenantId: "",
        fromEnv: false,
    });
    const saved = await post({
        clientId: ` ${valid.clientId} `,
        tenantId: ` ${valid.tenantId} `,
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { ...valid, fromEnv: false });
    const stored = readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(stored), valid);
    assert.deepEqual(await (await fetch(url)).json(), {
        ...valid,
        fromEnv: false,
    });
    for (const [body, message] of [
        [{ ...valid, clientId: "" }, "Application (client) ID is required."],
        [
            { ...valid, clientId: "bad" },
            "Application (client) ID must be a GUID.",
        ],
        [{ ...valid, tenantId: "" }, "Directory (tenant) ID is required."],
        [
            { ...valid, tenantId: "common" },
            "Directory (tenant) ID must be a GUID.",
        ],
        [{ ...valid, tenantId: 7 }, "Directory (tenant) ID is required."],
        [null, "Application (client) ID is required."],
    ] as const) {
        const response = await post(body);
        assert.equal(response.status, 400);
        assert.ok((await response.json()).error.includes(message));
        assert.equal(readFileSync(file, "utf8"), stored);
    }
    const override = "99999999-8888-7777-6666-555555555555";
    process.env.DEVSTART_ADO_CLIENT_ID = override;
    assert.deepEqual(await (await fetch(url)).json(), {
        ...valid,
        clientId: override,
        fromEnv: true,
    });
    const edited = {
        ...valid,
        tenantId: "22222222-3333-4444-5555-666666666666",
    };
    const editedResponse = await post(edited);
    assert.equal(editedResponse.status, 200);
    assert.deepEqual(await editedResponse.json(), {
        ...edited,
        clientId: override,
        fromEnv: true,
    });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), edited);
    delete process.env.DEVSTART_ADO_CLIENT_ID;
    process.env.DEVSTART_ADO_TENANT_ID = override;
    assert.deepEqual(await (await fetch(url)).json(), {
        ...edited,
        tenantId: override,
        fromEnv: true,
    });
    assert.equal(config.adoAuth, "az");
    assert.deepEqual(store.getConfigOverrides(), {});
} finally {
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
    envKeys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
    });
}
console.log("registration API self-check OK");
