import assert from "node:assert/strict";
import {
    ApiError,
    describeLoadFailure,
    errorMessage,
    setupFormReady,
} from "./errors.ts";
import { describe, it } from "vitest";

describe("src/lib/errors", () => {
    it("describeLoadFailure explains a server error with its message", () => {
        const f = describeLoadFailure(
            new ApiError("/api/prs", 500, "database is locked"),
            "your pull requests",
        );
        assert.equal(f.headline, "Couldn't load your pull requests");
        assert.match(f.reason, /HTTP 500/);
        assert.match(f.reason, /database is locked/);
    });

    it("describeLoadFailure says the server is unreachable on a network error", () => {
        const f = describeLoadFailure(new TypeError("Failed to fetch"), "PRs");
        assert.match(f.reason, /could not reach the Argus server/);
    });

    it("describeLoadFailure flags unusable data on other errors", () => {
        const f = describeLoadFailure(
            new TypeError("x.filter is not a function"),
            "PRs",
        );
        assert.match(f.reason, /unexpected shape/);
    });

    it("ApiError keeps the old message when the server sends none", () => {
        assert.equal(
            new ApiError("/api/prs", 502, null).message,
            "/api/prs -> 502",
        );
    });

    it("errorMessage reads Error, string, and unknown values", () => {
        assert.equal(errorMessage(new Error("boom")), "boom");
        assert.equal(errorMessage("bad"), "bad");
        assert.equal(errorMessage(undefined), "Something went wrong.");
        assert.equal(errorMessage(new Error("")), "Something went wrong.");
    });

    it("setupFormReady waits for config data and survives a failed refetch", () => {
        assert.equal(setupFormReady({ data: undefined }), false);
        assert.equal(setupFormReady({ data: { orgs: [] } }), true);
    });
});
