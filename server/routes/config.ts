import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import {
    ConfigError,
    hasRequiredSetup,
    mergeConfig,
    parseConfigOverrides,
    type ConfigOverrides,
} from "../config.ts";
import { authStatus, setAuthProvider, useBroker } from "../ado/client.ts";
import { resetIdentity } from "../ado/poller.ts";

type SetupInput = ConfigOverrides & {
    installPrReviewSkill?: boolean;
    dbLocation?: "local" | "onedrive";
};

// Keep the legacy empty-body behavior while exposing typed JSON input to hc.
const jsonBody = <T>() =>
    createMiddleware<
        AppEnv,
        string,
        { in: { json: T }; out: { json: { body: unknown } } }
    >(async (c, next) => {
        const text = (await c.req.text()).trim();
        const body: unknown = text ? JSON.parse(text) : {};
        c.req.addValidatedData("json", { body });
        await next();
    });

function configOverrides(body: unknown): ConfigOverrides {
    try {
        return parseConfigOverrides(body);
    } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        throw new HTTPException(400, { message: error.message });
    }
}

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
        .post("/config", jsonBody<ConfigOverrides>(), (c) => {
            const before = ctx.getConfig().adoAuth;
            const body = configOverrides(c.req.valid("json").body);
            const config = ctx.saveConfig({
                ...ctx.store.getConfigOverrides(),
                ...body,
            });
            setAuthProvider(config.adoAuth);
            if (config.adoAuth !== before) resetIdentity(ctx.store);
            return c.json({ config });
        })
        .all("/config", (c) => c.json(config()))
        .post("/setup", jsonBody<SetupInput>(), (c) => {
            const body = c.req.valid("json").body;
            const overrides = configOverrides(body);
            const input = body as Record<string, unknown>;
            if (!hasRequiredSetup(mergeConfig(ctx.getConfig(), overrides)))
                return c.json(
                    { error: "Valid org URL, org slug, and project required" },
                    400,
                );
            const { dbLocation } = input;
            if (
                dbLocation !== undefined &&
                dbLocation !== "local" &&
                dbLocation !== "onedrive"
            )
                return c.json(
                    { error: "dbLocation must be local or onedrive" },
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
                input.installPrReviewSkill === true
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
            jsonBody<{ confirm: string }>(),
            async (c) => {
                const body = c.req.valid("json").body;
                if (
                    !body ||
                    typeof body !== "object" ||
                    !("confirm" in body) ||
                    body.confirm !== "delete"
                )
                    return c.json({ error: 'confirm must be "delete"' }, 400);
                await ctx.deleteAllData();
                return c.json({ ok: true });
            },
        );
}
