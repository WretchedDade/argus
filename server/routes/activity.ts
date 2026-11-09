import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";

const limitQuery = validator("query", (_query, c) => ({
    limit: c.req.query("limit"),
}));
const canonicalBody = createMiddleware<
    AppEnv,
    string,
    {
        in: { json: { canonical?: string } };
        out: { json: { canonical?: string } };
    }
>(async (c, next) => {
    // Keep the legacy empty-body behavior.
    const text = (await c.req.text()).trim();
    c.req.addValidatedData(
        "json",
        text ? (JSON.parse(text) as { canonical?: string }) : {},
    );
    await next();
});

export function activityRoutes(ctx: ApiContext) {
    // Legacy read routes accept any method.
    return new Hono<AppEnv>()
        .all("/activity", limitQuery, (c) =>
            c.json({
                entries: ctx.store.listActivity(
                    Number(c.req.valid("query").limit ?? 100),
                ),
            }),
        )
        .all(
            "/pr-activity",
            validator("query", (_query, c) => ({
                since: c.req.query("since"),
                until: c.req.query("until"),
            })),
            (c) => {
                const query = c.req.valid("query");
                const untilMs = query.until
                    ? Date.parse(query.until)
                    : Date.now();
                if (Number.isNaN(untilMs))
                    return c.json({ error: "until must be ISO8601" }, 400);
                const sinceMs = query.since
                    ? Date.parse(query.since)
                    : untilMs - 24 * 60 * 60 * 1000;
                if (Number.isNaN(sinceMs))
                    return c.json({ error: "since must be ISO8601" }, 400);
                return c.json({
                    since: new Date(sinceMs).toISOString(),
                    until: new Date(untilMs).toISOString(),
                    generatedAt: new Date().toISOString(),
                    events: ctx.store.listPrActivity(sinceMs, untilMs),
                });
            },
        )
        .all("/runs", limitQuery, (c) =>
            c.json({
                runs: ctx.store.listPollRuns(
                    Number(c.req.valid("query").limit ?? 50),
                ),
            }),
        )
        .all(
            "/run",
            validator("query", (_query, c) => ({ id: c.req.query("id") })),
            (c) => {
                const id = Number(c.req.valid("query").id ?? null);
                if (!id) return c.json({ error: "id required" }, 400);
                return c.json({
                    run: ctx.store.getRun(id),
                    entries: ctx.store.listActivityForRun(id),
                    changes: ctx.store.listRunEvents(id),
                });
            },
        )
        .all("/changes", (c) =>
            c.json({ changes: ctx.store.listUnreadChanges() }),
        )
        .post("/changes/read", canonicalBody, (c) => {
            const { canonical } = c.req.valid("json");
            if (!canonical) return c.json({ error: "canonical required" }, 400);
            ctx.store.markChangesReadForPr(canonical);
            return c.json({ ok: true });
        })
        .post("/changes/read-all", (c) => {
            ctx.store.markAllChangesRead();
            return c.json({ ok: true });
        });
}
