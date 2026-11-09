import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArgusStore } from "./db.ts";
import type { ArgusConfig, ConfigOverrides } from "./config.ts";
import type { PollerStatus, ReconcileSummary } from "./ado/poller.ts";
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

// Keep the migration adapter until the domain changes are integrated.
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

    sendJson(res, 404, { error: "not found" });
    return true;
}
