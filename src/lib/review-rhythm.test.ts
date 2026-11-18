import assert from "node:assert/strict";
import { test } from "node:test";
import { countReviewSittings } from "./review-rhythm.ts";

test("counts sittings with an inclusive 45-minute gap", () => {
    assert.equal(countReviewSittings([]), 0);
    assert.equal(countReviewSittings([540]), 1);
    const minutes = [631, 585, 540, 585];
    assert.equal(countReviewSittings(minutes), 2);
    assert.deepEqual(minutes, [631, 585, 540, 585]);
    assert.equal(countReviewSittings([540, 585, 630]), 1);
});
