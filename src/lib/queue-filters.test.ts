import assert from "node:assert/strict";
import {
    matchesQueueFilters,
    parseQueueFilters,
    queueFilterOptions,
} from "./queue-filters.ts";
import type { Pr } from "./api.ts";

const pr: Pr = {
    canonical: "https://example.test/pr/1",
    repo: "Repo A",
    number: 1,
    title: "Filter the queue",
    description: "",
    author: "Creator A",
    isVendor: false,
    role: "team",
    teams: ["Optional team"],
    requiredApproverGroups: ["Required team", "Other required team"],
    reviewState: "needs",
    otherVotes: [],
    lane: "review",
    state: "pending",
    isDraft: false,
    outOfScope: false,
    snoozedUntil: null,
    snoozeMode: null,
    reviewSessionId: null,
    reviewedSha: null,
    reviewCount: 0,
    changedFiles: null,
    authorMeta: null,
    prCreatedAt: null,
    updatedAt: "",
};

assert.equal(matchesQueueFilters(pr, {}), true);
assert.equal(matchesQueueFilters(pr, { group: "Required team" }), true);
assert.equal(matchesQueueFilters(pr, { group: "Other required team" }), true);
assert.equal(matchesQueueFilters(pr, { group: "Optional team" }), false);
assert.equal(matchesQueueFilters(pr, { creator: "Creator A" }), true);
assert.equal(matchesQueueFilters(pr, { repository: "Repo A" }), true);
assert.equal(
    matchesQueueFilters(pr, {
        group: "Required team",
        creator: "Creator A",
        repository: "Repo A",
    }),
    true,
);
assert.equal(
    matchesQueueFilters(pr, { group: "Required team", creator: "Creator B" }),
    false,
);
assert.equal(
    matchesQueueFilters(pr, { creator: "Creator A", repository: "Repo B" }),
    false,
);
assert.equal(
    matchesQueueFilters({ ...pr, author: null }, { creator: "Creator A" }),
    false,
);
assert.equal(
    matchesQueueFilters(
        { ...pr, requiredApproverGroups: [] },
        { group: "Required team" },
    ),
    false,
);

// Filtering is independent of triage state, so every section uses the same rules.
for (const change of [
    { lane: "quick" as const },
    { isDraft: true },
    { outOfScope: true },
    { snoozeMode: "fte" as const },
    { snoozedUntil: "2099-01-01" },
    { prCreatedAt: "2000-01-01" },
]) {
    assert.equal(
        matchesQueueFilters({ ...pr, ...change }, { repository: "Repo A" }),
        true,
    );
}

assert.deepEqual(
    queueFilterOptions([
        pr,
        pr,
        { ...pr, repo: "Repo B", author: null, requiredApproverGroups: [] },
        { ...pr, repo: "", author: " ", requiredApproverGroups: [""] },
    ]),
    {
        group: ["Other required team", "Required team"],
        creator: ["Creator A"],
        repository: ["Repo A", "Repo B"],
    },
);
assert.deepEqual(queueFilterOptions([]), {
    group: [],
    creator: [],
    repository: [],
});
assert.deepEqual(
    parseQueueFilters({ group: ["invalid"], creator: 42, repository: " " }),
    {
        group: undefined,
        creator: undefined,
        repository: undefined,
    },
);
const filters = {
    group: "[Project]\\Approvers & Owners",
    creator: "Creator A",
    repository: "Repo A",
};
assert.deepEqual(
    parseQueueFilters(
        Object.fromEntries(
            new URLSearchParams(new URLSearchParams(filters).toString()),
        ),
    ),
    filters,
);
assert.deepEqual(
    parseQueueFilters({ ...filters, unrelated: "ignored" }),
    filters,
);

console.log("queue filter self-check OK");
