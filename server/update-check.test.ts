import assert from "node:assert/strict";
import {
    fetchLatestPluginRelease,
    fetchLatestRelease,
} from "./update-check.ts";
import { logger } from "./log.ts";
import { describe, it, vi } from "vitest";

describe("server/update-check", () => {
    it("reads the published plugin manifest, not the latest ZIP release", async () => {
        const fetchFn = vi.fn<typeof fetch>(async () =>
            Response.json({ name: "argus", version: "0.3.0" }),
        );
        assert.deepEqual(await fetchLatestPluginRelease(fetchFn), {
            version: "0.3.0",
            url: "https://github.com/WretchedDade/argus/releases/tag/v0.3.0",
        });
        const [url, options] = fetchFn.mock.calls[0];
        assert.equal(
            url,
            "https://api.github.com/repos/WretchedDade/argus/contents/.claude-plugin/plugin.json?ref=plugin",
        );
        assert.equal(
            new Headers(options?.headers).get("Accept"),
            "application/vnd.github.raw+json",
        );
        assert.ok(options?.signal);
    });

    it("rejects unavailable or invalid published plugin versions", async () => {
        for (const body of [
            null,
            {},
            { version: 3 },
            { version: "0.3.0-beta.1" },
            { tag_name: "v0.3.0" },
        ]) {
            assert.equal(
                await fetchLatestPluginRelease(async () => Response.json(body)),
                null,
            );
        }
        assert.equal(
            await fetchLatestPluginRelease(
                async () => new Response(null, { status: 404 }),
            ),
            null,
        );
        assert.equal(
            await fetchLatestPluginRelease(async () => {
                throw new Error("offline");
            }),
            null,
        );
    });

    it("release check failures stay quiet by default and have safe debug details", async () => {
        const lines: string[] = [];
        const output = vi
            .spyOn(process.stderr, "write")
            .mockImplementation((line) => {
                lines.push(String(line));
                return true;
            });
        const previousLevel = logger.level;
        const unavailable = async () => {
            throw new Error("private-upstream-text");
        };
        try {
            logger.level = "info";
            assert.equal(await fetchLatestRelease(unavailable), null);
            assert.equal(lines.length, 0);
            logger.level = "debug";
            assert.equal(await fetchLatestRelease(unavailable), null);
            assert.equal(
                await fetchLatestRelease(
                    async () => new Response(null, { status: 403 }),
                ),
                null,
            );
            assert.equal(
                await fetchLatestRelease(async () =>
                    Response.json({ tag_name: "bad" }),
                ),
                null,
            );
            assert.equal(lines.length, 3);
            assert.doesNotMatch(lines.join(""), /private-/);
            assert.equal(
                (JSON.parse(lines[1]) as { status: number }).status,
                403,
            );
        } finally {
            logger.level = previousLevel;
            output.mockRestore();
        }
    });
});
