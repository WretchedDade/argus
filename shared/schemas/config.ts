// Settings wire shapes. Import from here only.

import { z } from "zod";

// A named date range (e.g. "Hackathon", "Team week") shown as a shaded band on
// the Load & capacity chart, for context on why load dipped/spiked that period.
export const PeriodSchema = z.object({
    label: z.string(),
    start: z.string(), // YYYY-MM-DD (inclusive)
    end: z.string(), // YYYY-MM-DD (inclusive)
});
export type Period = z.infer<typeof PeriodSchema>;

// Model settings for the review session. An empty field means "use the host default".
export const ReviewModelSettingSchema = z.object({
    model: z.string(),
    reasoningEffort: z.string(),
});
export type ReviewModelSetting = z.infer<typeof ReviewModelSettingSchema>;

export const ReviewModeSchema = z.enum(["quick", "full", "automatic"]);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

// Poller configuration. Defaults come from env; a user can override any field
// from the Settings screen (persisted in the store). `me` overrides the az
// identity when set. `defaultConfig() + saved overrides` = the effective config.
export const ArgusConfigSchema = z.object({
    // Identity override; null = use the signed-in account.
    me: z.string().nullable(),
    // How Argus authenticates to Azure DevOps.
    adoAuth: z.enum(["az", "broker"]),
    // Optional custom avatar image for your own PRs (else initials).
    avatarUrl: z.string(),
    orgUrl: z.string(),
    orgSlug: z.string(),
    project: z.string(),
    teamPatterns: z.array(z.string()),
    // Seen team display name -> friendly label.
    teamLabels: z.record(z.string(), z.string()),
    // Named context bands for the load chart.
    periods: z.array(PeriodSchema),
    // The skill the Review buttons tell the agent to run.
    reviewSkillName: z.string(),
    // Model and effort per review mode.
    reviewModels: z.object({
        quick: ReviewModelSettingSchema,
        full: ReviewModelSettingSchema,
        automatic: ReviewModelSettingSchema,
    }),
    recencyDays: z.number(),
    retentionDays: z.number(),
    workStartHour: z.number(),
    workEndHour: z.number(),
    workDays: z.array(z.number()),
    // Ask GitHub for new Argus releases.
    checkForUpdates: z.boolean(),
    // Regex for vendor display names; "" turns the rule off.
    vendorPattern: z.string(),
});
export type ArgusConfig = z.infer<typeof ArgusConfigSchema>;

export const ConfigResponseSchema = z.object({ config: ArgusConfigSchema });
