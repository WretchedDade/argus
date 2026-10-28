// Deploy resolution for Argus: given a merged PR's merge commit, find the build
// that carried it and read how far it has deployed across dev/ppe/prod. Ported
// from the pipeline-status canvas's ado.mjs, trimmed to the SHA-anchored path we
// need (the merge commit pins the exact build, so no "scan for what's live").
import { adoAccessToken } from "./client.ts";
import type { DeployEnv, PrDeploy } from "../types.ts";

const FETCH_TIMEOUT_MS = 20_000;

async function adoGet<T>(url: string): Promise<T> {
    const token = await adoAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
        });
        if (!res.ok)
            throw new Error(
                `ADO GET ${res.status} ${res.statusText} for ${url}`,
            );
        return (await res.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

function orgBase(orgSlug: string, project: string): string {
    return `https://dev.azure.com/${orgSlug}/${encodeURIComponent(project)}/_apis`;
}

// Classify a timeline stage as a dev/ppe/prod deploy. A stage matches an env when
// its name contains an `include` keyword AND a `require` keyword, and none of the
// `exclude` keywords — targeting the rollout stage (e.g. "Prod Ev2 Deploy") and
// skipping gates like "Prod Pre-Deploy Validation" or "Prod Apply Tag".
const ENV_MATCHERS: Record<
    "dev" | "ppe" | "prod",
    { include: string[]; require: string[]; exclude: string[] }
> = {
    dev: {
        include: ["dev"],
        require: ["deploy", "release"],
        exclude: ["pre-deploy", "validation", "apply tag", "tag", "buddy"],
    },
    ppe: {
        include: ["ppe"],
        require: ["deploy", "release"],
        exclude: ["pre-deploy", "validation", "apply tag", "tag"],
    },
    prod: {
        include: ["prod"],
        require: ["deploy", "release"],
        exclude: ["pre-deploy", "validation", "apply tag", "tag"],
    },
};

function matchEnvStage(
    name: string,
    m: { include: string[]; require: string[]; exclude: string[] },
): boolean {
    const n = (name || "").toLowerCase();
    if (!m.include.some((k) => n.includes(k))) return false;
    if (m.require.length && !m.require.some((k) => n.includes(k))) return false;
    if (m.exclude.some((k) => n.includes(k))) return false;
    return true;
}

const SUCCESSISH = new Set([
    "succeeded",
    "succeededwithissues",
    "partiallysucceeded",
]);

interface RawBuild {
    id: number;
    buildNumber?: string;
    sourceVersion?: string;
}

interface RawTimelineRecord {
    type?: string;
    name?: string;
    state?: string;
    result?: string;
    finishTime?: string;
}

// Find the build whose sourceVersion equals the merge commit. Bounded by TIME
// (builds queued from shortly before the merge), not a fixed count, so it works
// regardless of how busy the repo is — the merge's CI build queues right at the
// merge, so it's among the first few after `minTime`.
async function buildForCommit(
    orgSlug: string,
    project: string,
    defId: number,
    commit: string,
    mergedAtMs: number,
): Promise<RawBuild | null> {
    const minTime = new Date(mergedAtMs - 24 * 60 * 60 * 1000).toISOString(); // 1d buffer before the merge time
    const params = new URLSearchParams({
        "api-version": "7.1",
        definitions: String(defId),
        minTime,
        maxBuildsPerDefinition: "75",
        queryOrder: "queueTimeAscending",
    });
    const { value } = await adoGet<{ value?: RawBuild[] }>(
        `${orgBase(orgSlug, project)}/build/builds?${params}`,
    );
    return (value ?? []).find((b) => b.sourceVersion === commit) ?? null;
}

async function stagesFor(
    orgSlug: string,
    project: string,
    buildId: number,
): Promise<RawTimelineRecord[]> {
    const { records } = await adoGet<{ records?: RawTimelineRecord[] }>(
        `${orgBase(orgSlug, project)}/build/builds/${buildId}/timeline?api-version=7.1`,
    );
    return (records ?? []).filter((r) => r.type === "Stage");
}

function envState(
    stages: RawTimelineRecord[],
    env: "dev" | "ppe" | "prod",
): DeployEnv | null {
    const st = stages.find((s) =>
        matchEnvStage(s.name ?? "", ENV_MATCHERS[env]),
    );
    if (!st) return null;
    return {
        state: st.state ?? null,
        result: st.result ?? null,
        finishedAt: st.finishTime ?? null,
    };
}

// Resolve where a merged PR's build has deployed. Returns found=false when the
// repo has no configured pipeline or no build matches the merge commit.
export async function resolveDeploy(
    orgSlug: string,
    project: string,
    repoPipelines: Record<string, number>,
    repo: string,
    mergeCommit: string,
    mergedAtMs: number,
): Promise<PrDeploy> {
    const empty: PrDeploy = {
        found: false,
        reason: null,
        buildId: null,
        buildNumber: null,
        buildUrl: null,
        dev: null,
        ppe: null,
        prod: null,
        terminal: false,
    };
    const defId = repoPipelines[repo];
    // No pipeline configured for this repo: terminal so we cache it and stop
    // re-resolving.
    if (!defId) return { ...empty, reason: "no-pipeline", terminal: true };
    const build = await buildForCommit(
        orgSlug,
        project,
        defId,
        mergeCommit,
        mergedAtMs,
    );
    if (!build) {
        // No build matched. If the merge is recent, the CI build may not exist yet —
        // retry. If it's older than an hour, give up (terminal) so it stops churning.
        const stale = Date.now() - mergedAtMs > 60 * 60 * 1000;
        return { ...empty, reason: stale ? "no-build" : null, terminal: stale };
    }
    const stages = await stagesFor(orgSlug, project, build.id);
    const dev = envState(stages, "dev");
    const ppe = envState(stages, "ppe");
    const prod = envState(stages, "prod");
    const prodDone =
        !!prod &&
        (prod.state === "completed" ||
            SUCCESSISH.has((prod.result ?? "").toLowerCase()));
    return {
        found: true,
        reason: null,
        buildId: build.id,
        buildNumber: build.buildNumber ?? null,
        buildUrl: `https://dev.azure.com/${orgSlug}/${encodeURIComponent(project)}/_build/results?buildId=${build.id}&view=results`,
        dev,
        ppe,
        prod,
        terminal: prodDone,
    };
}
