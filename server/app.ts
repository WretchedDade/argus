import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiContext } from "./api.ts";
import { authRoutes } from "./routes/auth.ts";
import { configRoutes } from "./routes/config.ts";
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
        .route("/api", configRoutes(ctx))
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

// Routes that Hono serves. The old handler serves the rest during the migration.
export function isHonoRoute(pathname: string): boolean {
    return (
        pathname.startsWith("/api/auth/") ||
        [
            "/api/config",
            "/api/setup",
            "/api/health",
            "/api/refresh",
            "/api/teams",
            "/api/data/delete-all",
        ].includes(pathname) ||
        pathname === "/api/insights" ||
        pathname === "/api/load/detail" ||
        pathname === "/api/reviews/week"
    );
}

export function createHonoHandler(
    ctx: ApiContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return getRequestListener(createApp(ctx).fetch);
}
