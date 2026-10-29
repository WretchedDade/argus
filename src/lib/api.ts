// Typed client for the /api routes served by extension.mjs.

export type Lane = "quick" | "review";
export type PrState = "pending" | "reviewed" | "closed";
export type PrRole = "author" | "reviewer" | "team";
export type PrReviewState =
    "needs" | "covered" | "suggestions" | "approved" | "waiting" | "rejected";

export interface AuthorMeta {
    completable: boolean;
    blockers: string[];
    activeComments: number;
    resolvedComments: number;
    mergeStatus: string;
}

export interface Notice {
    id: string;
    kind: "app-update" | "skill-update";
    title: string;
    detail: string;
    href?: string;
    actionLabel?: string;
}

export interface ArchivableSession {
    repo: string;
    number: number;
    status: string;
    sessionId: string;
}

export interface InsightsCount {
    label: string;
    count: number;
}

export interface InsightsWaiting {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    waitingHours: number;
}

export interface InsightsLoadBucket {
    key: string;
    inflow: number;
    throughput: number;
    backlog: number;
}

export interface LoadDayPr {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    state: string | null;
    ageDays: number;
    dayKey: string;
}

export interface LoadDetail {
    key: string;
    endKey: string;
    granularity: "day" | "week";
    peakDayKey: string;
    arrived: LoadDayPr[];
    reviewed: LoadDayPr[];
    onPlate: LoadDayPr[];
}

export interface WeeklyReviewPr {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    author: string | null;
    authorType: "FTE" | "Vendor" | "Automated";
    reviewActions: number;
    lifetimeReviewActions: number;
    updateEpisodes: number;
    latestReviewAt: string;
    finalLane: Lane;
    changedFiles: number | null;
    totalComments: number | null;
    otherComments: number | null;
    effort: WeeklyReviewEffort | null;
}

export interface WeeklyReviewEffort {
    score: number;
    size: number;
    updates: number;
    depth: number;
    discussion: number;
    revisits: number;
}

export interface WeeklyReviewFacts {
    startKey: string;
    endKey: string;
    actionCount: number;
    uniquePrCount: number;
    prs: WeeklyReviewPr[];
    coverage: {
        sizeKnown: number;
        commentsKnown: number;
        scoreKnown: number;
    };
    effort: {
        total: number;
        average: number | null;
    };
}

export interface InsightsAuthoredPr {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    activeComments: number;
    blockers: string[];
    completable: boolean;
}

export interface Insights {
    generatedAt: string;
    summary: {
        reviewsAllTime: number;
        firstReviewAt: string | null;
        lastReviewAt: string | null;
        trackingSince: string | null;
    };
    latency: {
        count: number;
        pending: number;
        medianHours: number | null;
        p90Hours: number | null;
        fastestHours: number | null;
        slowestHours: number | null;
        points: {
            at: string;
            hours: number;
            repo: string;
            number: number;
            verdict: string | null;
        }[];
        distribution: InsightsCount[];
    };
    throughput: {
        total: number;
        weekly: {
            week: string;
            quick: number;
            review: number;
            total: number;
        }[];
    };
    load: {
        daily: InsightsLoadBucket[];
        weekly: InsightsLoadBucket[];
        peak: { count: number; at: string | null };
    };
    backlog: {
        waitingCount: number;
        longestHours: number | null;
        buckets: InsightsCount[];
        longest: InsightsWaiting[];
    };
    distribution: {
        byTeam: InsightsCount[];
        byRepo: InsightsCount[];
        byAuthorType: InsightsCount[];
    };
    reach: {
        items: {
            at: string;
            author: string;
            vendor: boolean;
            repo: string;
            teams: string[];
        }[];
    };
    votePattern: {
        byType: {
            label: string;
            approved: number;
            suggestions: number;
            waiting: number;
            rejected: number;
        }[];
        total: number;
        avgComments: number | null;
        commentsMeasured: number;
    };
    reviewDepth: {
        measured: number;
        totalComments: number;
        avg: number | null;
        median: number | null;
        p90: number | null;
        zeroRate: number | null;
        histogram: InsightsCount[];
        byType: {
            label: string;
            avg: number | null;
            count: number;
            total: number;
        }[];
        byRepo: { label: string; avg: number; count: number }[];
        byLatency: { label: string; avg: number | null; count: number }[];
    };
    votePath: {
        measured: number;
        outcomes: { firstPass: number; gated: number; held: number };
        turns: { turn: number; verdict: string; count: number }[];
    };
    reviewCoverage: {
        origins: {
            team: string;
            total: number;
            me: number;
            teammate: number;
            needs: number;
            prs: {
                number: number;
                repo: string;
                title: string;
                coverage: "me" | "teammate" | "needs";
            }[];
        }[];
    };
    reviewRhythm: {
        items: {
            at: string;
            repo: string;
            team: string | null;
            number: number;
            title: string;
            verdict: string | null;
            author: string | null;
            isVendor: boolean;
        }[];
    };
    balance: {
        days: {
            key: string;
            inflow: number;
            throughput: number;
            level: number;
        }[];
        heavyLine: number;
    };
    authored: {
        open: number;
        completable: number;
        blocked: number;
        mergedCount: number;
        medianMergeHours: number | null;
        openList: InsightsAuthoredPr[];
    };
}

export interface Pr {
    canonical: string;
    repo: string;
    number: number;
    title: string;
    description: string;
    author: string | null;
    isVendor: boolean;
    role: PrRole;
    teams: string[];
    requiredApproverGroups: string[];
    reviewState: PrReviewState | null;
    otherVotes: { name: string; vote: number }[];
    lane: Lane;
    state: PrState;
    isDraft: boolean;
    outOfScope: boolean;
    snoozedUntil: string | null;
    snoozeMode: "time" | "fte" | null;
    reviewSessionId: string | null;
    reviewedSha: string | null;
    reviewCount: number;
    changedFiles: number | null;
    authorMeta: AuthorMeta | null;
    prCreatedAt: string | null;
    updatedAt: string;
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

async function postAuth(path: string): Promise<AuthStatus> {
    const res = await fetch(path, { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `${path} -> ${res.status}`);
    return body as AuthStatus;
}

export interface ActivityEntry {
    id: number;
    ts: string;
    level: string;
    msg: string;
    data: Record<string, unknown> | null;
    runId: number | null;
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
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
}

export const api = {
    prs: () => getJson<{ prs: Pr[] }>("/api/prs").then((r) => r.prs),
    health: () => getJson<Health>("/api/health"),
    authStatus: () => getJson<AuthStatus>("/api/auth/status"),
    authRegistration: () => getJson<AuthRegistration>("/api/auth/registration"),
    saveAuthRegistration: async (reg: AuthRegistration) => {
        const res = await fetch("/api/auth/registration", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(reg),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `save failed ${res.status}`);
        return body as AuthRegistration;
    },
    signIn: () => postAuth("/api/auth/sign-in"),
    switchAccount: () => postAuth("/api/auth/switch-account"),
    signOut: () => postAuth("/api/auth/sign-out"),
    activity: (limit = 100) =>
        getJson<{ entries: ActivityEntry[] }>(
            `/api/activity?limit=${limit}`,
        ).then((r) => r.entries),
    runs: (limit = 50) =>
        getJson<{ runs: PollRun[] }>(`/api/runs?limit=${limit}`).then(
            (r) => r.runs,
        ),
    run: (id: number) => getJson<RunDetail>(`/api/run?id=${id}`),
    refresh: async () => {
        const res = await fetch("/api/refresh", { method: "POST" });
        if (!res.ok) throw new Error(`refresh -> ${res.status}`);
        return res.json();
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
        return (await res.json()).canonical ?? null;
    },
    trackPr: async (
        number: number,
    ): Promise<{ ok: boolean; canonical?: string; reason?: string }> => {
        const res = await fetch("/api/pr/track", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ number }),
        });
        return res.json();
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
        return res.json();
    },
    archivable: () =>
        getJson<{ archivable: ArchivableSession[] }>("/api/archivable").then(
            (r) => r.archivable,
        ),
    archive: async (): Promise<{ dispatched: number }> => {
        const res = await fetch("/api/archive", { method: "POST" });
        if (!res.ok) throw new Error(`archive -> ${res.status}`);
        return res.json();
    },
    changes: () => getJson<ChangeFeed>("/api/changes"),
    notices: () =>
        getJson<{ notices: Notice[] }>("/api/notices").then((r) => r.notices),
    actOnNotice: async (id: string): Promise<void> => {
        const res = await fetch("/api/notices/act", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`notices/act -> ${res.status}`);
    },
    dismissNotice: async (id: string): Promise<void> => {
        const res = await fetch("/api/notices/dismiss", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`notices/dismiss -> ${res.status}`);
    },
    insights: () =>
        getJson<{ insights: Insights }>("/api/insights").then(
            (r) => r.insights,
        ),
    weeklyReviewFacts: (startKey: string) =>
        getJson<{ facts: WeeklyReviewFacts }>(
            `/api/reviews/week?key=${encodeURIComponent(startKey)}`,
        ).then((r) => r.facts),
    loadDetail: (key: string, granularity: "day" | "week") =>
        getJson<{ detail: LoadDetail }>(
            `/api/load/detail?key=${key}&granularity=${granularity}`,
        ).then((r) => r.detail),
    markChangesRead: async (canonical: string): Promise<void> => {
        const res = await fetch("/api/changes/read", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ canonical }),
        });
        if (!res.ok) throw new Error(`changes/read -> ${res.status}`);
    },
    markAllChangesRead: async (): Promise<void> => {
        const res = await fetch("/api/changes/read-all", { method: "POST" });
        if (!res.ok) throw new Error(`changes/read-all -> ${res.status}`);
    },
};

// Shared query options so route loaders (prefetch) and useQuery use one key.
export const prsQuery = queryOptions({
    queryKey: ["prs"],
    queryFn: api.prs,
    refetchInterval: 10_000,
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

export interface Period {
    label: string;
    start: string;
    end: string;
}

export interface ArgusConfig {
    me: string | null;
    adoAuth: "az" | "broker";
    avatarUrl: string;
    orgUrl: string;
    orgSlug: string;
    project: string;
    teamPatterns: string[];
    teamLabels: Record<string, string>;
    periods: Period[];
    reviewSkillName: string;
    recencyDays: number;
    retentionDays: number;
    workStartHour: number;
    workEndHour: number;
    workDays: number[];
    checkForUpdates: boolean;
}

export const configApi = {
    get: () =>
        getJson<{ config: ArgusConfig }>("/api/config").then((r) => r.config),
    save: async (overrides: Partial<ArgusConfig>): Promise<ArgusConfig> => {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(overrides),
        });
        if (!res.ok) throw new Error(`config -> ${res.status}`);
        return (await res.json()).config as ArgusConfig;
    },
    teams: () =>
        getJson<{ teams: string[] }>("/api/teams").then((r) => r.teams),
    setup: async (
        overrides: Partial<ArgusConfig> & { installPrReviewSkill?: boolean },
    ): Promise<{
        config: ArgusConfig;
        skill: { installed: boolean; reason?: string };
    }> => {
        const res = await fetch("/api/setup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(overrides),
        });
        if (!res.ok) throw new Error(`setup -> ${res.status}`);
        const j = await res.json();
        return { config: j.config as ArgusConfig, skill: j.skill };
    },
};

export const configQuery = queryOptions({
    queryKey: ["config"],
    queryFn: configApi.get,
});
export const teamsQuery = queryOptions({
    queryKey: ["teams"],
    queryFn: configApi.teams,
});
