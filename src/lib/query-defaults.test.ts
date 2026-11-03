import assert from "node:assert/strict";
import test from "node:test";
import {
    claimPrRefresh,
    createQueryClient,
    releasePrRefresh,
    DEFAULT_STALE_TIME_MS,
} from "./query-defaults.ts";

test("the query client sets a non-zero default staleTime", () => {
    const opts = createQueryClient().getDefaultOptions().queries;
    assert.equal(opts?.staleTime, DEFAULT_STALE_TIME_MS);
    assert.ok(DEFAULT_STALE_TIME_MS > 0);
});

test("a PR refresh is claimed once per PR", () => {
    assert.equal(claimPrRefresh("org/proj/repo#1"), true);
    assert.equal(claimPrRefresh("org/proj/repo#1"), false);
    assert.equal(claimPrRefresh("org/proj/repo#2"), true);
});

test("a released PR refresh can be claimed again", () => {
    assert.equal(claimPrRefresh("org/proj/repo#3"), true);
    releasePrRefresh("org/proj/repo#3");
    assert.equal(claimPrRefresh("org/proj/repo#3"), true);
});
