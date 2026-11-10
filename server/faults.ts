import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./app.ts";

// Dev-only failure injection for the standalone runner. Set ARGUS_FAKE_FAULT to
// a comma-separated list: prs, prs-bad, config, config-slow, setup.
export const CONFIG_SLOW_MS = 5000;

export function parseFaults(value: string | undefined): Set<string> {
    return new Set(
        (value ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

export function faultMiddleware(faults: Set<string>) {
    return createMiddleware<AppEnv>(async (c, next) => {
        const route = c.req.path;
        if (route === "/api/prs") {
            if (faults.has("prs"))
                return c.json({ error: "Injected fault: prs" }, 500);
            if (faults.has("prs-bad")) return c.json({ prs: "not-a-list" });
        }
        if (route === "/api/config") {
            if (faults.has("config"))
                return c.json({ error: "Injected fault: config" }, 500);
            if (faults.has("config-slow"))
                await new Promise((resolve) =>
                    setTimeout(resolve, CONFIG_SLOW_MS),
                );
        }
        await next();
        if (route === "/api/health" && faults.has("setup")) {
            const response = c.res;
            const body = (await response.json()) as Record<string, unknown>;
            c.res = new Response(
                c.json({ ...body, setup_complete: false }).body,
                response,
            );
        }
    });
}
