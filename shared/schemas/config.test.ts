import assert from "node:assert/strict";
import {
    ArgusConfigSchema,
    ConfigResponseSchema,
    type ArgusConfig,
} from "./config.ts";
import { describe, it } from "vitest";

describe("shared/schemas/config", () => {
    const empty = { model: "", reasoningEffort: "" };
    const config: ArgusConfig = {
        me: null,
        adoAuth: "az",
        orgUrl: "https://dev.azure.com/org",
        orgSlug: "org",
        project: "proj",
        teamPatterns: [],
        teamLabels: { "Team A": "A" },
        periods: [{ label: "Week", start: "2026-01-01", end: "2026-01-07" }],
        reviewSkillName: "pr-review",
        reviewModels: { quick: empty, full: empty, automatic: empty },
        recencyDays: 30,
        retentionDays: 90,
        workStartHour: 9,
        workEndHour: 17,
        workDays: [1, 2, 3, 4, 5],
        checkForUpdates: true,
        vendorPattern: "",
    };

    it("ArgusConfigSchema accepts a valid config", () => {
        assert.deepEqual(ArgusConfigSchema.parse(config), config);
    });

    it("ArgusConfigSchema rejects a bad auth mode and a missing review mode", () => {
        assert.equal(
            ArgusConfigSchema.safeParse({ ...config, adoAuth: "pat" }).success,
            false,
        );
        assert.equal(
            ArgusConfigSchema.safeParse({
                ...config,
                reviewModels: { quick: empty, full: empty },
            }).success,
            false,
        );
    });

    it("ConfigResponseSchema rejects a response without a config", () => {
        assert.equal(ConfigResponseSchema.safeParse({}).success, false);
        assert.equal(
            ConfigResponseSchema.parse({ config }).config.project,
            "proj",
        );
    });
});
