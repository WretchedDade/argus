import assert from "node:assert/strict";
import test from "node:test";
import {
    ApiError,
    describeLoadFailure,
    errorMessage,
    setupFormReady,
} from "./errors.ts";

test("describeLoadFailure explains a server error with its message", () => {
    const f = describeLoadFailure(
        new ApiError("/api/prs", 500, "database is locked"),
        "your pull requests",
    );
    assert.equal(f.headline, "Couldn't load your pull requests");
    assert.match(f.reason, /HTTP 500/);
    assert.match(f.reason, /database is locked/);
});

test("describeLoadFailure says the server is unreachable on a network error", () => {
    const f = describeLoadFailure(new TypeError("Failed to fetch"), "PRs");
    assert.match(f.reason, /could not reach the Argus server/);
});

test("describeLoadFailure flags unusable data on other errors", () => {
    const f = describeLoadFailure(
        new TypeError("x.filter is not a function"),
        "PRs",
    );
    assert.match(f.reason, /unexpected shape/);
});

test("ApiError keeps the old message when the server sends none", () => {
    assert.equal(
        new ApiError("/api/prs", 502, null).message,
        "/api/prs -> 502",
    );
});

test("errorMessage reads Error, string, and unknown values", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
    assert.equal(errorMessage("bad"), "bad");
    assert.equal(errorMessage(undefined), "Something went wrong.");
    assert.equal(errorMessage(new Error("")), "Something went wrong.");
});

test("setupFormReady waits for the config query to succeed", () => {
    assert.equal(setupFormReady({ isSuccess: false }), false);
    assert.equal(setupFormReady({ isSuccess: true }), true);
});
