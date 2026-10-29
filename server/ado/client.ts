import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AuthStatus } from "@devstart/ado-client";
import type { AdoRawPr } from "./types.ts";

const pExecFile = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const EXEC_OPTS = { maxBuffer: MAX_BUFFER, encoding: "buffer" as const }; // raw Buffer so we control decoding

// Azure CLI on Windows emits Windows-1252 (ANSI), not UTF-8, so a lone byte like
// 0x97 (em dash) is invalid UTF-8 and renders as a replacement char. Decode as
// UTF-8 when valid, else fall back to Windows-1252 to recover smart punctuation.
function decodeAz(buf: Buffer): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder("windows-1252").decode(buf);
    }
}

// Node blocks spawning .cmd shims directly on Windows (CVE-2024-27980), so run
// `az` through cmd.exe there. argv stays separate, so no shell-quoting hazard.
const IS_WIN = process.platform === "win32";
function azCommand(args: string[]): [string, string[]] {
    return IS_WIN
        ? [process.env.ComSpec || "cmd.exe", ["/c", "az", ...args]]
        : ["az", args];
}

export class AdoError extends Error {}

// `az` is the default; the `adoAuth` setting (or ARGUS_ADO_AUTH) selects the Windows
// account broker with REST calls instead. The provider can change at runtime. The
// broker package loads lazily so `az` users never touch it.
let provider: "az" | "broker" = "az";
export const setAuthProvider = (next: "az" | "broker") => {
    provider = next;
};
export const useBroker = () => provider === "broker";

// The Entra app registration (non-secret IDs) the broker needs. Env vars win over the
// shared config file, matching the package. Saving resets the broker so it reloads.
export type AdoRegistration = { clientId: string; tenantId: string };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const registrationPath = () =>
    process.env.DEVSTART_ADO_CONFIG_PATH ??
    path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), ".devstart"),
        "devstart",
        "ado-auth-config.json",
    );

export function getRegistration(): AdoRegistration & { fromEnv: boolean } {
    let file: Partial<AdoRegistration> = {};
    try {
        file = JSON.parse(fs.readFileSync(registrationPath(), "utf8"));
    } catch {
        // no file yet
    }
    const env = process.env;
    return {
        clientId: env.DEVSTART_ADO_CLIENT_ID ?? file.clientId ?? "",
        tenantId: env.DEVSTART_ADO_TENANT_ID ?? file.tenantId ?? "",
        fromEnv: !!(env.DEVSTART_ADO_CLIENT_ID || env.DEVSTART_ADO_TENANT_ID),
    };
}

export function saveRegistration(reg: AdoRegistration): void {
    const clientId = reg.clientId?.trim();
    const tenantId = reg.tenantId?.trim();
    if (!GUID.test(clientId ?? "") || !GUID.test(tenantId ?? ""))
        throw new Error("Client ID and tenant ID must both be GUIDs.");
    const file = registrationPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ clientId, tenantId }, null, 2));
    brokerPromise = null;
}

type Broker = {
    auth: import("@devstart/ado-client").AdoAuth;
    rest: import("@devstart/ado-client").AdoRestClient;
};
let brokerPromise: Promise<Broker> | null = null;
let registrationStamp = -1;
function broker(): Promise<Broker> {
    // Another Argus host may have saved a new registration.
    let stamp = -1;
    try {
        stamp = fs.statSync(registrationPath()).mtimeMs;
    } catch {
        // no registration file
    }
    if (stamp !== registrationStamp) {
        registrationStamp = stamp;
        brokerPromise = null;
    }
    brokerPromise ??= import("@devstart/ado-client").then((m) => {
        const auth = m.createAdoAuth();
        return { auth, rest: new m.AdoRestClient(auth) };
    });
    return brokerPromise;
}

async function restJson<T>(url: string): Promise<T> {
    try {
        return await (await broker()).rest.json<T>(url);
    } catch (err) {
        throw new AdoError((err as Error).message);
    }
}

const orgRoot = (orgUrl: string) => orgUrl.replace(/\/$/, "");
const enc = encodeURIComponent;

export type AdoAuthStatus = AuthStatus & { provider: "az" | "broker" };

export async function authStatus(): Promise<AdoAuthStatus> {
    if (useBroker())
        return {
            ...(await (await broker()).auth.status()),
            provider: "broker",
        };
    try {
        const username = await whoami();
        return {
            provider: "az",
            configured: true,
            supported: true,
            state: "ready",
            interactionRequired: false,
            account: { homeAccountId: username, username, name: null },
            error: null,
        };
    } catch (err) {
        return {
            provider: "az",
            configured: true,
            supported: true,
            state: "signed-out",
            interactionRequired: true,
            account: null,
            error: (err as Error).message,
        };
    }
}

async function brokerSignIn(selectAccount: boolean): Promise<AdoAuthStatus> {
    if (!useBroker())
        throw new AdoError(
            "Sign-in is only available with ARGUS_ADO_AUTH=broker. Run `az login` instead.",
        );
    return {
        ...(await (await broker()).auth.signIn(selectAccount)),
        provider: "broker",
    };
}
export const signIn = () => brokerSignIn(false);
export const switchAccount = () => brokerSignIn(true);
export async function signOut(): Promise<AdoAuthStatus> {
    if (!useBroker())
        throw new Error("Sign-out only applies to Windows account sign-in.");
    return { ...(await (await broker()).auth.signOut()), provider: "broker" };
}

async function azJson<T>(args: string[]): Promise<T | null> {
    try {
        const [cmd, cmdArgs] = azCommand([...args, "-o", "json"]);
        const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
        const text = decodeAz(stdout as unknown as Buffer).trim();
        return text ? (JSON.parse(text) as T) : null;
    } catch (err) {
        throw new AdoError(
            `az ${args[0]} ${args[1] ?? ""} failed: ${(err as Error).message}`,
        );
    }
}

// Identity of the logged-in user (email), used to decide PR ownership.
export async function whoami(): Promise<string> {
    if (useBroker()) {
        const status = await (await broker()).auth.status();
        const username = status.account?.username;
        if (!username)
            throw new AdoError(status.error || "Sign in to Azure DevOps.");
        return username;
    }
    const [cmd, cmdArgs] = azCommand([
        "account",
        "show",
        "--query",
        "user.name",
        "-o",
        "tsv",
    ]);
    const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
    const me = decodeAz(stdout as unknown as Buffer).trim();
    if (!me)
        throw new AdoError(
            "az not logged in (az account show returned nothing)",
        );
    return me;
}

// One bulk call carrying sha/status/draft/votes for every active PR in the project.
export function listActivePrs(
    org: string,
    project: string,
): Promise<AdoRawPr[] | null> {
    if (useBroker())
        return restJson<{ value?: AdoRawPr[] }>(
            `${orgRoot(org)}/${enc(project)}/_apis/git/pullrequests?searchCriteria.status=active&$top=2000&api-version=7.1`,
        ).then((j) => j.value ?? []);
    return azJson<AdoRawPr[]>([
        "repos",
        "pr",
        "list",
        "--status",
        "active",
        "--org",
        org,
        "--project",
        project,
        "--top",
        "2000",
    ]);
}

// Azure DevOps resource GUID; get-access-token for it yields an ADO bearer token.
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
let tokenCache: { token: string; exp: number } | null = null;

// A bearer token for ADO REST calls (used to proxy auth-gated PR attachments).
// Cached in-process until ~1 min before expiry.
export async function adoAccessToken(): Promise<string> {
    if (useBroker()) return (await broker()).auth.getAccessToken();
    if (tokenCache && tokenCache.exp - 60_000 > Date.now())
        return tokenCache.token;
    const [cmd, cmdArgs] = azCommand([
        "account",
        "get-access-token",
        "--resource",
        ADO_RESOURCE,
        "-o",
        "json",
    ]);
    const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
    const j = JSON.parse(decodeAz(stdout as unknown as Buffer)) as {
        accessToken: string;
        expiresOn?: string;
    };
    const exp = j.expiresOn
        ? Date.parse(j.expiresOn)
        : Date.now() + 50 * 60_000;
    tokenCache = {
        token: j.accessToken,
        exp: Number.isNaN(exp) ? Date.now() + 50 * 60_000 : exp,
    };
    return j.accessToken;
}

interface DiffChange {
    item?: { gitObjectType?: string };
}

export function countBlobChanges(changes: DiffChange[]): number {
    return changes.filter((change) => change.item?.gitObjectType === "blob")
        .length;
}

// PR size: the number of files changed, from the branch-to-branch diff. ADO
// includes tree entries in this list, so count blobs only.
export async function prChangedFileCount(
    orgUrl: string,
    project: string,
    repo: string,
    targetBranch: string,
    sourceBranch: string,
): Promise<number | null> {
    const base = `${orgUrl.replace(/\/$/, "")}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
    const params = new URLSearchParams({
        baseVersion: targetBranch,
        baseVersionType: "branch",
        targetVersion: sourceBranch,
        targetVersionType: "branch",
        "api-version": "7.1",
        $top: "2000",
    });
    const token = await adoAccessToken();
    let count = 0;
    let skip = 0;
    while (true) {
        params.set("$skip", String(skip));
        const res = await fetch(`${base}/diffs/commits?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok)
            throw new AdoError(
                `diffs/commits ${res.status} for ${repo} ${sourceBranch}`,
            );
        const j = (await res.json()) as {
            changes?: DiffChange[];
            allChangesIncluded?: boolean;
        };
        const changes = j.changes ?? [];
        count += countBlobChanges(changes);
        if (j.allChangesIncluded) return count;
        if (changes.length === 0)
            throw new AdoError(
                `diffs/commits pagination stalled for ${repo} ${sourceBranch}`,
            );
        skip += changes.length;
    }
}

// Targeted read for a PR that dropped off the active list (to catch merge/abandon).
// Org-wide on purpose (like `az repos pr show`): the stored PR may belong to a
// project other than the currently configured one.
export function showPr(
    id: number,
    org: string,
    _project?: string,
): Promise<AdoRawPr | null> {
    if (useBroker())
        return restJson<AdoRawPr>(
            `${orgRoot(org)}/_apis/git/pullrequests/${id}?api-version=7.1`,
        );
    return azJson<AdoRawPr>([
        "repos",
        "pr",
        "show",
        "--id",
        String(id),
        "--org",
        org,
    ]);
}

// Branch-policy evaluations for a PR (min approvers, required reviewers, comment
// resolution, build) — the authoritative "is this completable" signal.
export interface PolicyEval {
    status?: string; // approved | rejected | queued | running | notApplicable
    configuration?: { isBlocking?: boolean; type?: { displayName?: string } };
}
export function listPrPolicies(
    org: string,
    _project: string,
    projectId: string,
    id: number,
): Promise<PolicyEval[] | null> {
    if (useBroker()) {
        if (!projectId)
            throw new AdoError("PR has no project id for policy lookup.");
        const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${id}`;
        return restJson<{ value?: PolicyEval[] }>(
            `${orgRoot(org)}/${enc(projectId)}/_apis/policy/evaluations?artifactId=${enc(artifactId)}&api-version=7.1-preview.1`,
        ).then((j) => j.value ?? []);
    }
    return azJson<PolicyEval[]>([
        "repos",
        "pr",
        "policy",
        "list",
        "--id",
        String(id),
        "--org",
        org,
    ]);
}

export interface PrThread {
    status?: string; // active | fixed | wontFix | closed | byDesign | pending
    isDeleted?: boolean;
    comments?: {
        commentType?: string;
        author?: { uniqueName?: string; displayName?: string };
    }[];
}

export function countReviewComments(
    threads: PrThread[],
    me: string,
): { mine: number; others: number } {
    let mine = 0;
    let others = 0;
    for (const thread of threads) {
        if (thread.isDeleted) continue;
        for (const comment of thread.comments ?? []) {
            if (comment.commentType === "system") continue;
            if (comment.author?.uniqueName === me) mine++;
            else others++;
        }
    }
    return { mine, others };
}

// PR comment threads. Routed through `az devops invoke` (which uses the az login)
// because the bearer-token REST path returns 401 in this environment.
export function fetchPrThreads(
    orgUrl: string,
    project: string,
    repoId: string,
    prId: number,
): Promise<PrThread[]> {
    if (useBroker())
        return restJson<{ value?: PrThread[] }>(
            `${orgRoot(orgUrl)}/${enc(project)}/_apis/git/repositories/${enc(repoId)}/pullRequests/${prId}/threads?api-version=7.1`,
        ).then((j) => j.value ?? []);
    return azJson<{ value?: PrThread[] }>([
        "devops",
        "invoke",
        "--area",
        "git",
        "--resource",
        "pullRequestThreads",
        "--route-parameters",
        `project=${project}`,
        `repositoryId=${repoId}`,
        `pullRequestId=${prId}`,
        "--org",
        orgUrl.replace(/\/$/, ""),
        "--api-version",
        "7.1",
    ]).then((j) => j?.value ?? []);
}
