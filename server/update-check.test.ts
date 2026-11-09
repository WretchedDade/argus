import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fetchLatestRelease } from "./update-check.ts";
import { logger } from "./log.ts";

test("release check failures stay quiet by default and have safe debug details", async () => {
    const lines: string[] = [];
    const output = mock.method(process.stderr, "write", (line: string) => {
        lines.push(line);
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
        assert.equal((JSON.parse(lines[1]) as { status: number }).status, 403);
    } finally {
        logger.level = previousLevel;
        output.mock.restore();
    }
});
