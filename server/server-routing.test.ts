import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultConfig } from "./config.ts";
import { ArgusStore } from "./db.ts";
import {
    startIngestServer,
    startServer,
    stopInstance,
    type Instance,
    type ServerContext,
} from "./server.ts";

test("canvas and ingest servers keep API routing separate from static files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "argus-server-routing-"));
    const store = new ArgusStore(":memory:");
    const context = {
        store,
        distDir: dir,
        getConfig: defaultConfig,
        appVersion: "0.0.0",
    } as ServerContext;
    const instance: Instance = {
        instanceId: path.basename(dir),
        server: null,
        url: null,
    };
    const previousFaults = process.env.ARGUS_FAKE_FAULT;
    process.env.ARGUS_FAKE_FAULT = "prs";
    writeFileSync(path.join(dir, "index.html"), "<main>Argus</main>");
    writeFileSync(path.join(dir, "asset.js"), "export {};");
    let ingest: ReturnType<typeof startIngestServer> | undefined;
    try {
        await startServer(instance, context);
        assert.ok(instance.url);
        const reservation = createServer();
        await new Promise<void>((resolve) =>
            reservation.listen(0, "127.0.0.1", resolve),
        );
        const address = reservation.address();
        assert.ok(address && typeof address !== "string");
        await new Promise<void>((resolve, reject) =>
            reservation.close((error) => (error ? reject(error) : resolve())),
        );
        ingest = startIngestServer(context, address.port);
        const ingestUrl = `http://127.0.0.1:${address.port}/`;
        for (const base of [instance.url, ingestUrl]) {
            const version = await fetch(`${base}api/version`);
            assert.equal(version.status, 200);
            assert.deepEqual(await version.json(), { version: "0.0.0" });
            for (const route of ["api/missing", "api/prs/extra"]) {
                const missing = await fetch(`${base}${route}`);
                assert.equal(missing.status, 404);
                assert.deepEqual(await missing.json(), { error: "not found" });
                const untrusted = await fetch(`${base}${route}`, {
                    headers: { Origin: "http://evil.example" },
                });
                assert.equal(untrusted.status, 403);
                assert.deepEqual(await untrusted.json(), {
                    error: "Untrusted origin.",
                });
                const wrongType = await fetch(`${base}${route}`, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain" },
                    body: "{}",
                });
                assert.equal(wrongType.status, 415);
                await wrongType.arrayBuffer();
            }
        }
        for (const route of ["", "board", "api"]) {
            const page: Response = await fetch(`${instance.url}${route}`);
            assert.equal(page.status, 200);
            assert.equal(await page.text(), "<main>Argus</main>");
        }
        assert.equal(
            await (await fetch(`${instance.url}asset.js`)).text(),
            "export {};",
        );
        const fault = await fetch(`${instance.url}api/prs`);
        assert.equal(fault.status, 500);
        assert.deepEqual(await fault.json(), { error: "Injected fault: prs" });
        const ingestPrs = await fetch(`${ingestUrl}api/prs`);
        assert.equal(ingestPrs.status, 200);
        assert.deepEqual(await ingestPrs.json(), { prs: [] });
        for (const [base, method] of [
            [instance.url, "POST"],
            [ingestUrl, "GET"],
        ]) {
            const missing = await fetch(`${base}board`, { method });
            assert.equal(missing.status, 404);
            assert.equal(await missing.text(), "");
        }
    } finally {
        ingest?.close();
        await stopInstance(instance);
        store.close();
        rmSync(dir, { recursive: true, force: true });
        if (previousFaults === undefined) delete process.env.ARGUS_FAKE_FAULT;
        else process.env.ARGUS_FAKE_FAULT = previousFaults;
    }
});
