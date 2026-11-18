import assert from "node:assert/strict";
import { UpdateJob } from "./update-job.ts";
import { logger } from "./log.ts";
import { describe, it, vi } from "vitest";

describe("server/update-job", () => {
    const tick = () => new Promise((r) => setImmediate(r));
    it("rejects overlapping updates and permits retries after failure", async () => {
        // A second start is refused while the first one runs.
        const job = new UpdateJob();
        assert.equal(job.status().phase, "idle");
        let finish!: () => void;
        const phases: string[] = [];
        assert.equal(
            job.start(async (setPhase) => {
                setPhase("installing");
                phases.push(job.status().phase);
                await new Promise<void>((r) => (finish = r));
            }),
            true,
        );
        assert.equal(
            job.start(async () => {}),
            false,
        );
        assert.deepEqual(phases, ["installing"]);
        finish();
        await tick();
        assert.deepEqual(job.status(), { phase: "done", error: null });

        // A failure keeps the message, and a new start is allowed afterwards.
        assert.equal(
            job.start(async () => {
                throw new Error("boom");
            }),
            true,
        );
        await tick();
        assert.deepEqual(job.status(), { phase: "error", error: "boom" });
        assert.equal(
            job.start(async () => {}),
            true,
        );
        await tick();
        assert.equal(job.status().phase, "done");
    });
    it("background update failures emit one safe diagnostic", async () => {
        const lines: string[] = [];
        const output = vi
            .spyOn(process.stderr, "write")
            .mockImplementation((line) => {
                lines.push(String(line));
                return true;
            });
        const previousLevel = logger.level;
        logger.level = "info";
        try {
            const update = new UpdateJob();
            update.start(async (setPhase) => {
                setPhase("verifying");
                throw new Error("private-upstream-text");
            });
            await tick();
            assert.deepEqual(update.status(), {
                phase: "error",
                error: "private-upstream-text",
            });
            assert.equal(lines.length, 1);
            const record = JSON.parse(lines[0]) as {
                level: number;
                phase: string;
                durationMs: number;
            };
            assert.equal(record.level, 50);
            assert.equal(record.phase, "verifying");
            assert.ok(record.durationMs >= 0);
            assert.doesNotMatch(lines[0], /private-/);
        } finally {
            logger.level = previousLevel;
            output.mockRestore();
        }
    });
});
