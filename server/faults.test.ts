import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { faultMiddleware, parseFaults } from "./faults.ts";

test("parseFaults splits and trims the list", () => {
    assert.deepEqual([...parseFaults(" prs, setup ,")], ["prs", "setup"]);
    assert.equal(parseFaults(undefined).size, 0);
});

async function get(faults: string, path: string) {
    const set = parseFaults(faults);
    const app = new Hono()
        .use("*", faultMiddleware(set))
        .get("*", (c) => c.json({ setup_complete: true }));
    const server = createServer(getRequestListener(app.fetch));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = (await r.json()) as Record<string, unknown>;
    server.close();
    return { status: r.status, body };
}

test("the prs fault returns a 500", async () => {
    assert.equal((await get("prs", "/api/prs")).status, 500);
});

test("the prs-bad fault returns a malformed list", async () => {
    assert.equal((await get("prs-bad", "/api/prs")).body.prs, "not-a-list");
});

test("the config fault returns a 500", async () => {
    assert.equal((await get("config", "/api/config")).status, 500);
});

test("the setup fault marks setup incomplete", async () => {
    assert.equal(
        (await get("setup", "/api/health")).body.setup_complete,
        false,
    );
});

test("no fault leaves requests alone", async () => {
    assert.equal((await get("", "/api/health")).body.setup_complete, true);
});
