import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getRequestListener } from "@hono/node-server";
import { staticRoutes } from "./static.ts";

test("static files stay inside the client root and retain SPA fallback", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "argus static "));
    const dist = path.join(dir, "dist");
    const sibling = `${dist}2`;
    mkdirSync(dist);
    mkdirSync(sibling);
    writeFileSync(path.join(dist, "index.html"), "<main>Argus</main>");
    writeFileSync(path.join(dist, "app.js"), "export {};");
    writeFileSync(path.join(sibling, "outside.txt"), "outside the client");
    const server = createServer(getRequestListener(staticRoutes(dist).fetch));
    try {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const get = (route: string) =>
            new Promise<{ status: number; body: string; type?: string }>(
                (resolve, reject) => {
                    const req = request(
                        {
                            host: "127.0.0.1",
                            port: address.port,
                            path: route,
                        },
                        (res) => {
                            let body = "";
                            res.setEncoding("utf8");
                            res.on("data", (chunk: string) => (body += chunk));
                            res.on("end", () =>
                                resolve({
                                    status: res.statusCode ?? 0,
                                    body,
                                    type: res.headers["content-type"],
                                }),
                            );
                            res.on("error", reject);
                        },
                    );
                    req.on("error", reject);
                    req.end();
                },
            );
        const asset = await get("/app.js");
        assert.equal(asset.status, 200);
        assert.equal(asset.body, "export {};");
        assert.match(asset.type ?? "", /javascript/);
        for (const route of [
            "/",
            "/board",
            "/missing.js",
            "/../dist2/outside.txt",
            "/..\\dist2\\outside.txt",
            "/%2e%2e/dist2/outside.txt",
            "/%2e%2e%5cdist2%5coutside.txt",
        ]) {
            const page = await get(route);
            assert.equal(page.status, 200, route);
            assert.equal(page.body, "<main>Argus</main>", route);
        }
        rmSync(path.join(dist, "index.html"));
        const missingBuild = await get("/board");
        assert.equal(missingBuild.status, 500);
        assert.equal(
            missingBuild.body,
            "Argus client not built. Run `npm run build`.",
        );
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
    }
});
