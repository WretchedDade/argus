import assert from "node:assert/strict";
import type { Pr } from "./api.ts";
import { filterTrackedPrs, trackedPrStatus } from "./tracked-prs.ts";
import { describe, it } from "vitest";

describe("src/lib/tracked-prs", () => {
    function fixture(number: number, overrides: Partial<Pr> = {}): Pr {
        return {
            canonical: `https://example.test/pr/${number}`,
            org: "org",
            project: "project",
            repo: "Preview.Repository",
            number,
            title: `Preview PR ${number}`,
            description: "",
            author: "Preview author",
            isVendor: false,
            role: "team",
            teams: ["Preview reviewers"],
            requiredApproverGroups: [],
            reviewState: "needs",
            otherVotes: [],
            lane: "review",
            state: "pending",
            isDraft: false,
            outOfScope: false,
            dismissed: false,
            dismissedReason: null,
            dismissedAt: null,
            snoozedUntil: null,
            snoozeMode: null,
            reviewSessionId: null,
            reviewedSha: null,
            reviewCount: 0,
            coveredAt: null,
            changedFiles: null,
            authorMeta: null,
            prCreatedAt: null,
            lastCommitSha: null,
            lastCommitAt: null,
            addedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            ...overrides,
        };
    }
    const active = fixture(1);
    const archived = fixture(2, {
        title: "Find archived review",
        dismissed: true,
        dismissedReason: "stale",
        dismissedAt: "2026-02-01T00:00:00.000Z",
    });
    const closedArchive = fixture(3, {
        title: "Find closed archive",
        state: "closed",
        dismissed: true,
        dismissedReason: "out_of_scope",
        dismissedAt: "2026-02-02T00:00:00.000Z",
    });
    const closed = fixture(4, { state: "closed" });
    const dismissed = fixture(5, {
        dismissed: true,
        dismissedReason: "manual",
        dismissedAt: "2026-02-03T00:00:00.000Z",
    });
    const prs = [active, archived, closedArchive, closed, dismissed];
    const original = [...prs];
    it("filters active and archived PRs without mutating cached data", async () => {
        assert.deepEqual(
            filterTrackedPrs(prs, "archived", "", {}),
            [closedArchive, archived],
            "Archived includes closed history, but not manual dismissals.",
        );
        assert.deepEqual(filterTrackedPrs(prs, "active", "", {}), [active]);
        assert.equal(filterTrackedPrs(prs, "all", "", {}).length, prs.length);
        assert.deepEqual(
            prs,
            original,
            "Sorting must not mutate the query cache.",
        );
    });
    it("searches archived PR metadata and team labels", async () => {
        for (const search of [
            "  ARCHIVED REVIEW  ",
            "#2",
            "preview.repository",
            "PREVIEW AUTHOR",
            archived.canonical,
            "Preview reviewers",
            "Short label",
        ]) {
            assert.ok(
                filterTrackedPrs(prs, "archived", search, {
                    "Preview reviewers": "Short label",
                }).includes(archived),
                `Archived PRs are searchable by ${search}.`,
            );
        }
        assert.deepEqual(
            filterTrackedPrs(prs, "archived", "missing search term", {}),
            [],
        );
    });
    it("labels archived, closed, and dismissed PRs", async () => {
        assert.equal(trackedPrStatus(closedArchive), "Archived");
        assert.equal(trackedPrStatus(closed), "Closed");
        assert.equal(trackedPrStatus(dismissed), "Dismissed");
    });
});
