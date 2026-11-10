import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import { jsonBody, queryParams } from "../validation.ts";

const limitQuery = queryParams(
    z.object({
        limit: z
            .string()
            .transform(Number)
            .pipe(
                z
                    .number()
                    .int("limit must be a non-negative integer")
                    .nonnegative("limit must be a non-negative integer"),
            )
            .optional(),
    }),
);
const feedQuery = z.object({
    since: z
        .string()
        .refine(
            (value) => !value || Number.isFinite(Date.parse(value)),
            "since must be ISO8601",
        )
        .optional(),
    until: z
        .string()
        .refine(
            (value) => !value || Number.isFinite(Date.parse(value)),
            "until must be ISO8601",
        )
        .optional(),
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
        .all("/pr-activity", queryParams(feedQuery), (c) => {
            const query = c.req.valid("query");
            const untilMs = query.until ? Date.parse(query.until) : Date.now();
            const sinceMs = query.since
                ? Date.parse(query.since)
                : untilMs - 24 * 60 * 60 * 1000;
            return c.json({
                since: new Date(sinceMs).toISOString(),
                until: new Date(untilMs).toISOString(),
                generatedAt: new Date().toISOString(),
                events: ctx.store.listPrActivity(sinceMs, untilMs),
            });
        })
        .all("/runs", limitQuery, (c) =>
            c.json({
                runs: ctx.store.listPollRuns(
                    Number(c.req.valid("query").limit ?? 50),
                ),
            }),
        )
        .all(
            "/run",
            queryParams(
                z.object({
                    id: z
                        .string({ error: "id required" })
                        .transform(Number)
                        .pipe(
                            z
                                .number({ error: "id required" })
                                .int("id required")
                                .positive("id required"),
                        ),
                }),
            ),
            (c) => {
                const id = Number(c.req.valid("query").id ?? null);
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
        .post(
            "/changes/read",
            ...jsonBody(
                z.object({
                    canonical: z
                        .string({ error: "canonical required" })
                        .min(1, "canonical required"),
                }),
            ),
            (c) => {
                const { canonical } = c.req.valid("json");
                ctx.store.markChangesReadForPr(canonical);
                return c.json({ ok: true });
            },
        )
        .post("/changes/read-all", (c) => {
            ctx.store.markAllChangesRead();
            return c.json({ ok: true });
        });
}
