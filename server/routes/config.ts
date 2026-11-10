import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import {
    ConfigOverridesSchema,
    hasRequiredSetup,
    mergeConfig,
} from "../config.ts";
import { authStatus, setAuthProvider, useBroker } from "../ado/client.ts";
import { resetIdentity } from "../ado/poller.ts";
import { jsonBody } from "../validation.ts";

const setupSchema = ConfigOverridesSchema.extend({
    installPrReviewSkill: z.boolean().optional(),
    dbLocation: z
        .enum(["local", "onedrive"], {
            error: "dbLocation must be local or onedrive",
        })
        .optional(),
});

export function configRoutes(ctx: ApiContext) {
    const health = async () => {
        setAuthProvider(ctx.getConfig().adoAuth);
        return {
            ok: true,
            boot_at: ctx.bootAt,
            store: ctx.store.counts(),
            poller: ctx.pollerStatus(),
            storage: ctx.storage?.() ?? null,
            auth: useBroker() ? await authStatus() : null,
            setup_complete:
                ctx.store.isSetupComplete() &&
                hasRequiredSetup(ctx.getConfig()),
        };
    };
    const config = () => ({ config: ctx.getConfig() });
    const teams = () => ({ teams: ctx.store.getSeenTeams() });

    return new Hono<AppEnv>()
        .get("/health", async (c) => c.json(await health()))
        .all("/health", async (c) => c.json(await health()))
        .get("/config", (c) => c.json(config()))
        .post("/config", ...jsonBody(ConfigOverridesSchema), (c) => {
            const before = ctx.getConfig().adoAuth;
            const body = c.req.valid("json");
            const config = ctx.saveConfig({
                ...ctx.store.getConfigOverrides(),
                ...body,
            });
            setAuthProvider(config.adoAuth);
            if (config.adoAuth !== before) resetIdentity(ctx.store);
            return c.json({ config });
        })
        .all("/config", (c) => c.json(config()))
        .post("/setup", ...jsonBody(setupSchema), (c) => {
            const { dbLocation, installPrReviewSkill, ...overrides } =
                c.req.valid("json");
            if (!hasRequiredSetup(mergeConfig(ctx.getConfig(), overrides)))
                return c.json(
                    { error: "Valid org URL, org slug, and project required" },
                    400,
                );
            const storage =
                dbLocation && ctx.setDbLocation
                    ? ctx.setDbLocation(dbLocation)
                    : null;
            if (storage && !storage.ok)
                return c.json(
                    {
                        error:
                            storage.reason ??
                            "Could not save the storage location",
                    },
                    400,
                );
            const config = ctx.saveConfig(overrides);
            setAuthProvider(config.adoAuth);
            ctx.markSetupComplete();
            const skill =
                installPrReviewSkill === true
                    ? ctx.installBaselineSkill()
                    : { installed: false, reason: "skipped" };
            return c.json({ config, setup_complete: true, skill, storage });
        })
        .post("/refresh", async (c) => {
            const result = await ctx.reconcile();
            const skipped = result === "skipped";
            return c.json({ summary: skipped ? null : result, skipped });
        })
        .get("/teams", (c) => c.json(teams()))
        .all("/teams", (c) => c.json(teams()))
        .post(
            "/data/delete-all",
            ...jsonBody(
                z.object({
                    confirm: z.literal("delete", {
                        error: 'confirm must be "delete"',
                    }),
                }),
            ),
            async (c) => {
                await ctx.deleteAllData();
                return c.json({ ok: true });
            },
        );
}
