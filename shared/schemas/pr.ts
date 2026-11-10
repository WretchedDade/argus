// Wire shapes shared by the server and the client. Each type is inferred from
// its zod schema, so the two builds cannot drift. Import from here only.

import { z } from "zod";

export const LaneSchema = z.enum(["quick", "review"]);
export type Lane = z.infer<typeof LaneSchema>;

export const PrStateSchema = z.enum(["pending", "reviewed", "closed"]);
export type PrState = z.infer<typeof PrStateSchema>;

// How this PR is mine: I authored it, I'm a direct reviewer, or a team I'm on
// is a reviewer. `teams` holds the matched team display names (may be several).
export const PrRoleSchema = z.enum(["author", "reviewer", "team"]);
export type PrRole = z.infer<typeof PrRoleSchema>;

// My (or my team's) standing on a PR I review. `needs` = not voted yet;
// `covered` = a teammate already satisfied the team's review for me.
export const PrReviewStateSchema = z.enum([
    "needs",
    "covered",
    "suggestions",
    "approved",
    "waiting",
    "rejected",
]);
export type PrReviewState = z.infer<typeof PrReviewStateSchema>;

export const AuthorMetaSchema = z.object({
    completable: z.boolean(),
    // Unmet blocking policies (e.g. "Minimum number of reviewers").
    blockers: z.array(z.string()),
    activeComments: z.number(),
    resolvedComments: z.number(),
    // e.g. "succeeded" | "conflicts"
    mergeStatus: z.string(),
    lastSuccessfulAt: z
        .object({
            policies: z.string().nullable(),
            comments: z.string().nullable(),
        })
        .optional(),
});
export type AuthorMeta = z.infer<typeof AuthorMetaSchema>;

export const PrSchema = z.object({
    canonical: z.string(),
    org: z.string(),
    project: z.string(),
    repo: z.string(),
    number: z.number(),
    title: z.string(),
    description: z.string(),
    author: z.string().nullable(),
    isVendor: z.boolean(),
    role: PrRoleSchema,
    teams: z.array(z.string()),
    requiredApproverGroups: z.array(z.string()),
    reviewState: PrReviewStateSchema.nullable(),
    otherVotes: z.array(z.object({ name: z.string(), vote: z.number() })),
    lane: LaneSchema,
    state: PrStateSchema,
    isDraft: z.boolean(),
    dismissed: z.boolean(),
    dismissedReason: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    outOfScope: z.boolean(),
    snoozedUntil: z.string().nullable(),
    snoozeMode: z.enum(["time", "fte"]).nullable(),
    lastCommitSha: z.string().nullable(),
    lastCommitAt: z.string().nullable(),
    prCreatedAt: z.string().nullable(),
    addedAt: z.string(),
    updatedAt: z.string(),
    reviewSessionId: z.string().nullable(),
    reviewedSha: z.string().nullable(),
    reviewCount: z.number(),
    coveredAt: z.string().nullable(),
    changedFiles: z.number().nullable(),
    authorMeta: AuthorMetaSchema.nullable(),
});
export type Pr = z.infer<typeof PrSchema>;

export const PrsResponseSchema = z.object({ prs: z.array(PrSchema) });
