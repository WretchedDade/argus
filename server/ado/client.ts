import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  return IS_WIN ? [process.env.ComSpec || "cmd.exe", ["/c", "az", ...args]] : ["az", args];
}

export class AdoError extends Error {}

async function azJson<T>(args: string[]): Promise<T | null> {
  try {
    const [cmd, cmdArgs] = azCommand([...args, "-o", "json"]);
    const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
    const text = decodeAz(stdout as unknown as Buffer).trim();
    return text ? (JSON.parse(text) as T) : null;
  } catch (err) {
    throw new AdoError(`az ${args[0]} ${args[1] ?? ""} failed: ${(err as Error).message}`);
  }
}

// Identity of the logged-in user (email), used to decide PR ownership.
export async function whoami(): Promise<string> {
  const [cmd, cmdArgs] = azCommand(["account", "show", "--query", "user.name", "-o", "tsv"]);
  const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
  const me = decodeAz(stdout as unknown as Buffer).trim();
  if (!me) throw new AdoError("az not logged in (az account show returned nothing)");
  return me;
}

// One bulk call carrying sha/status/draft/votes for every active PR in the project.
export function listActivePrs(org: string, project: string): Promise<AdoRawPr[] | null> {
  return azJson<AdoRawPr[]>(["repos", "pr", "list", "--status", "active", "--org", org, "--project", project, "--top", "2000"]);
}

// Azure DevOps resource GUID; get-access-token for it yields an ADO bearer token.
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
let tokenCache: { token: string; exp: number } | null = null;

// A bearer token for ADO REST calls (used to proxy auth-gated PR attachments).
// Cached in-process until ~1 min before expiry.
export async function adoAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp - 60_000 > Date.now()) return tokenCache.token;
  const [cmd, cmdArgs] = azCommand(["account", "get-access-token", "--resource", ADO_RESOURCE, "-o", "json"]);
  const { stdout } = await pExecFile(cmd, cmdArgs, EXEC_OPTS);
  const j = JSON.parse(decodeAz(stdout as unknown as Buffer)) as { accessToken: string; expiresOn?: string };
  const exp = j.expiresOn ? Date.parse(j.expiresOn) : Date.now() + 50 * 60_000;
  tokenCache = { token: j.accessToken, exp: Number.isNaN(exp) ? Date.now() + 50 * 60_000 : exp };
  return j.accessToken;
}

// Targeted read for a PR that dropped off the active list (to catch merge/abandon).
export function showPr(id: number, org: string): Promise<AdoRawPr | null> {
  return azJson<AdoRawPr>(["repos", "pr", "show", "--id", String(id), "--org", org]);
}

// Branch-policy evaluations for a PR (min approvers, required reviewers, comment
// resolution, build) — the authoritative "is this completable" signal.
export interface PolicyEval {
  status?: string; // approved | rejected | queued | running | notApplicable
  configuration?: { isBlocking?: boolean; type?: { displayName?: string } };
}
export function listPrPolicies(org: string, id: number): Promise<PolicyEval[] | null> {
  return azJson<PolicyEval[]>(["repos", "pr", "policy", "list", "--id", String(id), "--org", org]);
}

export interface PrThread {
  status?: string; // active | fixed | wontFix | closed | byDesign | pending
  isDeleted?: boolean;
  comments?: { commentType?: string; author?: { uniqueName?: string; displayName?: string } }[];
}

// PR comment threads. Routed through `az devops invoke` (which uses the az login)
// because the bearer-token REST path returns 401 in this environment.
export function fetchPrThreads(orgUrl: string, project: string, repoId: string, prId: number): Promise<PrThread[]> {
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
