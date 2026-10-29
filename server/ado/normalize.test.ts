import assert from "node:assert/strict";
import { normalizePr } from "./normalize.ts";
import { classifyOwnership } from "./ownership.ts";
import type { AdoRawPr } from "./types.ts";

const raw: AdoRawPr = {
    pullRequestId: 1,
    title: "Required group metadata",
    status: "active",
    isDraft: false,
    creationDate: new Date().toISOString(),
    reviewers: [
        { displayName: "Required team", isContainer: true, isRequired: true },
        { displayName: "Required team", isContainer: true, isRequired: true },
        { displayName: "Optional team", isContainer: true, isRequired: false },
        { displayName: "Unspecified team", isContainer: true },
        { displayName: "Required person", isRequired: true },
        { isContainer: true, isRequired: true },
    ],
};
const normalize = (pr: AdoRawPr) =>
    normalizePr(
        pr,
        "org",
        "project",
        classifyOwnership(pr, "me", ["Optional team"]),
    );
assert.deepEqual(normalize(raw).teams, ["Optional team"]);
assert.deepEqual(normalize(raw).requiredApproverGroups, ["Required team"]);
assert.deepEqual(
    normalize({ ...raw, reviewers: [] }).requiredApproverGroups,
    [],
);
assert.deepEqual(
    normalize({ ...raw, reviewers: undefined }).requiredApproverGroups,
    [],
);
assert.equal(normalize(raw).projectId, "");
assert.equal(
    normalize({ ...raw, repository: { project: { id: "p-guid" } } }).projectId,
    "p-guid",
);

console.log("required approver group self-check OK");
