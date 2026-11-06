import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ActivityEntriesResponseSchema,
    ActivityEventSchema,
    ActivityFeedSchema,
    type ActivityEvent,
} from "./activity.ts";

const event: ActivityEvent = {
    id: 1,
    ts: "2026-01-01T00:00:00Z",
    type: "reviewed",
    role: "reviewer",
    pr: {
        canonical: "org/proj/repo/1",
        org: "org",
        project: "proj",
        repo: "repo",
        number: 1,
        title: "Title",
        author: null,
        isVendor: false,
        teams: [],
        url: "https://example.test/pr/1",
    },
    verdict: "approved",
    vote: 10,
    activeComments: null,
    resolvedComments: null,
    reviewSessionId: null,
};

test("ActivityEventSchema accepts a valid event", () => {
    assert.deepEqual(ActivityEventSchema.parse(event), event);
});

test("ActivityEventSchema rejects a triage verdict and an unknown type", () => {
    assert.equal(
        ActivityEventSchema.safeParse({ ...event, verdict: "needs" }).success,
        false,
    );
    assert.equal(
        ActivityEventSchema.safeParse({ ...event, type: "snoozed" }).success,
        false,
    );
});

test("ActivityFeedSchema rejects a malformed event list", () => {
    const feed = { since: "a", until: "b", generatedAt: "c" };
    assert.equal(
        ActivityFeedSchema.safeParse({ ...feed, events: [{}] }).success,
        false,
    );
    assert.equal(
        ActivityFeedSchema.parse({ ...feed, events: [event] }).events.length,
        1,
    );
});

test("ActivityEntriesResponseSchema rejects a malformed entry", () => {
    assert.equal(
        ActivityEntriesResponseSchema.safeParse({ entries: [{ id: "x" }] })
            .success,
        false,
    );
});
