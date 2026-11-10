import { Hono } from "hono";
import { z } from "zod";
import type { ApiContext } from "../api.ts";
import type { AppEnv } from "../app.ts";
import { STALE_ARCHIVE_DAYS } from "../types.ts";
import {
    fetchAdoImage,
    ImageProxyError,
    isAllowedImageHost,
} from "../ado/images.ts";
import {
    archivePrompt,
    automaticReviewPrompt,
    reviewPrompt,
} from "../prompts.ts";
import { jsonBody, queryParams } from "../validation.ts";
import { ReviewActionModeSchema } from "#shared/schemas/pr";

const canonical = z
    .string({ error: "canonical required" })
    .min(1, "canonical required");
const canonicalBody = z.object({ canonical });
const validNumber = z
    .union([z.number(), z.string()], { error: "valid number required" })
    .transform(Number)
    .pipe(
        z
            .number({ error: "valid number required" })
            .int("valid number required")
            .positive("valid number required"),
    );

export function prRoutes(ctx: ApiContext) {
    const app = new Hono<AppEnv>()
        .get("/prs", (c) => c.json({ prs: ctx.store.listPrs() }))
        .get("/pr", queryParams(canonicalBody), (c) => {
            const { canonical } = c.req.valid("query");
            return c.json({
                pr: ctx.store.getPr(canonical),
                events: ctx.store.listEvents(canonical),
            });
        })
        .get(
            "/pr/find",
            queryParams(z.object({ number: validNumber })),
            (c) => {
                const { number } = c.req.valid("query");
                return c.json({
                    canonical: ctx.store.findCanonicalByNumber(number),
                });
            },
        )
        .post(
            "/pr/track",
            ...jsonBody(z.object({ number: validNumber })),
            async (c) => {
                const { number } = c.req.valid("json");
                const result = await ctx.trackPr(number);
                return c.json(result, result.ok ? 200 : 409);
            },
        )
        .post("/pr/refresh", ...jsonBody(canonicalBody), async (c) => {
            const { canonical } = c.req.valid("json");
            await ctx.refreshPr(canonical);
            return c.json({ pr: ctx.store.getPr(canonical) });
        })
        .post(
            "/pr/snooze",
            ...jsonBody(
                canonicalBody.extend({
                    until: z.string().nullable().optional(),
                    mode: z.enum(["time", "fte"]).nullable().optional(),
                }),
            ),
            (c) => {
                const body = c.req.valid("json");
                ctx.store.setSnooze(
                    body.canonical,
                    body.until ?? null,
                    body.mode ?? (body.until ? "time" : null),
                );
                return c.json({ pr: ctx.store.getPr(body.canonical) });
            },
        )
        .post(
            "/pr/review",
            ...jsonBody(
                z.object({
                    canonical: z
                        .string({ error: "canonical required / not found" })
                        .min(1, "canonical required / not found"),
                    mode: z.enum(ReviewActionModeSchema.options, {
                        error: "mode must be with-me, for-me, or delegate",
                    }),
                }),
            ),
            async (c) => {
                const body = c.req.valid("json");
                const pr = body.canonical
                    ? ctx.store.getPr(body.canonical)
                    : null;
                if (!pr)
                    return c.json(
                        { error: "canonical required / not found" },
                        400,
                    );
                const mode = body.mode;
                const lane = mode === "for-me" ? "quick" : "review";
                const token =
                    mode === "delegate"
                        ? ctx.store.issueAutomaticReviewToken(pr.canonical)
                        : null;
                try {
                    await ctx.dispatch(
                        token
                            ? automaticReviewPrompt(
                                  pr,
                                  ctx.getConfig().reviewSkillName,
                                  token,
                                  ctx.getConfig().reviewModels,
                              )
                            : reviewPrompt(
                                  { ...pr, lane },
                                  ctx.getConfig().reviewSkillName,
                                  ctx.getConfig().reviewModels,
                              ),
                    );
                    if (mode !== "delegate")
                        ctx.store.setLane(pr.canonical, lane);
                } catch (error) {
                    if (token)
                        ctx.store.revokeAutomaticReviewToken(
                            pr.canonical,
                            token,
                        );
                    throw error;
                }
                return c.json({ ok: true, reReview: !!pr.reviewSessionId });
            },
        )
        .post(
            "/pr/record-review",
            ...jsonBody(
                canonicalBody
                    .extend({
                        verdict: z.string().optional(),
                        sha: z.string().optional(),
                        sessionId: z.string().optional(),
                        token: z.string().optional(),
                        release: z.boolean().optional(),
                        provisional: z.boolean().optional(),
                    })
                    .refine(
                        (body) =>
                            !body.provisional || body.verdict === "waiting",
                        { error: "provisional requires waiting verdict" },
                    ),
            ),
            (c) => {
                const body = c.req.valid("json");
                if (body.release) {
                    if (body.token)
                        ctx.store.revokeAutomaticReviewToken(
                            body.canonical,
                            body.token,
                        );
                } else {
                    if (
                        !ctx.store.checkVerdictAllowed(
                            body.canonical,
                            body.verdict,
                            body.token,
                        )
                    )
                        return c.json(
                            {
                                error: "approved requires the token from the automatic review",
                            },
                            403,
                        );
                    ctx.recordReview(body.canonical, {
                        verdict: body.verdict,
                        sha: body.sha,
                        sessionId: body.sessionId,
                        provisional: body.provisional,
                    });
                }
                return c.json({ ok: true });
            },
        )
        .post("/pr/remove", ...jsonBody(canonicalBody), (c) => {
            const { canonical } = c.req.valid("json");
            ctx.store.removePr(canonical);
            return c.json({ ok: true });
        })
        .post(
            "/pr/scope",
            ...jsonBody(
                canonicalBody.extend({ outOfScope: z.boolean().optional() }),
            ),
            (c) => {
                const body = c.req.valid("json");
                ctx.store.setOutOfScope(body.canonical, !!body.outOfScope);
                return c.json({ pr: ctx.store.getPr(body.canonical) });
            },
        )
        .get("/archived", (c) => c.json({ prs: ctx.store.listArchived() }))
        .get("/archive/preview", (c) =>
            c.json({
                approved: ctx.store.isStaleSweepApproved(),
                days: STALE_ARCHIVE_DAYS,
                candidates: ctx.store.staleCandidates(),
            }),
        )
        .post(
            "/archive/sweep",
            ...jsonBody(
                z.object({ canonicals: z.array(canonical).optional() }),
            ),
            (c) => {
                ctx.store.approveStaleSweep();
                return c.json({
                    archived: ctx.store.archiveStale(
                        c.req.valid("json").canonicals,
                    ),
                });
            },
        )
        .post("/pr/restore", ...jsonBody(canonicalBody), (c) => {
            const { canonical } = c.req.valid("json");
            return c.json({ restored: ctx.store.restorePr(canonical) });
        })
        .get("/repo-scopes", (c) =>
            c.json({ repos: ctx.store.listRepoScopes() }),
        )
        .post(
            "/repo-scopes",
            ...jsonBody(
                z.object({
                    repo: z
                        .string({ error: "repo and scope in|out|null" })
                        .min(1, "repo and scope in|out|null"),
                    scope: z
                        .enum(["in", "out"], {
                            error: "repo and scope in|out|null",
                        })
                        .nullable()
                        .optional(),
                }),
            ),
            (c) => {
                const body = c.req.valid("json");
                const result = ctx.store.setRepoScope(
                    body.repo,
                    body.scope ?? null,
                );
                return c.json({ ...result, repos: ctx.store.listRepoScopes() });
            },
        )
        .get(
            "/img",
            queryParams(z.object({ url: z.string().optional() })),
            async (c) => {
                const target = c.req.valid("query").url;
                if (!target || !isAllowedImageHost(target))
                    return c.body(new TextEncoder().encode("bad url"), 400, {});
                try {
                    const img = await fetchAdoImage(target);
                    const success = img.status >= 200 && img.status < 300;
                    const headers = new Headers({
                        "content-type": success
                            ? img.contentType
                            : "text/plain",
                        "x-content-type-options": "nosniff",
                    });
                    if (success) {
                        headers.set("cache-control", "private, max-age=3600");
                        headers.set(
                            "content-security-policy",
                            "default-src 'none'",
                        );
                    }
                    const body = [204, 205, 304].includes(img.status)
                        ? null
                        : success
                          ? new Uint8Array(img.body)
                          : "upstream error";
                    return new Response(body, {
                        status: img.status,
                        headers,
                    });
                } catch (error) {
                    return new Response("image proxy error", {
                        status:
                            error instanceof ImageProxyError
                                ? error.status
                                : 502,
                        headers: {
                            "content-type": "text/plain",
                            "x-content-type-options": "nosniff",
                        },
                    });
                }
            },
        )
        .get("/archivable", (c) =>
            c.json({
                archivable: ctx.store.getArchivable(
                    ctx.getConfig().recencyDays,
                ),
            }),
        )
        .post("/archive", async (c) => {
            const items = ctx.store.getArchivable(ctx.getConfig().recencyDays);
            if (items.length > 0) {
                await ctx.dispatch(archivePrompt(items));
                ctx.store.markReviewSessionsArchived(
                    items.map((item) => item.sessionId),
                );
            }
            return c.json({ dispatched: items.length });
        });

    // Legacy read routes accept any method; keep POST actions first.
    for (const route of app.routes.filter((route) => route.method === "GET"))
        app.all(route.path, route.handler);
    return app;
}
