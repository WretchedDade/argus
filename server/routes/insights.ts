import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import { queryParams } from "../validation.ts";

function isMondayKey(key: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getDay() === 1
    );
}

const keyError = "key (YYYY-MM-DD) required";
const mondayError = "key must be a Monday in YYYY-MM-DD format";
const loadQuery = z.object({
    key: z.string({ error: keyError }).regex(/^\d{4}-\d{2}-\d{2}$/, keyError),
    granularity: z.enum(["day", "week"], {
        error: "granularity (day or week) required",
    }),
});
const weekQuery = z.object({
    key: z.string({ error: mondayError }).refine(isMondayKey, mondayError),
});

export function insightsRoutes(ctx: ApiContext) {
    // Keep the legacy read routes available for all HTTP methods.
    return new Hono<AppEnv>()
        .all("/insights", (c) => {
            const cfg = ctx.getConfig();
            return c.json({
                insights: ctx.store.computeInsights(cfg.recencyDays, {
                    endHour: cfg.workEndHour,
                    days: cfg.workDays,
                }),
            });
        })
        .all("/load/detail", queryParams(loadQuery), (c) => {
            const { key, granularity } = c.req.valid("query");
            const cfg = ctx.getConfig();
            const work = { endHour: cfg.workEndHour, days: cfg.workDays };
            const detail =
                granularity === "week"
                    ? ctx.store.loadWeekDetail(key, cfg.recencyDays, work)
                    : ctx.store.loadDayDetail(key, cfg.recencyDays, work);
            return c.json({ detail });
        })
        .all("/reviews/week", queryParams(weekQuery), (c) =>
            c.json({
                facts: ctx.store.weeklyReviewFacts(c.req.valid("query").key),
            }),
        );
}
