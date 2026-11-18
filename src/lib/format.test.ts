import assert from "node:assert/strict";
import { test } from "node:test";
import { authorType, voteLabel } from "./format.ts";

test("classifies automated authors before vendor and FTE authors", () => {
    for (const name of [
        "Dependabot",
        "Renovate",
        "Preview Bot",
        "Build Service",
        "Azure Pipelines",
        "Preview Automation",
        "Agency",
    ]) {
        assert.equal(authorType(name, false), "Automated", name);
        assert.equal(authorType(name, true), "Automated", name);
    }
    assert.equal(authorType("Synthetic Engineer", false), "FTE");
    assert.equal(authorType("Synthetic Engineer (Vendor)", true), "Vendor");
    assert.equal(authorType("Robotics Engineer", false), "FTE");
    assert.equal(authorType(null, false), "FTE");
    assert.equal(authorType(null, true), "Vendor");
});

test("labels votes consistently at each threshold", () => {
    for (const [vote, label] of [
        [11, "Approved"],
        [10, "Approved"],
        [5, "Approved with suggestions"],
        [4, "Vote reset"],
        [0, "Vote reset"],
        [-4, "Vote reset"],
        [-5, "Waiting on author"],
        [-10, "Rejected"],
        [-11, "Rejected"],
    ] as const)
        assert.equal(voteLabel(vote), label);
});
