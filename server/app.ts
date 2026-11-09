import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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
