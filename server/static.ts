import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import path from "node:path";
import type { AppEnv } from "./app.ts";

export function staticRoutes(distDir: string) {
    const root = path.resolve(distDir);
    return new Hono<AppEnv>().get(
        "*",
        async (c, next) => {
            if (c.req.method !== "GET") return c.body(null, 404);
            await next();
        },
        serveStatic({ root }),
        serveStatic({ path: path.join(root, "index.html") }),
        (c) => c.text("Argus client not built. Run `npm run build`.", 500),
    );
}
