import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./respond.ts";

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

// Returns true when the fault answered the request itself.
export async function injectFault(
    faults: Set<string>,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<boolean> {
    if (faults.size === 0) return false;
    const route = new URL(req.url || "/", "http://127.0.0.1").pathname;

    if (route === "/api/prs") {
        if (faults.has("prs")) {
            sendJson(res, 500, { error: "Injected fault: prs" });
            return true;
        }
        if (faults.has("prs-bad")) {
            sendJson(res, 200, { prs: "not-a-list" });
            return true;
        }
    }

    if (route === "/api/config") {
        if (faults.has("config")) {
            sendJson(res, 500, { error: "Injected fault: config" });
            return true;
        }
        if (faults.has("config-slow")) {
            await new Promise((r) => setTimeout(r, CONFIG_SLOW_MS));
        }
    }

    if (route === "/api/health" && faults.has("setup")) {
        const end = res.end.bind(res) as (chunk?: unknown) => ServerResponse;
        res.end = ((chunk?: unknown) => {
            if (typeof chunk !== "string") return end(chunk);
            const body = JSON.parse(chunk) as Record<string, unknown>;
            return end(JSON.stringify({ ...body, setup_complete: false }));
        }) as typeof res.end;
    }
    return false;
}
