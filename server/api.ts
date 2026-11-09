import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArgusStore } from "./db.ts";
import type { ArgusConfig, ConfigOverrides } from "./config.ts";
import {
    ConfigError,
    hasRequiredSetup,
    mergeConfig,
    parseConfigOverrides,
} from "./config.ts";
import type { PollerStatus, ReconcileSummary } from "./ado/poller.ts";
import { resetIdentity } from "./ado/poller.ts";
import { authStatus, setAuthProvider, useBroker } from "./ado/client.ts";
import type { UpdateJob, UpdatePhase } from "./update-job.ts";
import { sendJson } from "./respond.ts";
import { createHonoHandler, isHonoRoute } from "./app.ts";
import {
    assertTrustedRequest,
    UntrustedRequestError,
} from "./trusted-request.ts";
import type { Notice } from "./notices.ts";
import type { DbLocation } from "./storage.ts";
export interface ApiContext {
    store: ArgusStore;
    bootAt: string;
    reconcile: () => Promise<ReconcileSummary | null | "skipped">;
    // Deletes all stored PR data once no poll is in flight.
    deleteAllData: () => Promise<void>;
    refreshPr: (canonical: string) => Promise<void>;
    trackPr: (
        number: number,
    ) => Promise<{ ok: boolean; canonical?: string; reason?: string }>;
    recordReview: (
        canonical: string,
        opts: { verdict?: string; sha?: string; sessionId?: string },
    ) => void;
    dispatch: (message: string) => Promise<void>;
    pollerStatus: () => PollerStatus;
    getConfig: () => ArgusConfig;
    saveConfig: (overrides: ConfigOverrides) => ArgusConfig;
    markSetupComplete: () => void;
    installBaselineSkill: () => { installed: boolean; reason?: string };
    useBundledSkill?: () => { backupPath: string };
    // Absent in standalone mode, where the location is not user-selectable.
    storage?: () => StorageInfo;
    setDbLocation?: (location: DbLocation) => {
        ok: boolean;
        restartRequired: boolean;
        reason?: string;
    };
    getNotices?: () => Notice[];
    appVersion?: string;
    checkForUpdatesNow?: () => Promise<UpdateCheckResult>;
    // Downloads, verifies, and installs the latest release. Absent in standalone mode.
    applyUpdate?: (setPhase: (phase: UpdatePhase) => void) => Promise<void>;
    updateJob?: UpdateJob;
}

export interface StorageInfo {
    location: DbLocation | null; // null when ARGUS_DB_FILE sets the path
    choosable: boolean; // false when ARGUS_DB_FILE sets the path
    oneDriveAvailable: boolean;
}

export interface UpdateCheckResult {
    ok: boolean;
    latest: string | null;
    updateAvailable: boolean;
}

async function readJsonBody(req: IncomingMessage): Promise<ConfigOverrides> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    return text ? (JSON.parse(text) as ConfigOverrides) : {};
}

const honoHandlers = new WeakMap<
    ApiContext,
    ReturnType<typeof createHonoHandler>
>();

function honoHandler(ctx: ApiContext): ReturnType<typeof createHonoHandler> {
    let handler = honoHandlers.get(ctx);
    if (!handler) {
        handler = createHonoHandler(ctx);
        honoHandlers.set(ctx, handler);
    }
    return handler;
}

// Handle an /api/* request. Returns false if the route isn't an API route, so
// the caller can fall through to static serving. New endpoints live here.
export async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: ApiContext,
): Promise<boolean> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const route = url.pathname;
    if (!route.startsWith("/api/")) return false;

    if (isHonoRoute(route)) {
        await honoHandler(ctx)(req, res);
        return true;
    }

    try {
        assertTrustedRequest(req);
    } catch (error) {
        if (!(error instanceof UntrustedRequestError)) throw error;
        sendJson(res, error.status, { error: error.message });
        return true;
    }

    if (route === "/api/health") setAuthProvider(ctx.getConfig().adoAuth); // another host may have saved a change

    if (route === "/api/health") {
        sendJson(res, 200, {
            ok: true,
            boot_at: ctx.bootAt,
            store: ctx.store.counts(),
            poller: ctx.pollerStatus(),
            storage: ctx.storage?.() ?? null,
            auth: useBroker() ? await authStatus() : null,
            setup_complete:
                ctx.store.isSetupComplete() &&
                hasRequiredSetup(ctx.getConfig()),
        });
        return true;
    }

    if (route === "/api/refresh" && req.method === "POST") {
        const result = await ctx.reconcile();
        const skipped = result === "skipped";
        sendJson(res, 200, { summary: skipped ? null : result, skipped });
        return true;
    }

    if (route === "/api/config") {
        if (req.method === "POST") {
            const before = ctx.getConfig().adoAuth;
            let body: ConfigOverrides;
            try {
                body = parseConfigOverrides(await readJsonBody(req));
            } catch (err) {
                if (!(err instanceof ConfigError)) throw err;
                sendJson(res, 400, { error: err.message });
                return true;
            }
            const config = ctx.saveConfig({
                ...ctx.store.getConfigOverrides(),
                ...body,
            });
            setAuthProvider(config.adoAuth);
            if (config.adoAuth !== before) resetIdentity(ctx.store);
            sendJson(res, 200, { config });
        } else sendJson(res, 200, { config: ctx.getConfig() });
        return true;
    }

    // First-run setup: save the config the user entered and mark setup done, so the
    // UI switches from the setup gate to the board. Optionally installs the bundled
    // baseline pr-review skill. Body is config overrides plus installPrReviewSkill.
    if (route === "/api/setup" && req.method === "POST") {
        const body = await readJsonBody(req);
        let overrides: ConfigOverrides;
        try {
            overrides = parseConfigOverrides(body);
        } catch (err) {
            if (!(err instanceof ConfigError)) throw err;
            sendJson(res, 400, { error: err.message });
            return true;
        }
        const installPrReviewSkill =
            (body as Record<string, unknown>).installPrReviewSkill === true;
        if (!hasRequiredSetup(mergeConfig(ctx.getConfig(), overrides))) {
            sendJson(res, 400, {
                error: "Valid org URL, org slug, and project required",
            });
            return true;
        }
        const dbLocation = (body as Record<string, unknown>).dbLocation;
        if (
            dbLocation !== undefined &&
            dbLocation !== "local" &&
            dbLocation !== "onedrive"
        ) {
            sendJson(res, 400, {
                error: "dbLocation must be local or onedrive",
            });
            return true;
        }
        const storage =
            dbLocation && ctx.setDbLocation
                ? ctx.setDbLocation(dbLocation)
                : null;
        if (storage && !storage.ok) {
            sendJson(res, 400, {
                error: storage.reason ?? "Could not save the storage location",
            });
            return true;
        }
        const config = ctx.saveConfig(overrides);
        setAuthProvider(config.adoAuth);
        ctx.markSetupComplete();
        const skill = installPrReviewSkill
            ? ctx.installBaselineSkill()
            : { installed: false, reason: "skipped" };
        sendJson(res, 200, { config, setup_complete: true, skill, storage });
        return true;
    }

    if (route === "/api/changes") {
        sendJson(res, 200, { changes: ctx.store.listUnreadChanges() });
        return true;
    }

    if (route === "/api/changes/read" && req.method === "POST") {
        const { canonical } = (await readJsonBody(req)) as {
            canonical?: string;
        };
        if (!canonical) {
            sendJson(res, 400, { error: "canonical required" });
            return true;
        }
        ctx.store.markChangesReadForPr(canonical);
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/changes/read-all" && req.method === "POST") {
        ctx.store.markAllChangesRead();
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/data/delete-all" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { confirm?: unknown } | null;
        if (body?.confirm !== "delete") {
            sendJson(res, 400, { error: 'confirm must be "delete"' });
            return true;
        }
        await ctx.deleteAllData();
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/teams") {
        sendJson(res, 200, { teams: ctx.store.getSeenTeams() });
        return true;
    }

    if (route === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") ?? 100);
        sendJson(res, 200, { entries: ctx.store.listActivity(limit) });
        return true;
    }

    // Windowed PR activity feed for external consumers (Clio's capture pulse).
    // ?since=<ISO8601>&until=<ISO8601>; until defaults to now, since to 24h before
    // until. Events with ts in [since, until), time-ordered ascending.
    if (route === "/api/pr-activity") {
        const nowMs = Date.now();
        const untilRaw = url.searchParams.get("until");
        const sinceRaw = url.searchParams.get("since");
        const untilMs = untilRaw ? Date.parse(untilRaw) : nowMs;
        if (Number.isNaN(untilMs)) {
            sendJson(res, 400, { error: "until must be ISO8601" });
            return true;
        }
        const sinceMs = sinceRaw
            ? Date.parse(sinceRaw)
            : untilMs - 24 * 60 * 60 * 1000;
        if (Number.isNaN(sinceMs)) {
            sendJson(res, 400, { error: "since must be ISO8601" });
            return true;
        }
        sendJson(res, 200, {
            since: new Date(sinceMs).toISOString(),
            until: new Date(untilMs).toISOString(),
            generatedAt: new Date().toISOString(),
            events: ctx.store.listPrActivity(sinceMs, untilMs),
        });
        return true;
    }

    if (route === "/api/runs") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        sendJson(res, 200, { runs: ctx.store.listPollRuns(limit) });
        return true;
    }

    if (route === "/api/run") {
        const id = Number(url.searchParams.get("id"));
        if (!id) sendJson(res, 400, { error: "id required" });
        else
            sendJson(res, 200, {
                run: ctx.store.getRun(id),
                entries: ctx.store.listActivityForRun(id),
                changes: ctx.store.listRunEvents(id),
            });
        return true;
    }

    sendJson(res, 404, { error: "not found" });
    return true;
}
