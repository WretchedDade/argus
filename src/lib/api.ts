// Typed client for the /api routes served by extension.mjs.

import { hc } from "hono/client";
import type { AppType } from "../../server/app";
import { SLOW_STALE_TIME_MS } from "./query-defaults";
import { ApiError } from "./errors";

import { PrsResponseSchema } from "#shared/schemas/pr";
import type {
    AuthorMeta,
    Lane,
    Pr,
    PrReviewState,
    PrRole,
    PrState,
} from "#shared/schemas/pr";

import { NoticesResponseSchema, type Notice } from "#shared/schemas/notice";
import {
    ActivityEntriesResponseSchema,
    type ActivityEntry,
} from "#shared/schemas/activity";
import {
    ConfigResponseSchema,
    type ArgusConfig,
    type Period,
} from "#shared/schemas/config";
import {
    InsightsResponseSchema,
    LoadDetailResponseSchema,
    WeeklyReviewFactsResponseSchema,
    type Insights,
    type InsightsAuthoredPr,
    type InsightsCount,
    type InsightsLoadBucket,
    type InsightsWaiting,
    type LoadDayPr,
    type LoadDetail,
    type WeeklyReviewEffort,
    type WeeklyReviewFacts,
    type WeeklyReviewPr,
} from "#shared/schemas/insights";

export type { AuthorMeta, Lane, Pr, PrReviewState, PrRole, PrState };
export type { Notice, ActivityEntry, ArgusConfig, Period };
export type {
    Insights,
    InsightsAuthoredPr,
    InsightsCount,
    InsightsLoadBucket,
    InsightsWaiting,
    LoadDayPr,
    LoadDetail,
    WeeklyReviewEffort,
    WeeklyReviewFacts,
    WeeklyReviewPr,
};

export type UpdatePhase =
    | "idle"
    | "downloading"
    | "verifying"
    | "extracting"
    | "installing"
    | "done"
    | "error";

export interface UpdateStatus {
    phase: UpdatePhase;
    error: string | null;
}

export const isUpdateRunning = (phase: UpdatePhase | undefined): boolean =>
    phase === "downloading" ||
    phase === "verifying" ||
    phase === "extracting" ||
    phase === "installing";

export interface ArchivableSession {
    repo: string;
    number: number;
    status: string;
    sessionId: string;
}

export interface StaleCandidate {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    author: string | null;
    updatedAt: string;
    idleDays: number;
}

export interface StalePreview {
    approved: boolean;
    days: number;
    candidates: StaleCandidate[];
}

export interface RepoScopeRow {
    repo: string;
    scope: "in" | "out" | null;
    open: number;
    hidden: number;
}

export interface PollerStatus {
    me: string | null;
    authOk: boolean;
    running: boolean;
    currentRunId: number | null;
    lastRunAt: string | null;
    lastSummary: {
        mine: number;
        tracked: number;
        added: number;
        updated: number;
        events: number;
        closed: number;
    } | null;
    lastError: string | null;
}

export interface Health {
    ok: boolean;
    boot_at: string;
    store: { prs: number; events: number };
    poller: PollerStatus;
    storage: {
        location: "local" | "onedrive" | null;
        choosable: boolean;
        oneDriveAvailable: boolean;
    } | null;
    setup_complete: boolean;
    auth: AuthStatus | null;
}

export interface AuthRegistration {
    clientId: string;
    tenantId: string;
    fromEnv?: boolean;
}

export interface AuthStatus {
    provider: "az" | "broker";
    configured: boolean;
    supported: boolean;
    interactionRequired: boolean;
    account: { username: string } | null;
    error: string | null;
}

const JSON_HEADERS = { "content-type": "application/json" };

function readJson<T>(res: Response): Promise<T> {
    return res.json() as Promise<T>;
}

const authClient = hc<AppType>("/", { headers: JSON_HEADERS }).api.auth;
const noticeClient = hc<AppType>("/", { headers: JSON_HEADERS }).api;

async function noticeRead<T>(
    res: { ok: boolean; status: number; json: () => Promise<T> },
    path: string,
): Promise<T> {
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
            error?: string;
        } | null;
        throw new ApiError(path, res.status, body?.error ?? null);
    }
    return res.json();
}

async function authResult<T>(res: Response, fallback: string): Promise<T> {
    const body = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${fallback} ${res.status}`);
    return body;
}

export interface PollRun {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    ok: boolean;
    mine: number | null;
    tracked: number | null;
    added: number | null;
    updated: number | null;
    events: number | null;
    closed: number | null;
    error: string | null;
}

import { queryOptions } from "@tanstack/react-query";

export interface RunEvent {
    id: number;
    canonical: string;
    ts: string;
    type: string;
    payload: Record<string, unknown> | null;
    repo: string;
    number: number;
    title: string;
}

export interface RunDetail {
    run: PollRun | null;
    entries: ActivityEntry[];
    changes: RunEvent[];
}

export interface ChangeFeed {
    changes: RunEvent[];
}

async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
            error?: string;
        } | null;
        throw new ApiError(path, res.status, body?.error ?? null);
    }
    return (await res.json()) as T;
}

async function postJson<T>(path: string, body: object): Promise<T> {
    const res = await fetch(path, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
}

export const api = {
    prs: () =>
        getJson<unknown>("/api/prs").then(
            (r) => PrsResponseSchema.parse(r).prs,
        ),
    health: () => getJson<Health>("/api/health"),
    authStatus: () => getJson<AuthStatus>("/api/auth/status"),
    authRegistration: () => getJson<AuthRegistration>("/api/auth/registration"),
    saveAuthRegistration: async (reg: AuthRegistration) =>
        authResult<AuthRegistration>(
            await authClient.registration.$post({
                json: { clientId: reg.clientId, tenantId: reg.tenantId },
            }),
            "save failed",
        ),
    signIn: async () =>
        authResult<AuthStatus>(await authClient["sign-in"].$post(), "sign-in"),
    switchAccount: async () =>
        authResult<AuthStatus>(
            await authClient["switch-account"].$post(),
            "switch-account",
        ),
    signOut: async () =>
        authResult<AuthStatus>(
            await authClient["sign-out"].$post(),
            "sign-out",
        ),
    activity: (limit = 100) =>
        getJson<unknown>(`/api/activity?limit=${limit}`).then(
            (r) => ActivityEntriesResponseSchema.parse(r).entries,
        ),
    runs: (limit = 50) =>
        getJson<{ runs: PollRun[] }>(`/api/runs?limit=${limit}`).then(
            (r) => r.runs,
        ),
    run: (id: number) => getJson<RunDetail>(`/api/run?id=${id}`),
    refresh: async () => {
        const res = await fetch("/api/refresh", {
            method: "POST",
            headers: JSON_HEADERS,
        });
        if (!res.ok) throw new Error(`refresh -> ${res.status}`);
        return readJson<{ summary: object | null; skipped?: boolean }>(res);
    },
    setScope: async (canonical: string, outOfScope: boolean): Promise<void> => {
        const res = await fetch("/api/pr/scope", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical, outOfScope }),
        });
        if (!res.ok) throw new Error(`scope -> ${res.status}`);
    },
    setLane: async (canonical: string, lane: Lane): Promise<void> => {
        const res = await fetch("/api/pr/lane", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical, lane }),
        });
        if (!res.ok) throw new Error(`lane -> ${res.status}`);
    },
    refreshPr: async (canonical: string): Promise<void> => {
        const res = await fetch("/api/pr/refresh", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical }),
        });
        if (!res.ok) throw new Error(`refreshPr -> ${res.status}`);
    },
    findPr: async (number: number): Promise<string | null> => {
        const res = await fetch(`/api/pr/find?number=${number}`);
        if (!res.ok) throw new Error(`findPr -> ${res.status}`);
        const body = await readJson<{ canonical?: string | null }>(res);
        return body.canonical ?? null;
    },
    trackPr: async (
        number: number,
    ): Promise<{ ok: boolean; canonical?: string; reason?: string }> => {
        const res = await fetch("/api/pr/track", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ number }),
        });
        return readJson(res);
    },
    setSnooze: async (
        canonical: string,
        until: string | null,
        mode: "time" | "fte" | null = null,
    ): Promise<void> => {
        const res = await fetch("/api/pr/snooze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                canonical,
                until,
                mode: mode ?? (until ? "time" : null),
            }),
        });
        if (!res.ok) throw new Error(`snooze -> ${res.status}`);
    },
    review: async (
        canonical: string,
        automatic = false,
    ): Promise<{ reReview: boolean }> => {
        const res = await fetch("/api/pr/review", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical, automatic }),
        });
        if (!res.ok) throw new Error(`review -> ${res.status}`);
        return readJson(res);
    },
    archivedPrs: () =>
        getJson<{ prs: Pr[] }>("/api/archived").then((r) => r.prs),
    stalePreview: () => getJson<StalePreview>("/api/archive/preview"),
    sweepStale: (canonicals: string[]) =>
        postJson<{ archived: number }>("/api/archive/sweep", { canonicals }),
    restorePr: (canonical: string) =>
        postJson<{ restored: boolean }>("/api/pr/restore", { canonical }),
    repoScopes: () =>
        getJson<{ repos: RepoScopeRow[] }>("/api/repo-scopes").then(
            (r) => r.repos,
        ),
    setRepoScope: (repo: string, scope: "in" | "out" | null) =>
        postJson<{
            archived: number;
            revived: number;
            kept: number;
            repos: RepoScopeRow[];
        }>("/api/repo-scopes", {
            repo,
            scope,
        }),
    archivable: () =>
        getJson<{ archivable: ArchivableSession[] }>("/api/archivable").then(
            (r) => r.archivable,
        ),
    archive: async (): Promise<{ dispatched: number }> => {
        const res = await fetch("/api/archive", {
            method: "POST",
            headers: JSON_HEADERS,
        });
        if (!res.ok) throw new Error(`archive -> ${res.status}`);
        return readJson(res);
    },
    changes: () => getJson<ChangeFeed>("/api/changes"),
    notices: async () => {
        const res = await noticeClient.notices.$get();
        return NoticesResponseSchema.parse(
            await noticeRead(res, "/api/notices"),
        ).notices;
    },
    actOnNotice: async (id: string): Promise<void> => {
        const res = await noticeClient.notices.act.$post({ json: { id } });
        if (!res.ok) throw new Error(`notices/act -> ${res.status}`);
    },
    useBundledSkill: async (): Promise<{ backupPath: string }> => {
        const res = await noticeClient.skill.replace.$post();
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
                error?: string;
            } | null;
            throw new Error(body?.error ?? `skill/replace -> ${res.status}`);
        }
        return res.json();
    },
    applyUpdate: async (): Promise<void> => {
        const res = await noticeClient.update.apply.$post();
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
                error?: string;
            } | null;
            throw new Error(body?.error ?? `update/apply -> ${res.status}`);
        }
    },
    updateStatus: async (): Promise<UpdateStatus> => {
        const res = await noticeClient.update.status.$get();
        if (!res.ok) throw new Error(`update/status -> ${res.status}`);
        return res.json();
    },
    deleteAllData: async (): Promise<void> => {
        const res = await fetch("/api/data/delete-all", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ confirm: "delete" }),
        });
        if (!res.ok) throw new Error(`data/delete-all -> ${res.status}`);
    },
    checkForUpdatesNow: async (): Promise<{
        ok: boolean;
        latest: string | null;
        updateAvailable: boolean;
    }> => {
        const res = await noticeClient.notices.check.$post();
        if (res.status === 409) throw new Error("off");
        if (!res.ok) throw new Error(`notices/check -> ${res.status}`);
        return res.json();
    },
    dismissNotice: async (id: string): Promise<void> => {
        const res = await noticeClient.notices.dismiss.$post({ json: { id } });
        if (!res.ok) throw new Error(`notices/dismiss -> ${res.status}`);
    },
    insights: () =>
        getJson<unknown>("/api/insights").then(
            (r) => InsightsResponseSchema.parse(r).insights,
        ),
    weeklyReviewFacts: (startKey: string) =>
        getJson<unknown>(
            `/api/reviews/week?key=${encodeURIComponent(startKey)}`,
        ).then((r) => WeeklyReviewFactsResponseSchema.parse(r).facts),
    loadDetail: (key: string, granularity: "day" | "week") =>
        getJson<unknown>(
            `/api/load/detail?key=${key}&granularity=${granularity}`,
        ).then((r) => LoadDetailResponseSchema.parse(r).detail),
    markChangesRead: async (canonical: string): Promise<void> => {
        const res = await fetch("/api/changes/read", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical }),
        });
        if (!res.ok) throw new Error(`changes/read -> ${res.status}`);
    },
    markAllChangesRead: async (): Promise<void> => {
        const res = await fetch("/api/changes/read-all", {
            method: "POST",
            headers: JSON_HEADERS,
        });
        if (!res.ok) throw new Error(`changes/read-all -> ${res.status}`);
    },
};

// Shared query options so route loaders (prefetch) and useQuery use one key.
export const prsQuery = queryOptions({
    queryKey: ["prs"],
    queryFn: api.prs,
    refetchInterval: 10_000,
});
export const archivedQuery = queryOptions({
    queryKey: ["archived"],
    queryFn: api.archivedPrs,
    refetchInterval: 15_000,
});
export const stalePreviewQuery = queryOptions({
    queryKey: ["stale-preview"],
    queryFn: api.stalePreview,
    refetchInterval: 60_000,
});
export const repoScopesQuery = queryOptions({
    queryKey: ["repo-scopes"],
    queryFn: api.repoScopes,
});
export const archivableQuery = queryOptions({
    queryKey: ["archivable"],
    queryFn: api.archivable,
    refetchInterval: 15_000,
});
export const noticesQuery = queryOptions({
    queryKey: ["notices"],
    queryFn: api.notices,
    refetchInterval: 60_000,
});
export const updateStatusQuery = queryOptions({
    queryKey: ["update-status"],
    queryFn: api.updateStatus,
    refetchInterval: (query) =>
        isUpdateRunning(query.state.data?.phase) ? 1_000 : false,
});
export const changesQuery = queryOptions({
    queryKey: ["changes"],
    queryFn: api.changes,
    refetchInterval: 12_000,
});
export const insightsQuery = queryOptions({
    queryKey: ["insights"],
    queryFn: api.insights,
    refetchInterval: 30_000,
});
export const weeklyReviewFactsQuery = (startKey: string) =>
    queryOptions({
        queryKey: ["weeklyReviewFacts", startKey],
        queryFn: () => api.weeklyReviewFacts(startKey),
        refetchInterval: 30_000,
    });
export const healthQuery = queryOptions({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 4000,
});
export const runsQuery = queryOptions({
    queryKey: ["runs"],
    queryFn: () => api.runs(50),
    refetchInterval: 5000,
});

// A run's detail polls quickly while it's still running, then stops once done.
export const runQuery = (id: number) =>
    queryOptions({
        queryKey: ["run", id],
        queryFn: () => api.run(id),
        refetchInterval: (query) =>
            query.state.data?.run && !query.state.data.run.finishedAt
                ? 1200
                : false,
    });

export interface PrEvent {
    id: number;
    canonical: string;
    ts: string;
    type: string;
    payload: Record<string, unknown> | null;
}

export interface PrDetail {
    pr: Pr | null;
    events: PrEvent[];
}

export const prDetailQuery = (canonical: string) =>
    queryOptions({
        queryKey: ["pr", canonical],
        queryFn: () =>
            getJson<PrDetail>(
                `/api/pr?canonical=${encodeURIComponent(canonical)}`,
            ),
        refetchInterval: 10_000,
    });

export const configApi = {
    get: () =>
        getJson<unknown>("/api/config").then(
            (r) => ConfigResponseSchema.parse(r).config,
        ),
    save: async (overrides: Partial<ArgusConfig>): Promise<ArgusConfig> => {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(overrides),
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
                error?: string;
            } | null;
            throw new Error(body?.error ?? `config -> ${res.status}`);
        }
        return (await readJson<{ config: ArgusConfig }>(res)).config;
    },
    teams: () =>
        getJson<{ teams: string[] }>("/api/teams").then((r) => r.teams),
    version: async () => {
        const res = await noticeClient.version.$get();
        return (await noticeRead(res, "/api/version")).version;
    },
    setup: async (
        overrides: Partial<ArgusConfig> & {
            installPrReviewSkill?: boolean;
            dbLocation?: "local" | "onedrive";
        },
    ): Promise<{
        config: ArgusConfig;
        skill: { installed: boolean; reason?: string };
        storage: {
            ok: boolean;
            restartRequired: boolean;
            reason?: string;
        } | null;
    }> => {
        const res = await fetch("/api/setup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(overrides),
        });
        if (!res.ok) throw new Error(`setup -> ${res.status}`);
        return readJson(res);
    },
};

export const configQuery = queryOptions({
    queryKey: ["config"],
    queryFn: configApi.get,
    staleTime: SLOW_STALE_TIME_MS,
});
export const versionQuery = queryOptions({
    queryKey: ["version"],
    queryFn: configApi.version,
    staleTime: Infinity,
});
export const teamsQuery = queryOptions({
    queryKey: ["teams"],
    queryFn: configApi.teams,
    staleTime: SLOW_STALE_TIME_MS,
});
