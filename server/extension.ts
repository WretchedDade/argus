import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { acknowledgeSkill, installSkill, syncSkill } from "./skill-sync.ts";
import { fetchLatestRelease, type ReleaseInfo } from "./update-check.ts";
import { buildNotices, type Notice } from "./notices.ts";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { ArgusStore } from "./db.ts";
import { countReviewComments, fetchPrThreads } from "./ado/client.ts";
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
    hasRequiredSetup,
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
import { setSession, log } from "./log.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");
const BOOT_AT = new Date().toISOString();

// Store lives on OneDrive by default so it survives devbox resets; overridable.
const ONEDRIVE_ROOT = process.env.OneDriveCommercial || process.env.OneDrive;
const DB_FILE =
    process.env.ARGUS_DB_FILE ||
    (ONEDRIVE_ROOT
        ? path.join(ONEDRIVE_ROOT, "Desktop", "argus.db")
        : path.join(__dirname, "data", "argus.db"));

// Legacy pr-tracker archive: read-only input for the one-time migration, only
// when explicitly pointed at a file. No default, so a shared install doesn't look
// for another user's paths.
const INVOLVEMENT_FILE = process.env.ARGUS_INVOLVEMENT_FILE;

// Old pr-tracker state file, imported once when explicitly provided.
const LEGACY_STATE_FILE = process.env.ARGUS_LEGACY_STATE_FILE;

const store = new ArgusStore(DB_FILE);
const migrated = INVOLVEMENT_FILE
    ? store.importInvolvement(INVOLVEMENT_FILE)
    : { imported: 0 };

// Effective config = env defaults + saved overrides, read fresh on every call so
// any store write (Settings save, or the poller backfilling `me`) is reflected.
const LOCAL_CONFIG_FILE =
    process.env.ARGUS_CONFIG_FILE || path.join(__dirname, "argus.config.json");
const getConfig = (): ArgusConfig =>
    mergeConfig(
        mergeConfig(defaultConfig(), loadLocalConfig(LOCAL_CONFIG_FILE)),
        store.getConfigOverrides(),
    );
const saveConfig = (overrides: ConfigOverrides): ArgusConfig => {
    store.saveConfigOverrides(overrides);
    return getConfig();
};

const legacyImported = LEGACY_STATE_FILE
    ? store.importLegacyState(LEGACY_STATE_FILE, getConfig().teamPatterns)
    : { imported: 0 };

// Backfill the first-run gate for installs that predate it: anyone with saved
// config or tracked PRs has already set things up, so don't show them setup.
if (
    !store.isSetupComplete() &&
    hasRequiredSetup(getConfig()) &&
    (store.counts().prs > 0 ||
        Object.keys(store.getConfigOverrides()).length > 0)
) {
    store.markSetupComplete();
}

const pollerCtx: PollerContext = { store, getConfig };

// One server per open canvas instance; all share the single store and poller.
const instances = new Map<string, Instance>();
let pollerRunning = false;

// Count the comments I authored on a PR (one az call), right after I record a
// verdict. Best-effort: on failure the count stays null and the poller retries.
async function countMyComments(canonical: string): Promise<void> {
    try {
        const cfg = getConfig();
        const pr = store.getPr(canonical);
        if (!cfg.me || !pr) return;
        const threads = await fetchPrThreads(
            cfg.orgUrl,
            pr.project,
            pr.repo,
            pr.number,
        );
        const comments = countReviewComments(threads, cfg.me);
        store.setCommentCounts(canonical, comments.mine, comments.others);
    } catch {
        /* left null; the poller backfill retries */
    }
}

// Record a verdict and kick off the comment count. Shared by the canvas action
// and the headless HTTP ingest endpoint so both paths behave identically.
function doRecordReview(
    canonical: string,
    opts: { verdict?: string; sha?: string; sessionId?: string },
): void {
    store.recordReview(canonical, opts);
    void countMyComments(canonical);
}

// Install the bundled baseline pr-review skill into the user's skills directory,
// so the first-run setup can offer it. Never overwrites an existing pr-review
// skill (the user may have their own tailored one).
const BUNDLED_SKILL = path.join(__dirname, "skills", "pr-review");
const INSTALLED_SKILL = path.join(
    process.env.COPILOT_HOME || path.join(homedir(), ".copilot"),
    "skills",
    "pr-review",
);

function installBaselineSkill(): { installed: boolean; reason?: string } {
    const src = BUNDLED_SKILL;
    if (!existsSync(src))
        return { installed: false, reason: "bundled skill not found" };
    const dest = INSTALLED_SKILL;
    if (existsSync(dest))
        return {
            installed: false,
            reason: "a pr-review skill already exists; left it untouched",
        };
    try {
        installSkill(src, dest);
        return { installed: true };
    } catch (err) {
        return { installed: false, reason: (err as Error).message };
    }
}

// The release ZIP has package.json beside extension.mjs; a repo checkout has it one level up.
function readAppVersion(): string {
    for (const dir of [__dirname, path.join(__dirname, "..")]) {
        try {
            const pkg = JSON.parse(
                readFileSync(path.join(dir, "package.json"), "utf-8"),
            ) as { version?: string };
            if (pkg.version) return pkg.version;
        } catch {
            /* try the next location */
        }
    }
    return "0.0.0";
}

const APP_VERSION = readAppVersion();
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let latestRelease: ReleaseInfo | null = null;
let pendingSkillHash: string | null = null;

try {
    const sync = syncSkill(BUNDLED_SKILL, INSTALLED_SKILL);
    if (sync.state === "pending") pendingSkillHash = sync.bundledHash;
    if (sync.state === "updated") log("baseline pr-review skill updated");
} catch (err) {
    log(`skill sync failed: ${(err as Error).message}`);
}

async function checkForUpdate(): Promise<void> {
    if (!getConfig().checkForUpdates) return;
    // Session hosts share the store, so the last-check time limits GitHub calls to one a day.
    const last = Number(store.getUpdateCheck()?.checkedAt ?? 0);
    if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) {
        latestRelease = store.getUpdateCheck()?.release ?? null;
        return;
    }
    latestRelease = await fetchLatestRelease();
    store.setUpdateCheck({ checkedAt: Date.now(), release: latestRelease });
}

void checkForUpdate();
setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS).unref();

function getNotices(): Notice[] {
    return buildNotices({
        appVersion: APP_VERSION,
        release: latestRelease,
        checkForUpdates: getConfig().checkForUpdates,
        installDir: __dirname,
        skill: pendingSkillHash
            ? {
                  bundledHash: pendingSkillHash,
                  bundledPath: BUNDLED_SKILL,
                  installedPath: INSTALLED_SKILL,
              }
            : null,
    });
}

const serverCtx = (): ServerContext => ({
    store,
    bootAt: BOOT_AT,
    migrated,
    distDir: DIST_DIR,
    reconcile: () => reconcileOnce(pollerCtx),
    refreshPr: (canonical: string) => refreshPr(pollerCtx, canonical),
    trackPr: (number: number) => trackByNumber(pollerCtx, number),
    recordReview: doRecordReview,
    dispatch: (message: string) => session.send(message),
    pollerStatus: getPollerStatus,
    getConfig,
    saveConfig,
    markSetupComplete: () => store.markSetupComplete(),
    installBaselineSkill,
    getNotices,
});

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "argus",
            displayName: "Argus",
            description:
                "React + TanStack canvas served by its own Node process.",
            inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
            actions: [
                {
                    name: "acknowledgeSkillMerge",
                    description:
                        "Call after you merged the bundled pr-review skill into the installed one. Clears the skill-update notice.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                    handler: async () => {
                        acknowledgeSkill(BUNDLED_SKILL, INSTALLED_SKILL);
                        pendingSkillHash = null;
                        return { ok: true };
                    },
                },
                {
                    name: "linkReviewSession",
                    description:
                        "Link the child session reviewing a PR so re-reviews can re-engage it. Call after spawning the review session.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            canonical: { type: "string" },
                            sessionId: { type: "string" },
                        },
                        required: ["canonical", "sessionId"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const { canonical, sessionId } = (ctx.input ?? {}) as {
                            canonical?: string;
                            sessionId?: string;
                        };
                        if (canonical && sessionId)
                            store.setReviewSession(canonical, sessionId);
                        return { ok: !!(canonical && sessionId) };
                    },
                },
                {
                    name: "recordReview",
                    description:
                        "Record a review outcome for a PR: the verdict, the reviewed commit sha (for re-push detection), and optionally the session that did it.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            canonical: { type: "string" },
                            verdict: {
                                type: "string",
                                description:
                                    "approved | suggestions | rejected | waiting | reviewed",
                            },
                            sha: {
                                type: "string",
                                description: "head commit sha reviewed",
                            },
                            sessionId: { type: "string" },
                        },
                        required: ["canonical"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const { canonical, verdict, sha, sessionId } =
                            (ctx.input ?? {}) as {
                                canonical?: string;
                                verdict?: string;
                                sha?: string;
                                sessionId?: string;
                            };
                        if (!canonical) return { ok: false };
                        doRecordReview(canonical, { verdict, sha, sessionId });
                        return { ok: true };
                    },
                },
            ],
            open: async (ctx) => {
                let instance = instances.get(ctx.instanceId);
                if (!instance) {
                    instance = {
                        instanceId: ctx.instanceId,
                        server: null,
                        url: null,
                    };
                    instances.set(ctx.instanceId, instance);
                    await startServer(instance, serverCtx());
                }
                // The poller runs only in a host that actually has the canvas open, so it
                // doesn't run in every session's background host. Start it when the first
                // canvas instance opens here.
                if (!pollerRunning) {
                    pollerRunning = true;
                    log("argus: canvas opened; starting poller in this host");
                    startPoller(pollerCtx);
                }
                return { title: "Argus", url: instance.url! };
            },
            onClose: async (ctx) => {
                const instance = instances.get(ctx.instanceId);
                if (!instance) return;
                instances.delete(ctx.instanceId);
                await stopInstance(instance);
                // Stop polling once this host has no canvas open — nothing here is
                // watching, and headless verdict ingest keeps working independently.
                if (instances.size === 0 && pollerRunning) {
                    pollerRunning = false;
                    log(
                        "argus: last canvas closed; stopping poller in this host",
                    );
                    stopPoller();
                }
            },
        }),
    ],
});

setSession(session);

// Headless verdict ingest: a fixed-port HTTP listener so review sessions can
// record via a plain POST — no canvas, no per-session extension host. Stays on
// regardless of any open canvas (first host to bind wins). The poller is
// separate and runs only in a canvas-open host (see the canvas open/onClose).
const INGEST_PORT = Number(process.env.ARGUS_INGEST_PORT ?? 48100);
const ingestServer = startIngestServer(serverCtx(), INGEST_PORT);

log(
    `argus loaded; store ${JSON.stringify(store.counts())}, migrated ${migrated.imported}, legacy ${legacyImported.imported}`,
);

// Release loopback ports and close the store cleanly on teardown.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`argus shutting down on ${signal}`);
    stopPoller();
    if (ingestServer) ingestServer.close();
    await Promise.race([
        Promise.all([...instances.values()].map(stopInstance)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    store.close();
    process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
