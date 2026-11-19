// Runs Argus in a normal browser, without the Copilot app host. Use it to try a
// branch. Anything that needs a Copilot session (Review, re-review, archive)
// is unavailable here.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { logger } from "./log.ts";
import { buildNotices } from "./notices.ts";
import type { UpdateCheckResult } from "./api.ts";
import {
    fetchLatestRelease,
    isNewerVersion,
    type ReleaseInfo,
} from "./update-check.ts";
import { ArgusStore } from "./db.ts";
import { setIngestPort } from "./ingest.ts";
import {
    startServer,
    stopInstance,
    startIngestServer,
    type Instance,
    type ServerContext,
} from "./server.ts";
import {
    defaultConfig,
    mergeConfig,
    type ArgusConfig,
    type ConfigOverrides,
} from "./config.ts";
import {
    startPoller,
    stopPoller,
    reconcileOnce,
    runWhenPollerIdle,
    refreshPr,
    trackByNumber,
    getPollerStatus,
    type PollerContext,
} from "./ado/poller.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Scratch DB by default, never the real OneDrive store.
const DB_FILE =
    process.env.ARGUS_DB_FILE || path.join(root, "data", "standalone.db");
const INGEST_PORT = Number(process.env.ARGUS_INGEST_PORT ?? 48199);
setIngestPort(INGEST_PORT);

const store = new ArgusStore(DB_FILE);
const getConfig = (): ArgusConfig =>
    mergeConfig(defaultConfig(), store.getConfigOverrides());
const saveConfig = (overrides: ConfigOverrides): ArgusConfig => {
    store.saveConfigOverrides(overrides);
    return getConfig();
};

const pollerCtx: PollerContext = { store, getConfig };

const APP_VERSION = (
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
        version: string;
    }
).version;

const previewNotices = process.env.ARGUS_FAKE_NOTICES === "1";
const previewVersion =
    process.env.ARGUS_FAKE_RELEASE ?? (previewNotices ? "99.0.0" : undefined);
// ARGUS_FAKE_RELEASE=9.9.9 shows an update notice without a published release.
let latestRelease: ReleaseInfo | null = previewVersion
    ? {
          version: previewVersion,
          url: "https://github.com/WretchedDade/argus/releases",
          zipUrl: `https://github.com/WretchedDade/argus/releases/download/v${previewVersion}/argus-v${previewVersion}-windows.zip`,
          checksumUrl: `https://github.com/WretchedDade/argus/releases/download/v${previewVersion}/argus-v${previewVersion}-windows.zip.sha256`,
      }
    : null;
const fakeRelease = latestRelease;
async function checkForUpdate(): Promise<void> {
    if (fakeRelease || !getConfig().checkForUpdates) return;
    const release = await fetchLatestRelease();
    if (release) latestRelease = release;
}
void checkForUpdate();
setInterval(() => void checkForUpdate(), 24 * 60 * 60 * 1000).unref();

async function checkForUpdatesNow(): Promise<UpdateCheckResult> {
    const release = fakeRelease ?? (await fetchLatestRelease());
    if (release) latestRelease = release;
    const current = release ?? latestRelease;
    return {
        ok: release !== null,
        latest: current?.version ?? null,
        updateAvailable: current
            ? isNewerVersion(current.version, APP_VERSION)
            : false,
    };
}

const unavailable = async (): Promise<void> => {
    throw new Error("Needs the Copilot app. Not available in standalone mode.");
};

const ctx: ServerContext = {
    store,
    bootAt: new Date().toISOString(),
    distDir: path.join(root, "dist"),
    reconcile: () => reconcileOnce(pollerCtx),
    deleteAllData: () => runWhenPollerIdle(() => store.deleteAllData()),
    refreshPr: (canonical: string) => refreshPr(pollerCtx, canonical),
    trackPr: (number: number) => trackByNumber(pollerCtx, number),
    recordReview: (canonical, opts) => store.recordReview(canonical, opts),
    dispatch: unavailable,
    pollerStatus: getPollerStatus,
    getConfig,
    saveConfig,
    markSetupComplete: () => store.markSetupComplete(),
    installBaselineSkill: () => ({
        installed: false,
        reason: "not available in standalone mode",
    }),
    appVersion: APP_VERSION,
    checkForUpdatesNow,
    getNotices: () =>
        buildNotices({
            appVersion: APP_VERSION,
            release: latestRelease,
            checkForUpdates: previewNotices || getConfig().checkForUpdates,
            skill:
                previewNotices || process.env.ARGUS_FAKE_SKILL_UPDATE
                    ? {
                          bundledHash: "fake",
                          bundledPath: "extension\\skills\\pr-review",
                          installedPath: "~\\.copilot\\skills\\pr-review",
                      }
                    : null,
            legacyDb: previewNotices
                ? {
                      path: "preview\\OneDrive\\argus.db",
                      localPath: "preview\\local\\argus.db",
                      choiceFile: "preview\\storage.json",
                  }
                : null,
        }).map((notice) =>
            previewNotices
                ? {
                      ...notice,
                      id: `preview:${notice.id}`,
                      title: `Preview: ${notice.title}`,
                      detail: `Synthetic preview only. Copilot actions are unavailable in standalone mode.\n${notice.detail}`,
                  }
                : notice,
        ),
};

const instance: Instance = {
    instanceId: process.env.ARGUS_STANDALONE_ID || "argus-standalone",
    server: null,
    url: null,
};
await startServer(instance, ctx);
const ingest = startIngestServer(ctx, INGEST_PORT);
startPoller(pollerCtx);

logger.info(
    {
        component: "standalone",
        url: instance.url,
        dbFile: DB_FILE,
    },
    "Argus standalone started",
);

let shuttingDown = false;
async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ component: "standalone" }, "Argus standalone shutting down");
    stopPoller();
    if (ingest) ingest.close();
    await Promise.race([
        stopInstance(instance),
        new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    store.close();
    process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
