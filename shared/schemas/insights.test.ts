import assert from "node:assert/strict";
import { test } from "node:test";
import {
    InsightsResponseSchema,
    LoadDetailResponseSchema,
    WeeklyReviewFactsResponseSchema,
    type Insights,
} from "./insights.ts";

const insights: Insights = {
    generatedAt: "2026-01-01T00:00:00Z",
    summary: {
        reviewsAllTime: 0,
        firstReviewAt: null,
        lastReviewAt: null,
        trackingSince: null,
    },
    latency: {
        count: 0,
        pending: 0,
        medianHours: null,
        p90Hours: null,
        fastestHours: null,
        slowestHours: null,
        points: [],
        distribution: [],
    },
    throughput: { total: 0, weekly: [] },
    load: { daily: [], weekly: [], peak: { count: 0, at: null } },
    backlog: { waitingCount: 0, longestHours: null, buckets: [], longest: [] },
    distribution: { byTeam: [], byRepo: [], byAuthorType: [] },
    reach: {
        items: [
            {
                at: "2026-01-01T00:00:00Z",
                author: "a",
                vendor: false,
                repo: "repo",
                teams: [],
            },
        ],
    },
    votePattern: {
        byType: [],
        total: 0,
        avgComments: null,
        commentsMeasured: 0,
    },
    reviewDepth: {
        measured: 0,
        totalComments: 0,
        avg: null,
        median: null,
        p90: null,
        zeroRate: null,
        histogram: [],
        byType: [],
        byRepo: [],
        byLatency: [],
    },
    votePath: {
        measured: 0,
        outcomes: { firstPass: 0, gated: 0, held: 0 },
        turns: [],
    },
    reviewCoverage: { origins: [] },
    reviewRhythm: { items: [] },
    balance: { days: [], heavyLine: 0 },
    authored: {
        open: 0,
        completable: 0,
        blocked: 0,
        mergedCount: 0,
        medianMergeHours: null,
        openList: [],
    },
};

test("InsightsResponseSchema accepts valid insights", () => {
    assert.deepEqual(
        InsightsResponseSchema.parse({ insights }).insights,
        insights,
    );
});

test("InsightsResponseSchema rejects a missing section and a reach item without repo", () => {
    const { balance: _balance, ...missing } = insights;
    assert.equal(
        InsightsResponseSchema.safeParse({ insights: missing }).success,
        false,
    );
    const noRepo = {
        ...insights,
        reach: { items: [{ at: "x", author: "a", vendor: false, teams: [] }] },
    };
    assert.equal(
        InsightsResponseSchema.safeParse({ insights: noRepo }).success,
        false,
    );
});

test("LoadDetailResponseSchema rejects a bad granularity", () => {
    const detail = {
        key: "2026-01-01",
        endKey: "2026-01-01",
        granularity: "month",
        peakDayKey: "2026-01-01",
        arrived: [],
        reviewed: [],
        onPlate: [],
    };
    assert.equal(LoadDetailResponseSchema.safeParse({ detail }).success, false);
    assert.equal(
        LoadDetailResponseSchema.safeParse({
            detail: { ...detail, granularity: "week" },
        }).success,
        true,
    );
});

test("WeeklyReviewFactsResponseSchema rejects a malformed PR row", () => {
    const facts = {
        startKey: "a",
        endKey: "b",
        actionCount: 0,
        uniquePrCount: 0,
        prs: [{}],
        coverage: { sizeKnown: 0, commentsKnown: 0, scoreKnown: 0 },
        effort: { total: 0, average: null },
    };
    assert.equal(
        WeeklyReviewFactsResponseSchema.safeParse({ facts }).success,
        false,
    );
    assert.equal(
        WeeklyReviewFactsResponseSchema.safeParse({
            facts: { ...facts, prs: [] },
        }).success,
        true,
    );
});
