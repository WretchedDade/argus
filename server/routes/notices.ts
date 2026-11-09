import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import { UpdateJob } from "../update-job.ts";

// Keep the legacy empty-body behavior while exposing typed JSON input.
const noticeBody = createMiddleware<
    AppEnv,
    string,
    { in: { json: { id?: unknown } }; out: { json: { id?: unknown } } }
>(async (c, next) => {
    const text = (await c.req.text()).trim();
    c.req.addValidatedData(
        "json",
        text ? (JSON.parse(text) as { id?: unknown }) : {},
    );
    await next();
});

// Hono maps HEAD to GET, but these legacy routes accept only GET.
const getOnly = createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== "GET") return c.json({ error: "not found" }, 404);
    await next();
});

export function noticeRoutes(ctx: ApiContext) {
    return new Hono<AppEnv>()
        .get("/version", getOnly, (c) =>
            c.json({ version: ctx.appVersion ?? null }),
        )
        .get("/notices", getOnly, (c) => {
            const dismissed = new Set(ctx.store.getDismissedNotices());
            const notices = (ctx.getNotices?.() ?? [])
                .filter((n) => !dismissed.has(n.id))
                .map(({ prompt: _prompt, ...rest }) => rest);
            return c.json({ notices });
        })
        .post("/notices/check", async (c) => {
            if (!ctx.checkForUpdatesNow)
                return c.json({ error: "Update check is not available." }, 501);
            if (!ctx.getConfig().checkForUpdates)
                return c.json({ error: "Update checks are turned off." }, 409);
            const result = await ctx.checkForUpdatesNow();
            if (result.updateAvailable && result.latest)
                ctx.store.restoreNotice(`app-update:${result.latest}`);
            return c.json(result);
        })
        .post("/notices/act", noticeBody, async (c) => {
            const body = c.req.valid("json");
            const notice = (ctx.getNotices?.() ?? []).find(
                (n) => n.id === body.id,
            );
            if (!notice?.prompt)
                return c.json({ error: "no action for that notice" }, 404);
            await ctx.dispatch(notice.prompt);
            if (notice.kind !== "storage") ctx.store.dismissNotice(notice.id);
            return c.json({ ok: true });
        })
        .post("/skill/replace", (c) => {
            const notice = (ctx.getNotices?.() ?? []).find(
                (n) => n.kind === "skill-update",
            );
            if (!ctx.useBundledSkill)
                return c.json(
                    { error: "Replacing the skill needs the Copilot app." },
                    501,
                );
            if (!notice)
                return c.json({ error: "No skill update is pending." }, 404);
            try {
                const { backupPath } = ctx.useBundledSkill();
                ctx.store.dismissNotice(notice.id);
                return c.json({ ok: true, backupPath });
            } catch (err) {
                return c.json({ error: (err as Error).message }, 500);
            }
        })
        .post("/update/apply", (c) => {
            const notice = (ctx.getNotices?.() ?? []).find(
                (n) => n.kind === "app-update",
            );
            if (!ctx.applyUpdate)
                return c.json(
                    {
                        error: "Installing needs the Copilot app. Upgrade by hand with install.ps1 from the release ZIP.",
                    },
                    501,
                );
            if (!notice)
                return c.json(
                    { error: "No update is available to install." },
                    404,
                );
            const job = (ctx.updateJob ??= new UpdateJob());
            const apply = ctx.applyUpdate;
            const started = job.start(async (setPhase) => {
                await apply(setPhase);
                ctx.store.dismissNotice(notice.id);
            });
            if (!started)
                return c.json({ error: "An update is already running." }, 409);
            return c.json(job.status(), 202);
        })
        .get("/update/status", getOnly, (c) =>
            c.json((ctx.updateJob ??= new UpdateJob()).status()),
        )
        .post("/notices/dismiss", noticeBody, (c) => {
            const body = c.req.valid("json");
            if (typeof body.id !== "string" || body.id.length === 0)
                return c.json({ error: "id is required" }, 400);
            ctx.store.dismissNotice(body.id);
            return c.json({ ok: true });
        });
}
