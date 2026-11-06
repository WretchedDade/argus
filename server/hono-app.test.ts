import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request, createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { hc } from "hono/client";
import { handleApi, type ApiContext } from "./api.ts";
import { createApp, isHonoRoute, type AppType } from "./app.ts";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-hono-test-"));
process.env.DEVSTART_ADO_CONFIG_PATH = path.join(dir, "ado-auth-config.json");
delete process.env.DEVSTART_ADO_CLIENT_ID;
delete process.env.DEVSTART_ADO_TENANT_ID;
const store = new ArgusStore(path.join(dir, "argus.db"));
const context = {
    store,
    getConfig: () => defaultConfig(),
} as unknown as ApiContext;
const server = createServer((req, res) => {
    void handleApi(req, res, context).catch(() => {
        res.writeHead(500).end();
    });
});

try {
    assert.equal(typeof createApp, "function");
    assert.equal(isHonoRoute("/api/auth/status"), true);
    assert.equal(isHonoRoute("/api/prs"), false);

    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;

    const send = (
        method: string,
        route: string,
        headers: Record<string, string> = {},
        payload = "{}",
    ) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = request(
                {
                    host: "127.0.0.1",
                    port,
                    method,
                    path: route,
                    headers: { Host: `127.0.0.1:${port}`, ...headers },
                },
                (res) => {
                    let body = "";
                    res.setEncoding("utf-8");
                    res.on("data", (chunk: string) => (body += chunk));
                    res.on("end", () =>
                        resolve({ status: res.statusCode ?? 0, body }),
                    );
                },
            );
            req.on("error", reject);
            req.end(method === "POST" ? payload : undefined);
        });
    const errorOf = (body: string) =>
        (JSON.parse(body) as { error: string }).error;
    const json = { "Content-Type": "application/json" };

    // Hono middleware rejects untrusted requests on the migrated routes.
    const badHost = await send("GET", "/api/auth/registration", {
        Host: "evil.example",
    });
    assert.equal(badHost.status, 403);
    assert.equal(errorOf(badHost.body), "Untrusted host.");

    const badOrigin = await send("GET", "/api/auth/registration", {
        Origin: "http://evil.example",
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(errorOf(badOrigin.body), "Untrusted origin.");

    const badType = await send("POST", "/api/auth/sign-in", {
        "Content-Type": "text/plain",
    });
    assert.equal(badType.status, 415);

    // Wrong method on a POST-only auth route is not found.
    const missing = await send("GET", "/api/auth/sign-in", json);
    assert.equal(missing.status, 404);
    assert.equal(errorOf(missing.body), "not found");

    // Missing fields get the store's validation message.
    const invalid = await send("POST", "/api/auth/registration", json);
    assert.equal(invalid.status, 400);
    assert.match(errorOf(invalid.body), /client\) ID is required/);

    // Valid JSON that is not an object gets the same message.
    for (const body of ["[]", "42", '"text"']) {
        const nonObject = await send(
            "POST",
            "/api/auth/registration",
            json,
            body,
        );
        assert.equal(nonObject.status, 400);
        assert.match(errorOf(nonObject.body), /client\) ID is required/);
    }

    // The typed client reaches the same routes, and bad values fail the store check.
    const client = hc<AppType>(`http://127.0.0.1:${port}`, {
        headers: json,
    }).api.auth;
    const badValues = await client.registration.$post({
        json: { clientId: "not-a-guid", tenantId: "" },
    });
    assert.equal(badValues.status, 400);
    const registration = await client.registration.$get();
    assert.equal(registration.status, 200);
    assert.equal((await registration.json()).fromEnv, false);

    // Routes that are not migrated still reach the old handler.
    const prs = await send("GET", "/api/prs");
    assert.equal(prs.status, 200);
    assert.deepEqual(JSON.parse(prs.body), { prs: [] });
    assert.equal(
        (await send("GET", "/api/prs", { Host: "evil.example" })).status,
        403,
    );
} finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
}
