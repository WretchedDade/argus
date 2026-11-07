import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serveStatic } from "./static.ts";

test("static assets never escape the build directory", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "argus-static-"));
    const distDir = path.join(temporary, "dist");
    const siblingDir = path.join(temporary, "dist-private");
    await mkdir(distDir);
    await mkdir(siblingDir);
    await writeFile(path.join(distDir, "index.html"), "index fallback");
    await writeFile(path.join(distDir, "app.js"), "safe asset");
    await writeFile(path.join(siblingDir, "secret.js"), "private content");

    let route = "/";
    const server = createServer((_req, res) => {
        void serveStatic(res, distDir, route);
    });
    try {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const url = `http://127.0.0.1:${address.port}/`;

        route = "/app.js";
        assert.equal(await (await fetch(url)).text(), "safe asset");

        for (const traversal of [
            "/../dist-private/secret.js",
            "/../../dist-private/secret.js",
            "/%2e%2e/dist-private/secret.js",
        ]) {
            route = traversal;
            assert.equal(
                await (await fetch(url)).text(),
                "index fallback",
                traversal,
            );
        }

        route = "/missing";
        assert.equal(await (await fetch(url)).text(), "index fallback");
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(temporary, { recursive: true, force: true });
    }
});
