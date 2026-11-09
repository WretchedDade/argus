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
import { UpdateJob, type UpdatePhase } from "./update-job.ts";
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

function isMondayKey(key: string | null): key is string {
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getDay() === 1
    );
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

    if (route === "/api/load/detail") {
        const key = url.searchParams.get("key");
        const granularity = url.searchParams.get("granularity");
        if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key))
            sendJson(res, 400, { error: "key (YYYY-MM-DD) required" });
        else if (granularity !== "day" && granularity !== "week")
            sendJson(res, 400, { error: "granularity (day or week) required" });
        else {
            const cfg = ctx.getConfig();
            const work = { endHour: cfg.workEndHour, days: cfg.workDays };
            const detail =
                granularity === "week"
                    ? ctx.store.loadWeekDetail(key, cfg.recencyDays, work)
                    : ctx.store.loadDayDetail(key, cfg.recencyDays, work);
            sendJson(res, 200, { detail });
        }
        return true;
    }

    if (route === "/api/changes") {
        sendJson(res, 200, { changes: ctx.store.listUnreadChanges() });
        return true;
    }

    if (route === "/api/insights") {
        const cfg = ctx.getConfig();
        sendJson(res, 200, {
            insights: ctx.store.computeInsights(cfg.recencyDays, {
                endHour: cfg.workEndHour,
                days: cfg.workDays,
            }),
        });
        return true;
    }

    if (route === "/api/reviews/week") {
        const key = url.searchParams.get("key");
        if (!isMondayKey(key))
            sendJson(res, 400, {
                error: "key must be a Monday in YYYY-MM-DD format",
            });
        else sendJson(res, 200, { facts: ctx.store.weeklyReviewFacts(key) });
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

    if (route === "/api/version" && req.method === "GET") {
        sendJson(res, 200, { version: ctx.appVersion ?? null });
        return true;
    }

    if (route === "/api/notices" && req.method === "GET") {
        const dismissed = new Set(ctx.store.getDismissedNotices());
        const notices = (ctx.getNotices?.() ?? [])
            .filter((n) => !dismissed.has(n.id))
            .map(({ prompt: _prompt, ...rest }) => rest);
        sendJson(res, 200, { notices });
        return true;
    }

    if (route === "/api/notices/check" && req.method === "POST") {
        if (!ctx.checkForUpdatesNow) {
            sendJson(res, 501, { error: "Update check is not available." });
            return true;
        }
        if (!ctx.getConfig().checkForUpdates) {
            sendJson(res, 409, { error: "Update checks are turned off." });
            return true;
        }
        const result = await ctx.checkForUpdatesNow();
        // A manual check brings back a notice the user dismissed earlier.
        if (result.updateAvailable && result.latest) {
            ctx.store.restoreNotice(`app-update:${result.latest}`);
        }
        sendJson(res, 200, result);
        return true;
    }

    if (route === "/api/notices/act" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { id?: unknown };
        const notice = (ctx.getNotices?.() ?? []).find((n) => n.id === body.id);
        if (!notice?.prompt) {
            sendJson(res, 404, { error: "no action for that notice" });
            return true;
        }
        await ctx.dispatch(notice.prompt);
        // The storage notice clears only after the user's choice is saved.
        if (notice.kind !== "storage") ctx.store.dismissNotice(notice.id);
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (route === "/api/skill/replace" && req.method === "POST") {
        const notice = (ctx.getNotices?.() ?? []).find(
            (n) => n.kind === "skill-update",
        );
        if (!ctx.useBundledSkill) {
            sendJson(res, 501, {
                error: "Replacing the skill needs the Copilot app.",
            });
            return true;
        }
        if (!notice) {
            sendJson(res, 404, { error: "No skill update is pending." });
            return true;
        }
        try {
            const { backupPath } = ctx.useBundledSkill();
            ctx.store.dismissNotice(notice.id);
            sendJson(res, 200, { ok: true, backupPath });
        } catch (err) {
            sendJson(res, 500, { error: (err as Error).message });
        }
        return true;
    }

    if (route === "/api/update/apply" && req.method === "POST") {
        const notice = (ctx.getNotices?.() ?? []).find(
            (n) => n.kind === "app-update",
        );
        if (!ctx.applyUpdate) {
            sendJson(res, 501, {
                error: "Installing needs the Copilot app. Upgrade by hand with install.ps1 from the release ZIP.",
            });
            return true;
        }
        if (!notice) {
            sendJson(res, 404, { error: "No update is available to install." });
            return true;
        }
        const job = (ctx.updateJob ??= new UpdateJob());
        const apply = ctx.applyUpdate;
        const started = job.start(async (setPhase) => {
            await apply(setPhase);
            ctx.store.dismissNotice(notice.id);
        });
        if (!started) {
            sendJson(res, 409, { error: "An update is already running." });
            return true;
        }
        sendJson(res, 202, job.status());
        return true;
    }

    if (route === "/api/update/status" && req.method === "GET") {
        sendJson(res, 200, (ctx.updateJob ??= new UpdateJob()).status());
        return true;
    }

    if (route === "/api/notices/dismiss" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { id?: unknown };
        if (typeof body.id !== "string" || body.id.length === 0) {
            sendJson(res, 400, { error: "id is required" });
            return true;
        }
        ctx.store.dismissNotice(body.id);
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
