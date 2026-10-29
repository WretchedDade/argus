// Runs Argus in a normal browser, without the Copilot app host. Use it to try a
// branch. Anything that needs a Copilot session (Review, re-review, archive)
// is unavailable here.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { buildNotices } from "./notices.ts";
import type { UpdateCheckResult } from "./api.ts";
import {
    fetchLatestRelease,
    isNewerVersion,
    type ReleaseInfo,
} from "./update-check.ts";
import { ArgusStore } from "./db.ts";
import {
    startServer,
    stopInstance,
    startIngestServer,
    type Instance,
    type ServerContext,
} from "./server.ts";
import {
    defaultConfig,
    loadLocalConfig,
    mergeConfig,
    type ArgusConfig,
    type ConfigOverrides,
} from "./config.ts";
import {
    startPoller,
    stopPoller,
    reconcileOnce,
    refreshPr,
    trackByNumber,
    getPollerStatus,
    type PollerContext,
} from "./ado/poller.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Scratch DB by default, never the real OneDrive store.
const DB_FILE =
    process.env.ARGUS_DB_FILE || path.join(root, "data", "standalone.db");
const CONFIG_FILE =
    process.env.ARGUS_CONFIG_FILE || path.join(root, "argus.config.json");
const INGEST_PORT = Number(process.env.ARGUS_INGEST_PORT ?? 48199);

const store = new ArgusStore(DB_FILE);
const getConfig = (): ArgusConfig =>
    mergeConfig(
        mergeConfig(defaultConfig(), loadLocalConfig(CONFIG_FILE)),
        store.getConfigOverrides(),
    );
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

// ARGUS_FAKE_RELEASE=9.9.9 shows an update notice without a published release.
let latestRelease: ReleaseInfo | null = process.env.ARGUS_FAKE_RELEASE
    ? {
          version: process.env.ARGUS_FAKE_RELEASE,
          url: "https://github.com/WretchedDade/argus/releases",
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
    migrated: { imported: 0 },
    distDir: path.join(root, "dist"),
    reconcile: () => reconcileOnce(pollerCtx),
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
            checkForUpdates: getConfig().checkForUpdates,
            installDir: root,
            skill: process.env.ARGUS_FAKE_SKILL_UPDATE
                ? {
                      bundledHash: "fake",
                      bundledPath: "extension\\skills\\pr-review",
                      installedPath: "~\\.copilot\\skills\\pr-review",
                  }
                : null,
        }),
};

const instance: Instance = {
    instanceId: process.env.ARGUS_STANDALONE_ID || "argus-standalone",
    server: null,
    url: null,
};
await startServer(instance, ctx);
const ingest = startIngestServer(ctx, INGEST_PORT);
startPoller(pollerCtx);

console.log(`Argus standalone: ${instance.url}`);
console.log(`DB: ${DB_FILE}`);
console.log(`Config: ${CONFIG_FILE}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
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
