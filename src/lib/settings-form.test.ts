import assert from "node:assert/strict";
import { validateIntegerSetting } from "./settings-form.ts";
import { describe, it } from "vitest";

describe("src/lib/settings-form", () => {
    it("rejects empty, non-integer, and unsafe numeric input", async () => {
        for (const value of [
            "",
            " ",
            "not a number",
            "1.5",
            "Infinity",
            "9007199254740992",
        ])
            assert.ok(
                validateIntegerSetting(value, 0, 23),
                `Reject invalid numeric input: ${JSON.stringify(value)}.`,
            );
    });
    it("validates inclusive integer bounds", async () => {
        assert.equal(validateIntegerSetting("0", 0, 23), undefined);
        assert.equal(validateIntegerSetting("23", 0, 23), undefined);
        assert.ok(validateIntegerSetting("-1", 0, 23));
        assert.ok(validateIntegerSetting("24", 0, 23));
    });
    it("requires a positive day count", async () => {
        assert.ok(
            validateIntegerSetting("", 1),
            "An empty day count is not zero.",
        );
        assert.ok(validateIntegerSetting("0", 1));
        assert.equal(validateIntegerSetting("1", 1), undefined);
        assert.equal(validateIntegerSetting("365", 1), undefined);
    });
});
