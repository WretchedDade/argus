import type { ArgusStore } from "./db.ts";
import type { ArgusConfig, ConfigOverrides } from "./config.ts";
import type { PollerStatus, ReconcileSummary } from "./ado/poller.ts";
import type { UpdateJob, UpdatePhase } from "./update-job.ts";
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
        opts: {
            verdict?: string;
            sha?: string;
            sessionId?: string;
            provisional?: boolean;
        },
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
