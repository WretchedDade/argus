import assert from "node:assert/strict";
import { computeRhythm, countReviewSittings } from "./review-rhythm.ts";
import { describe, it } from "vitest";

describe("src/lib/review-rhythm", () => {
    it("counts sittings with an inclusive 45-minute gap", () => {
        assert.equal(countReviewSittings([]), 0);
        assert.equal(countReviewSittings([540]), 1);
        const minutes = [631, 585, 540, 585];
        assert.equal(countReviewSittings(minutes), 2);
        assert.deepEqual(minutes, [631, 585, 540, 585]);
        assert.equal(countReviewSittings([540, 585, 630]), 1);
    });

    it("recap balance includes local Monday and excludes the next Monday", (t) => {
        const previousTimezone = process.env.TZ;
        process.env.TZ = "America/New_York";
        t.onTestFinished(() => {
            if (previousTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = previousTimezone;
        });
        const result = computeRhythm(
            [
                { at: new Date(2026, 10, 9, 0, 30).toISOString() },
                { at: new Date(2026, 10, 9, 1, 15).toISOString() },
                { at: new Date(2026, 10, 16, 0, 30).toISOString() },
            ],
            [
                { key: "2026-11-08", inflow: 5, throughput: 0, level: 8 },
                { key: "2026-11-09", inflow: 2, throughput: 1, level: 4 },
                { key: "2026-11-10", inflow: 0, throughput: 0, level: 0 },
                { key: "2026-11-16", inflow: 0, throughput: 0, level: 0 },
            ],
            3,
            {
                start: new Date(2026, 10, 9).getTime(),
                end: new Date(2026, 10, 16).getTime(),
            },
        );
        assert.deepEqual(result, {
            sittings: 1,
            busiest: { key: "2026-11-09", count: 2 },
            activeDays: 1,
            behind: 1,
            overload: 1,
        });
        assert.equal(
            computeRhythm(
                [],
                [{ key: "2026-11-16", inflow: 3, throughput: 0, level: 5 }],
                3,
                {
                    start: new Date(2026, 10, 9).getTime(),
                    end: new Date(2026, 10, 16).getTime(),
                },
            ).activeDays,
            0,
        );
    });
});
