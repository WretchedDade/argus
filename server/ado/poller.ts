import { ArgusStore } from "../db.ts";
import type { ArgusConfig } from "../config.ts";
import type { ArchivableSession, PrRole } from "../types.ts";
import { listActivePrs, showPr, whoami, AdoError, fetchPrThreads, prChangedFileCount } from "./client.ts";
import { classifyOwnership } from "./ownership.ts";
import { normalizePr } from "./normalize.ts";
import { fetchAuthorMeta } from "./authorMeta.ts";
import { resolveDeploy } from "./pipelines.ts";
import { reconcile } from "./reconcile.ts";
import type { CurrentPr } from "./types.ts";

export interface PollerContext {
  store: ArgusStore;
  getConfig: () => ArgusConfig; // read live so Settings changes apply next cycle
}

export interface ReconcileSummary {
  mine: number;
  tracked: number;
  added: number;
  updated: number;
  events: number;
  closed: number;
}

export interface PollerStatus {
  me: string | null;
  authOk: boolean;
  running: boolean;
  currentRunId: number | null;
  lastRunAt: string | null;
  lastSummary: ReconcileSummary | null;
  lastError: string | null;
}

let me: string | null = null; // identity used on the last run (for status)
let whoamiCache: string | null = null; // cached az identity (when no override set)
let authOk = true;
let inFlight: Promise<ReconcileSummary | null> | null = null;
let currentRunId: number | null = null;
let lastRunAt: string | null = null;
let lastSummary: ReconcileSummary | null = null;
let lastError: string | null = null;
let timer: NodeJS.Timeout | null = null;

export function getPollerStatus(): PollerStatus {
  return { me, authOk, running: !!inFlight, currentRunId, lastRunAt, lastSummary, lastError };
}

// Single-flight: a manual refresh and the timer never run concurrently; callers
// share the in-progress run.
export function reconcileOnce(ctx: PollerContext): Promise<ReconcileSummary | null> {
  if (inFlight) return inFlight;
  inFlight = runReconcile(ctx).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runReconcile(ctx: PollerContext): Promise<ReconcileSummary | null> {
  const cfg = ctx.getConfig();
  const runId = ctx.store.startPollRun();
  currentRunId = runId;
  const note = (level: string, msg: string, data?: Record<string, unknown>) =>
    ctx.store.recordActivity(level, msg, data, runId);
  try {
    note("info", "reconcile started");
    let identity = cfg.me;
    if (!identity) {
      if (!whoamiCache) {
        note("info", "resolving identity via az…");
        whoamiCache = await whoami();
      }
      identity = whoamiCache;
      // Backfill into settings so "Me" is populated after the first run.
      const overrides = ctx.store.getConfigOverrides();
      if (!overrides.me) ctx.store.saveConfigOverrides({ ...overrides, me: identity });
    }
    me = identity;
    note("info", `identity: ${identity}`);

    note("info", `listing active PRs in ${cfg.project}…`);
    const raw = await listActivePrs(cfg.orgUrl, cfg.project);
    authOk = true;
    note("info", `found ${raw?.length ?? 0} active PRs in ${cfg.project}`);

    const mine: CurrentPr[] = [];
    for (const p of raw ?? []) {
      const own = classifyOwnership(p, identity, cfg.teamPatterns);
      if (own.role) mine.push(normalizePr(p, cfg.orgSlug, cfg.project, own));
    }
    note("info", `matched ${mine.length} as mine (author, reviewer, or team)`);

    // Remember every container (team) reviewer seen, so Settings can offer them.
    const seenTeams = new Set<string>();
    for (const p of raw ?? []) {
      for (const r of p.reviewers ?? []) {
        if (r.isContainer && r.displayName) seenTeams.add(r.displayName);
      }
    }
    if (seenTeams.size) ctx.store.addSeenTeams([...seenTeams]);

    const snapshots = ctx.store.listSnapshots();
    const plan = reconcile(mine, snapshots, { recencyDays: cfg.recencyDays, nowMs: Date.now(), me: identity });
    const s = plan.stats;
    note("info", `${s.changed + s.unchanged} already tracked`, { changed: s.changed, unchanged: s.unchanged });
    if (s.newStale) note("info", `skipped ${s.newStale} untracked older than ${cfg.recencyDays}d`);
    if (s.dismissed) note("info", `skipped ${s.dismissed} dismissed`);
    if (s.newRecent) note("info", `adding ${s.newRecent} new PR(s)`);

    const applied = ctx.store.applyPlan(plan, runId);
    for (const m of mine)
      ctx.store.setOwnership(m.canonical, m.role, m.teams, m.reviewState, m.description, m.isVendor, m.otherVotes);

    // Enrich my authored PRs with ADO's completability signal + comment counts.
    const authored = mine.filter((m) => m.role === "author");
    if (authored.length) {
      note("info", `enriching ${authored.length} authored PR(s) with policy + comments`);
      for (const m of authored) ctx.store.setAuthorMeta(m.canonical, await fetchAuthorMeta(m, cfg.orgUrl));
    }
    if (applied.events) {
      note("info", `recorded ${applied.events} event(s)`, { added: applied.added, updated: applied.updated });
    }

    // Backfill authors on migrated PRs the old tracker didn't capture (bounded per
    // cycle so a single poll stays quick; drains over a few cycles).
    const needAuthor = ctx.store.prsMissingAuthor(50);
    if (needAuthor.length) {
      note("info", `backfilling author on ${needAuthor.length} migrated PR(s)`);
      for (const p of needAuthor) {
        const raw = await showPr(p.number, cfg.orgUrl);
        const name = raw?.createdBy?.displayName;
        if (name) ctx.store.setAuthor(p.canonical, name);
      }
    }

    // Backfill "my comment count" for recorded reviews that don't have it yet
    // (recorded before this existed, or an immediate count that failed).
    const needComments = ctx.store.prsNeedingCommentCount();
    if (needComments.length) {
      note("info", `counting my comments on ${needComments.length} reviewed PR(s)`);
      for (const p of needComments) {
        try {
          const threads = await fetchPrThreads(cfg.orgUrl, p.project, p.repo, p.number);
          let n = 0;
          for (const t of threads) for (const c of t.comments ?? []) if (c.commentType !== "system" && c.author?.uniqueName === identity) n++;
          ctx.store.setMyComments(p.canonical, n);
        } catch {
          /* retry next cycle */
        }
      }
    }

    // Backfill PR size (files changed) for active PRs, bounded per cycle. Cached
    // per head sha, so it only recomputes when a new commit lands.
    const needFiles = ctx.store.prsNeedingFileCount();
    if (needFiles.length) {
      note("info", `sizing ${needFiles.length} PR(s)`);
      for (const p of needFiles) {
        try {
          const count = await prChangedFileCount(cfg.orgUrl, cfg.project, p.repo, p.targetBranch, p.sourceBranch);
          if (count !== null) ctx.store.setChangedFiles(p.canonical, count, p.sha);
        } catch {
          /* retry next cycle */
        }
      }
    }

    note("info", "checking for merged/abandoned PRs…");
    const { closed } = await closeDeparted(ctx.store, cfg.orgUrl, mine.map((m) => m.canonical), snapshots, runId);
    note("info", closed ? `closed ${closed} departed PR(s)` : "no departed PRs closed");
    // Archivable sessions are computed directly from store state (closed PR +
    // linked session) in getArchivable(), so nothing to record here.

    // Deploy tracking: backfill merge commits for merged-in-window PRs that predate
    // the feature, then resolve where merged PRs have shipped (bounded per cycle;
    // terminal results are cached, non-terminal re-resolve until prod finishes).
    const deployRepos = Object.keys(cfg.repoPipelines);
    const needMerge = ctx.store.prsNeedingMergeInfo(cfg.deployWindowDays, deployRepos);
    for (const p of needMerge) {
      const raw = await showPr(p.number, cfg.orgUrl);
      if (raw?.lastMergeCommit?.commitId) ctx.store.setMergeInfo(p.canonical, raw.lastMergeCommit.commitId, raw.closedDate ?? null);
    }
    const needDeploy = ctx.store.prsNeedingDeploy(cfg.deployWindowDays, deployRepos);
    if (needDeploy.length) {
      note("info", `resolving deploys for ${needDeploy.length} merged PR(s)`);
      for (const p of needDeploy) {
        try {
          const deploy = await resolveDeploy(cfg.orgSlug, p.project, cfg.repoPipelines, p.repo, p.mergeCommit, Date.parse(p.mergedAt));
          ctx.store.setDeploy(p.canonical, deploy);
        } catch {
          /* retry next cycle */
        }
      }
    }

    const tracked = ctx.store.countTracked();
    note("info", `queue now ${tracked} tracked`);
    lastSummary = { mine: mine.length, tracked, ...applied, closed };
    lastRunAt = new Date().toISOString();
    lastError = null;
    ctx.store.finishPollRun(runId, { ok: true, ...lastSummary });
    note("info", "reconcile done", { ...lastSummary });
    ctx.store.pruneLogs(cfg.retentionDays);
    return lastSummary;
  } catch (err) {
    lastError = (err as Error).message;
    if (err instanceof AdoError) {
      authOk = false;
      whoamiCache = null; // force a fresh whoami next cycle
    }
    ctx.store.finishPollRun(runId, { ok: false, error: lastError });
    note("error", `reconcile failed: ${lastError}`);
    return null; // never throw out of a cycle
  } finally {
    currentRunId = null;
  }
}

// Tracked PRs no longer in my active list get one targeted show to catch merges
// and abandons. Terminal PRs are then frozen (state=closed excludes them). Closed
// PRs that had a linked review session are collected so their sessions can be
// archived.
async function closeDeparted(
  store: ArgusStore,
  orgUrl: string,
  mineCanonicals: string[],
  snapshots: Map<string, { state: string; dismissed: boolean }>,
  runId: number,
): Promise<{ closed: number; archivable: ArchivableSession[] }> {
  const mineSet = new Set(mineCanonicals);
  let closed = 0;
  const archivable: ArchivableSession[] = [];
  for (const [canonical, snap] of snapshots) {
    if (snap.state === "closed" || snap.dismissed || mineSet.has(canonical)) continue;
    const id = numberFromCanonical(canonical);
    const pr = id ? await showPr(id, orgUrl) : null;
    if (pr && (pr.status === "completed" || pr.status === "abandoned")) {
      const rec = store.getPr(canonical);
      store.markClosed(canonical, pr.status, undefined, runId);
      // Capture the merge commit + real merge time so the deploy tracker can pin
      // the exact build and bound the search to the actual merge moment.
      if (pr.status === "completed" && pr.lastMergeCommit?.commitId) {
        store.setMergeInfo(canonical, pr.lastMergeCommit.commitId, pr.closedDate ?? null);
      }
      closed += 1;
      if (rec?.reviewSessionId) {
        archivable.push({ repo: rec.repo, number: rec.number, status: pr.status, sessionId: rec.reviewSessionId });
      }
    }
  }
  return { closed, archivable };
}

function numberFromCanonical(canonical: string): number | null {
  const m = canonical.match(/pullrequest\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Resolve the effective identity (config override, else cached az whoami).
async function resolveIdentity(ctx: PollerContext): Promise<string> {
  const cfg = ctx.getConfig();
  if (cfg.me) return cfg.me;
  if (!whoamiCache) whoamiCache = await whoami();
  return whoamiCache;
}

// Targeted refresh of a single PR (the card Refresh action): re-fetch it from
// ADO, reclassify ownership, and update its stored metadata/state. Marks it
// closed if it has since merged or been abandoned.
export async function refreshPr(ctx: PollerContext, canonical: string): Promise<void> {
  const cfg = ctx.getConfig();
  const id = numberFromCanonical(canonical);
  if (!id) return;
  const raw = await showPr(id, cfg.orgUrl);
  if (!raw) return;
  if (raw.status === "completed" || raw.status === "abandoned") {
    ctx.store.markClosed(canonical, raw.status);
    return;
  }
  const identity = await resolveIdentity(ctx);
  const own = classifyOwnership(raw, identity, cfg.teamPatterns);
  const norm = normalizePr(raw, cfg.orgSlug, cfg.project, own);
  ctx.store.upsertPr({
    canonical: norm.canonical,
    org: norm.org,
    project: norm.project,
    repo: norm.repo,
    number: norm.number,
    title: norm.title,
    description: norm.description,
    author: norm.author,
    isVendor: norm.isVendor,
    role: norm.role,
    teams: norm.teams,
    isDraft: norm.isDraft,
    lastCommitSha: norm.sha,
    lastCommitAt: norm.createdAt,
    prCreatedAt: norm.createdAt,
    sourceBranch: norm.sourceBranch,
    targetBranch: norm.targetBranch,
  });
  ctx.store.setOwnership(canonical, own.role ?? "reviewer", own.teams, own.reviewState, norm.description, norm.isVendor, own.otherVotes);
  // `show` returns the full description (the bulk list truncates it), so store it
  // authoritatively here.
  ctx.store.setDescription(canonical, norm.description);
}

// Manually track a PR by number — the escape hatch for PRs the auto-discovery
// missed (e.g. an older PR your team was added to after the recency window).
// Fetches, classifies, and adds it only if you're actually assigned (author,
// direct reviewer, or a matched team). Returns why it couldn't add otherwise.
export async function trackByNumber(
  ctx: PollerContext,
  id: number,
): Promise<{ ok: boolean; canonical?: string; reason?: string }> {
  const cfg = ctx.getConfig();
  const raw = await showPr(id, cfg.orgUrl);
  if (!raw) return { ok: false, reason: "not-found" };
  if (raw.status === "completed" || raw.status === "abandoned") return { ok: false, reason: "closed" };
  const identity = await resolveIdentity(ctx);
  const own = classifyOwnership(raw, identity, cfg.teamPatterns);
  // A manual add is an explicit decision to track this PR even when ADO doesn't
  // list you as a reviewer yet — common for drafts (reviewers are often assigned
  // only on publish). Fall back to a reviewer role so it lands on your board
  // instead of being rejected as "not-assigned".
  const role: PrRole = own.role ?? "reviewer";
  const reviewState = own.role === null ? (own.reviewState ?? "needs") : own.reviewState;
  const effective = { ...own, role, reviewState };
  const norm = normalizePr(raw, cfg.orgSlug, cfg.project, effective);
  const existed = !!ctx.store.getPr(norm.canonical);
  ctx.store.upsertPr({
    canonical: norm.canonical,
    org: norm.org,
    project: norm.project,
    repo: norm.repo,
    number: norm.number,
    title: norm.title,
    description: norm.description,
    author: norm.author,
    isVendor: norm.isVendor,
    role: norm.role,
    teams: norm.teams,
    isDraft: norm.isDraft,
    lastCommitSha: norm.sha,
    lastCommitAt: norm.createdAt,
    prCreatedAt: norm.createdAt,
    sourceBranch: norm.sourceBranch,
    targetBranch: norm.targetBranch,
  });
  ctx.store.setOwnership(norm.canonical, effective.role, effective.teams, effective.reviewState, norm.description, norm.isVendor, effective.otherVotes);
  ctx.store.setDescription(norm.canonical, norm.description);
  if (!existed) ctx.store.appendEvent(norm.canonical, "added", { source: "manual" });
  return { ok: true, canonical: norm.canonical };
}

// --- scheduling: clock-aligned to :00/:30, work hours only ---

export function startPoller(ctx: PollerContext): void {
  scheduleNext(ctx);
}

export function stopPoller(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function scheduleNext(ctx: PollerContext): void {
  timer = setTimeout(async () => {
    try {
      if (inWorkHours(new Date(), ctx.getConfig())) await reconcileOnce(ctx);
    } catch (err) {
      // A poll cycle must never crash the process: a fatal here deregisters the
      // canvas. Record it and keep the schedule alive.
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      scheduleNext(ctx);
    }
  }, msUntilNextHalfHour());
}

// Milliseconds until the next :00 or :30 wall-clock mark, so runs are predictable.
function msUntilNextHalfHour(now: Date = new Date()): number {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(now.getMinutes() < 30 ? 30 : 60); // 60 rolls to next hour :00
  return next.getTime() - now.getTime();
}

function inWorkHours(date: Date, cfg: ArgusConfig): boolean {
  return (
    cfg.workDays.includes(date.getDay()) &&
    date.getHours() >= cfg.workStartHour &&
    date.getHours() < cfg.workEndHour
  );
}

