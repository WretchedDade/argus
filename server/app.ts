import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiContext } from "./api.ts";
import { authRoutes } from "./routes/auth.ts";
import { noticeRoutes } from "./routes/notices.ts";
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
        .route("/api", noticeRoutes(ctx))
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
        pathname === "/api/notices" ||
        pathname.startsWith("/api/notices/") ||
        pathname === "/api/version" ||
        pathname === "/api/skill/replace" ||
        pathname === "/api/update/apply" ||
        pathname === "/api/update/status"
    );
}

export function createHonoHandler(
    ctx: ApiContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return getRequestListener(createApp(ctx).fetch);
}
