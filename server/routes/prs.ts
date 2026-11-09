import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
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

// Keep the legacy empty-body behavior while exposing JSON inputs to hono/client.
function jsonBody<T extends object>() {
    return createMiddleware<
        AppEnv,
        string,
        { in: { json: T }; out: { json: T } }
    >(async (c, next) => {
        const text = (await c.req.text()).trim();
        c.req.addValidatedData("json", text ? (JSON.parse(text) as T) : {});
        await next();
    });
}

type CanonicalBody = { canonical?: string };

function queryFields<T extends Record<string, string>>() {
    return createMiddleware<AppEnv, string, { in: { query: T } }>(
        async (_c, next) => {
            await next();
        },
    );
}

export function prRoutes(ctx: ApiContext) {
    const app = new Hono<AppEnv>()
        .get("/prs", (c) => c.json({ prs: ctx.store.listPrs() }))
        .get("/pr", queryFields<{ canonical: string }>(), (c) => {
            const canonical = new URL(c.req.url).searchParams.get("canonical");
            if (!canonical) return c.json({ error: "canonical required" }, 400);
            return c.json({
                pr: ctx.store.getPr(canonical),
                events: ctx.store.listEvents(canonical),
            });
        })
        .get("/pr/find", queryFields<{ number: string }>(), (c) => {
            const number = Number(
                new URL(c.req.url).searchParams.get("number"),
            );
            if (!Number.isInteger(number) || number <= 0)
                return c.json({ error: "valid number required" }, 400);
            return c.json({
                canonical: ctx.store.findCanonicalByNumber(number),
            });
        })
        .post("/pr/track", jsonBody<{ number?: number }>(), async (c) => {
            const number = Number(c.req.valid("json").number);
            if (!Number.isInteger(number) || number <= 0)
                return c.json({ error: "valid number required" }, 400);
            const result = await ctx.trackPr(number);
            return c.json(result, result.ok ? 200 : 409);
        })
        .post("/pr/refresh", jsonBody<CanonicalBody>(), async (c) => {
            const { canonical } = c.req.valid("json");
            if (!canonical) return c.json({ error: "canonical required" }, 400);
            await ctx.refreshPr(canonical);
            return c.json({ pr: ctx.store.getPr(canonical) });
        })
        .post(
            "/pr/snooze",
            jsonBody<
                CanonicalBody & {
                    until?: string | null;
                    mode?: "time" | "fte" | null;
                }
            >(),
            (c) => {
                const body = c.req.valid("json");
                if (!body.canonical)
                    return c.json({ error: "canonical required" }, 400);
                ctx.store.setSnooze(
                    body.canonical,
                    body.until ?? null,
                    body.mode ?? (body.until ? "time" : null),
                );
                return c.json({ pr: ctx.store.getPr(body.canonical) });
            },
        )
        .post(
            "/pr/lane",
            jsonBody<CanonicalBody & { lane?: string }>(),
            (c) => {
                const body = c.req.valid("json");
                if (
                    !body.canonical ||
                    (body.lane !== "quick" && body.lane !== "review")
                )
                    return c.json(
                        { error: "canonical and lane (quick|review) required" },
                        400,
                    );
                ctx.store.setLane(body.canonical, body.lane);
                return c.json({ pr: ctx.store.getPr(body.canonical) });
            },
        )
        .post(
            "/pr/review",
            jsonBody<CanonicalBody & { automatic?: boolean }>(),
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
                if (
                    body.automatic !== undefined &&
                    typeof body.automatic !== "boolean"
                )
                    return c.json({ error: "automatic must be boolean" }, 400);
                if (body.automatic && pr.lane !== "quick")
                    return c.json(
                        { error: "automatic review requires quick lane" },
                        400,
                    );
                const token = body.automatic
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
                                  pr,
                                  ctx.getConfig().reviewSkillName,
                                  ctx.getConfig().reviewModels,
                              ),
                    );
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
            jsonBody<
                CanonicalBody & {
                    verdict?: string;
                    sha?: string;
                    sessionId?: string;
                    token?: string;
                    release?: boolean;
                }
            >(),
            (c) => {
                const body = c.req.valid("json");
                if (!body.canonical)
                    return c.json({ error: "canonical required" }, 400);
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
                    });
                }
                return c.json({ ok: true });
            },
        )
        .post("/pr/remove", jsonBody<CanonicalBody>(), (c) => {
            const { canonical } = c.req.valid("json");
            if (!canonical) return c.json({ error: "canonical required" }, 400);
            ctx.store.removePr(canonical);
            return c.json({ ok: true });
        })
        .post(
            "/pr/scope",
            jsonBody<CanonicalBody & { outOfScope?: boolean }>(),
            (c) => {
                const body = c.req.valid("json");
                if (!body.canonical)
                    return c.json({ error: "canonical required" }, 400);
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
        .post("/archive/sweep", jsonBody<{ canonicals?: string[] }>(), (c) => {
            ctx.store.approveStaleSweep();
            return c.json({
                archived: ctx.store.archiveStale(
                    c.req.valid("json").canonicals,
                ),
            });
        })
        .post("/pr/restore", jsonBody<CanonicalBody>(), (c) => {
            const { canonical } = c.req.valid("json");
            if (!canonical) return c.json({ error: "canonical required" }, 400);
            return c.json({ restored: ctx.store.restorePr(canonical) });
        })
        .get("/repo-scopes", (c) =>
            c.json({ repos: ctx.store.listRepoScopes() }),
        )
        .post(
            "/repo-scopes",
            jsonBody<{ repo?: string; scope?: string | null }>(),
            (c) => {
                const body = c.req.valid("json");
                if (
                    !body.repo ||
                    (body.scope != null &&
                        body.scope !== "in" &&
                        body.scope !== "out")
                )
                    return c.json({ error: "repo and scope in|out|null" }, 400);
                const result = ctx.store.setRepoScope(
                    body.repo,
                    body.scope ?? null,
                );
                return c.json({ ...result, repos: ctx.store.listRepoScopes() });
            },
        )
        .get("/img", queryFields<{ url: string }>(), async (c) => {
            const target = new URL(c.req.url).searchParams.get("url");
            if (!target || !isAllowedImageHost(target))
                return c.body(new TextEncoder().encode("bad url"), 400, {});
            try {
                const img = await fetchAdoImage(target);
                const success = img.status >= 200 && img.status < 300;
                const headers = new Headers({
                    "content-type": success ? img.contentType : "text/plain",
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
                        error instanceof ImageProxyError ? error.status : 502,
                    headers: {
                        "content-type": "text/plain",
                        "x-content-type-options": "nosniff",
                    },
                });
            }
        })
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
