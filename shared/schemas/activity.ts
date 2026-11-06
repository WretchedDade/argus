// Activity wire shapes: the operational log and the external feed Clio reads.
// Import from here only.

import { z } from "zod";
import { PrRoleSchema } from "./pr.ts";

// Operational log rows returned to the activity/runs routes.
export const ActivityEntrySchema = z.object({
    id: z.number(),
    ts: z.string(),
    level: z.string(),
    msg: z.string(),
    data: z.record(z.string(), z.unknown()).nullable(),
    runId: z.number().nullable(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ActivityEntriesResponseSchema = z.object({
    entries: z.array(ActivityEntrySchema),
});

// The verdict a "reviewed"/"review_state" event settled on. A subset of
// PrReviewState: the non-terminal triage states (needs/covered) never surface.
export const ActivityVerdictSchema = z.enum([
    "approved",
    "suggestions",
    "rejected",
    "waiting",
]);
export type ActivityVerdict = z.infer<typeof ActivityVerdictSchema>;

// The event vocabulary Clio consumes. A subset of PrEventType (the triage-noise
// types are dropped), with authored lifecycle split out so a consumer can tell
// "I opened/merged my PR" from "a PR entered/left my review queue".
export const ActivityEventTypeSchema = z.enum([
    "authored_opened",
    "authored_merged",
    "added",
    "closed",
    "reviewed",
    "vote_changed",
    "review_state",
    "commit_pushed",
    "comment_posted",
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

// One PR activity event attributable to me, flattened with the PR identity Clio
// needs. `id` is the stable pr_events row id (Clio can dedup on it).
export const ActivityEventSchema = z.object({
    id: z.number(),
    ts: z.string(),
    type: ActivityEventTypeSchema,
    role: PrRoleSchema,
    pr: z.object({
        canonical: z.string(),
        org: z.string(),
        project: z.string(),
        repo: z.string(),
        number: z.number(),
        title: z.string(),
        author: z.string().nullable(),
        isVendor: z.boolean(),
        teams: z.array(z.string()),
        url: z.string(),
    }),
    verdict: ActivityVerdictSchema.nullable(),
    vote: z.number().nullable(),
    activeComments: z.number().nullable(),
    resolvedComments: z.number().nullable(),
    reviewSessionId: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityFeedSchema = z.object({
    since: z.string(),
    until: z.string(),
    generatedAt: z.string(),
    events: z.array(ActivityEventSchema),
});
export type ActivityFeed = z.infer<typeof ActivityFeedSchema>;
