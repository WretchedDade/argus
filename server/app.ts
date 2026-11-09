import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { logger } from "./log.ts";
import type { ApiContext } from "./api.ts";
import { authRoutes } from "./routes/auth.ts";
import { prRoutes } from "./routes/prs.ts";
import { configRoutes } from "./routes/config.ts";
import { activityRoutes } from "./routes/activity.ts";
import { noticeRoutes } from "./routes/notices.ts";
import { insightsRoutes } from "./routes/insights.ts";
import {
    assertTrustedRequest,
    UntrustedRequestError,
} from "./trusted-request.ts";

export type AppEnv = { Bindings: HttpBindings };

export function createApp(ctx: ApiContext) {
    return new Hono<AppEnv>()
        .use("/api/*", async (c, next) => {
            const started = performance.now();
            const requestId = randomUUID();
            // Do not materialize Hono's lazy response headers.
            c.env.outgoing.setHeader("X-Request-Id", requestId);
            let failure: unknown;
            try {
                await next();
            } catch (error) {
                failure = error;
                throw error;
            } finally {
                const status = failure ? 500 : c.res.status;
                const fields = {
                    component: "http",
                    requestId,
                    method: c.req.method,
                    route: c.req.routePath,
                    status,
                    durationMs: Math.round(performance.now() - started),
                };
                if (status >= 500)
                    logger.error(
                        { ...fields, err: failure ?? c.error },
                        "HTTP request failed",
                    );
                else logger.debug(fields, "HTTP request completed");
            }
        })
        .use("/api/*", async (honoContext, next) => {
            try {
                assertTrustedRequest(honoContext.env.incoming);
            } catch (error) {
                if (!(error instanceof UntrustedRequestError)) throw error;
                return honoContext.json({ error: error.message }, error.status);
            }
            await next();
        })
        .route("/api/auth", authRoutes(ctx))
        .route("/api", prRoutes(ctx))
        .route("/api", configRoutes(ctx))
        .route("/api", activityRoutes(ctx))
        .route("/api", noticeRoutes(ctx))
        .route("/api", insightsRoutes(ctx))
        .notFound((honoContext) =>
            honoContext.json({ error: "not found" }, 404),
        )
        .onError((error, honoContext) => {
            if (error instanceof HTTPException)
                return honoContext.json({ error: error.message }, error.status);
            throw error;
        });
}

export type AppType = ReturnType<typeof createApp>;

export function createHonoHandler(
    ctx: ApiContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return getRequestListener(createApp(ctx).fetch);
}
