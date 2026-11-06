// Insights, load detail, and weekly review wire shapes. Import from here only.

import { z } from "zod";
import { LaneSchema } from "./pr.ts";

export const InsightsCountSchema = z.object({
    label: z.string(),
    count: z.number(),
});
export type InsightsCount = z.infer<typeof InsightsCountSchema>;

export const LoadDayPrSchema = z.object({
    canonical: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    state: z.string().nullable(),
    ageDays: z.number(),
    dayKey: z.string(),
});
export type LoadDayPr = z.infer<typeof LoadDayPrSchema>;

export const LoadDetailSchema = z.object({
    key: z.string(),
    endKey: z.string(),
    granularity: z.enum(["day", "week"]),
    peakDayKey: z.string(),
    arrived: z.array(LoadDayPrSchema),
    reviewed: z.array(LoadDayPrSchema),
    onPlate: z.array(LoadDayPrSchema),
});
export type LoadDetail = z.infer<typeof LoadDetailSchema>;

export const WeeklyReviewEffortSchema = z.object({
    score: z.number(),
    size: z.number(),
    updates: z.number(),
    depth: z.number(),
    discussion: z.number(),
    revisits: z.number(),
});
export type WeeklyReviewEffort = z.infer<typeof WeeklyReviewEffortSchema>;

export const WeeklyReviewPrSchema = z.object({
    canonical: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    author: z.string().nullable(),
    authorType: z.enum(["FTE", "Vendor", "Automated"]),
    reviewActions: z.number(),
    lifetimeReviewActions: z.number(),
    updateEpisodes: z.number(),
    latestReviewAt: z.string(),
    finalLane: LaneSchema,
    changedFiles: z.number().nullable(),
    totalComments: z.number().nullable(),
    otherComments: z.number().nullable(),
    effort: WeeklyReviewEffortSchema.nullable(),
});
export type WeeklyReviewPr = z.infer<typeof WeeklyReviewPrSchema>;

export const WeeklyReviewFactsSchema = z.object({
    startKey: z.string(),
    endKey: z.string(),
    actionCount: z.number(),
    uniquePrCount: z.number(),
    prs: z.array(WeeklyReviewPrSchema),
    coverage: z.object({
        sizeKnown: z.number(),
        commentsKnown: z.number(),
        scoreKnown: z.number(),
    }),
    effort: z.object({
        total: z.number(),
        average: z.number().nullable(),
    }),
});
export type WeeklyReviewFacts = z.infer<typeof WeeklyReviewFactsSchema>;

export const InsightsWaitingSchema = z.object({
    canonical: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    waitingHours: z.number(),
});
export type InsightsWaiting = z.infer<typeof InsightsWaitingSchema>;

// One time bucket (a day or a week) for the load/capacity view. inflow = PRs that
// entered your review queue; throughput = unique PRs reviewed; backlog = the
// "waiting on you" level (daily: level that day; weekly: that week's peak).
export const InsightsLoadBucketSchema = z.object({
    key: z.string(),
    inflow: z.number(),
    throughput: z.number(),
    backlog: z.number(),
});
export type InsightsLoadBucket = z.infer<typeof InsightsLoadBucketSchema>;

export const InsightsAuthoredPrSchema = z.object({
    canonical: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    activeComments: z.number(),
    blockers: z.array(z.string()),
    completable: z.boolean(),
});
export type InsightsAuthoredPr = z.infer<typeof InsightsAuthoredPrSchema>;

const nullableNumber = z.number().nullable();
const coverageSchema = z.enum(["me", "teammate", "needs"]);

// Aggregate analytics for the Insights page, computed on demand from the event
// log and current PR rows.
export const InsightsSchema = z.object({
    generatedAt: z.string(),
    summary: z.object({
        reviewsAllTime: z.number(),
        firstReviewAt: z.string().nullable(),
        lastReviewAt: z.string().nullable(),
        trackingSince: z.string().nullable(),
    }),
    latency: z.object({
        count: z.number(),
        pending: z.number(),
        medianHours: nullableNumber,
        p90Hours: nullableNumber,
        fastestHours: nullableNumber,
        slowestHours: nullableNumber,
        points: z.array(
            z.object({
                at: z.string(),
                hours: z.number(),
                repo: z.string(),
                number: z.number(),
                verdict: z.string().nullable(),
            }),
        ),
        distribution: z.array(InsightsCountSchema),
    }),
    throughput: z.object({
        total: z.number(),
        weekly: z.array(
            z.object({
                week: z.string(),
                quick: z.number(),
                review: z.number(),
                total: z.number(),
            }),
        ),
    }),
    load: z.object({
        daily: z.array(InsightsLoadBucketSchema),
        weekly: z.array(InsightsLoadBucketSchema),
        peak: z.object({ count: z.number(), at: z.string().nullable() }),
    }),
    backlog: z.object({
        waitingCount: z.number(),
        longestHours: nullableNumber,
        buckets: z.array(InsightsCountSchema),
        longest: z.array(InsightsWaitingSchema),
    }),
    distribution: z.object({
        byTeam: z.array(InsightsCountSchema),
        byRepo: z.array(InsightsCountSchema),
        byAuthorType: z.array(InsightsCountSchema),
    }),
    reach: z.object({
        items: z.array(
            z.object({
                at: z.string(),
                author: z.string(),
                vendor: z.boolean(),
                repo: z.string(),
                teams: z.array(z.string()),
            }),
        ),
    }),
    votePattern: z.object({
        byType: z.array(
            z.object({
                label: z.string(),
                approved: z.number(),
                suggestions: z.number(),
                waiting: z.number(),
                rejected: z.number(),
            }),
        ),
        total: z.number(),
        avgComments: nullableNumber,
        commentsMeasured: z.number(),
    }),
    reviewDepth: z.object({
        measured: z.number(),
        totalComments: z.number(),
        avg: nullableNumber,
        median: nullableNumber,
        p90: nullableNumber,
        zeroRate: nullableNumber,
        histogram: z.array(InsightsCountSchema),
        byType: z.array(
            z.object({
                label: z.string(),
                avg: nullableNumber,
                count: z.number(),
                total: z.number(),
            }),
        ),
        byRepo: z.array(
            z.object({
                label: z.string(),
                avg: z.number(),
                count: z.number(),
            }),
        ),
        byLatency: z.array(
            z.object({
                label: z.string(),
                avg: nullableNumber,
                count: z.number(),
            }),
        ),
    }),
    votePath: z.object({
        measured: z.number(),
        outcomes: z.object({
            firstPass: z.number(),
            gated: z.number(),
            held: z.number(),
        }),
        turns: z.array(
            z.object({
                turn: z.number(),
                verdict: z.string(),
                count: z.number(),
            }),
        ),
    }),
    reviewCoverage: z.object({
        origins: z.array(
            z.object({
                team: z.string(),
                total: z.number(),
                me: z.number(),
                teammate: z.number(),
                needs: z.number(),
                prs: z.array(
                    z.object({
                        number: z.number(),
                        repo: z.string(),
                        title: z.string(),
                        coverage: coverageSchema,
                    }),
                ),
            }),
        ),
    }),
    reviewRhythm: z.object({
        items: z.array(
            z.object({
                at: z.string(),
                repo: z.string(),
                team: z.string().nullable(),
                number: z.number(),
                title: z.string(),
                verdict: z.string().nullable(),
                author: z.string().nullable(),
                isVendor: z.boolean(),
            }),
        ),
    }),
    balance: z.object({
        days: z.array(
            z.object({
                key: z.string(),
                inflow: z.number(),
                throughput: z.number(),
                level: z.number(),
            }),
        ),
        heavyLine: z.number(),
    }),
    authored: z.object({
        open: z.number(),
        completable: z.number(),
        blocked: z.number(),
        mergedCount: z.number(),
        medianMergeHours: nullableNumber,
        openList: z.array(InsightsAuthoredPrSchema),
    }),
});
export type Insights = z.infer<typeof InsightsSchema>;

export const InsightsResponseSchema = z.object({ insights: InsightsSchema });
export const LoadDetailResponseSchema = z.object({ detail: LoadDetailSchema });
export const WeeklyReviewFactsResponseSchema = z.object({
    facts: WeeklyReviewFactsSchema,
});
