import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
    ArchivableSession,
    ArchiveReason,
    AuthorMeta,
    AuthorMetaUpdate,
    Lane,
    Pr,
    PrReviewState,
    PrRole,
    PrState,
    PrUpsert,
    RepoScope,
} from "../types.ts";
import { ARCHIVE_REASONS, STALE_ARCHIVE_DAYS } from "../types.ts";
import type { Plan, Snapshot } from "../ado/reconcile.ts";
import { isVendorName } from "../ado/normalize.ts";
import { appendEvent } from "./events.ts";
import { prep } from "./prep.ts";
import { getSetting, setSetting } from "./settings.ts";

const b = (v: boolean): number => (v ? 1 : 0);
const AUTOMATIC_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const now = (): string => new Date().toISOString();
const ARCHIVE_REASONS_SQL = ARCHIVE_REASONS.map((r) => `'${r}'`).join(", ");

export const isAutoArchive = (reason: string | null): reason is ArchiveReason =>
    !!reason && (ARCHIVE_REASONS as readonly string[]).includes(reason);

// A dismissal the user chose. Archived PRs stay in history analysis.
export const manuallyDismissed = (p: {
    dismissed: number;
    dismissedReason: string | null;
}): boolean => !!p.dismissed && !isAutoArchive(p.dismissedReason);

// Effective scope: the per-PR override, then the repo default, then "in". An "out"
// repo default does not hide a PR you are named on (author or direct reviewer).
export function resolveOutOfScope(
    override: string | null,
    repoDefault: string | null,
    role: string | null,
): boolean {
    if (override === "in") return false;
    if (override === "out") return true;
    if (repoDefault !== "out") return false;
    return role !== "author" && role !== "reviewer";
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

export interface ListOptions {
    includeClosed?: boolean;
    includeDismissed?: boolean;
    archivedOnly?: boolean;
}

const REVIEW_COUNT_SQL = `(
  SELECT COUNT(*) FROM pr_events e
  WHERE e.canonical = p.canonical
    AND e.type = 'reviewed'
    AND json_extract(e.payload, '$.verdict') IN ('approved', 'suggestions', 'waiting', 'rejected')
)`;

const COVERED_AT_SQL = `(
  SELECT MAX(e.ts) FROM pr_events e
  WHERE e.canonical = p.canonical
    AND e.type = 'review_state'
    AND json_extract(e.payload, '$.to') = 'covered'
)`;

interface PrRow {
    canonical: string;
    org: string;
    project: string;
    repo: string;
    number: number;
    title: string;
    description: string | null;
    author: string | null;
    is_vendor: number;
    role: string | null;
    teams_json: string | null;
    required_approver_groups_json: string | null;
    review_count: number;
    covered_at: string | null;
    review_state: string | null;
    approvals_json: string | null;
    author_meta_json: string | null;
    lane: string;
    state: string;
    is_draft: number;
    dismissed: number;
    dismissed_reason: string | null;
    dismissed_at: string | null;
    out_of_scope: number;
    snoozed_until: string | null;
    snooze_mode: string | null;
    reviewed_sha: string | null;
    last_commit_sha: string | null;
    last_commit_at: string | null;
    pr_created_at: string | null;
    added_at: string;
    updated_at: string;
    review_session_id: string | null;
    changed_files: number | null;
}

function rowToPr(r: PrRow): Pr {
    return {
        canonical: r.canonical,
        org: r.org,
        project: r.project,
        repo: r.repo,
        number: r.number,
        title: r.title,
        description: r.description ?? "",
        author: r.author,
        isVendor: !!r.is_vendor,
        role: (r.role as PrRole) ?? "reviewer",
        teams: r.teams_json ? (JSON.parse(r.teams_json) as string[]) : [],
        requiredApproverGroups: r.required_approver_groups_json
            ? (JSON.parse(r.required_approver_groups_json) as string[])
            : [],
        reviewState: (r.review_state as PrReviewState) ?? null,
        otherVotes: r.approvals_json
            ? (JSON.parse(r.approvals_json) as { name: string; vote: number }[])
            : [],
        lane: r.lane as Lane,
        state: r.state as PrState,
        isDraft: !!r.is_draft,
        dismissed: !!r.dismissed,
        dismissedReason: r.dismissed_reason,
        dismissedAt: r.dismissed_at,
        outOfScope: !!r.out_of_scope,
        snoozedUntil: r.snoozed_until,
        snoozeMode: (r.snooze_mode as "time" | "fte" | null) ?? null,
        lastCommitSha: r.last_commit_sha,
        lastCommitAt: r.last_commit_at,
        prCreatedAt: r.pr_created_at,
        addedAt: r.added_at,
        updatedAt: r.updated_at,
        reviewSessionId: r.review_session_id,
        reviewedSha: r.reviewed_sha,
        reviewCount: r.review_count,
        coveredAt: r.covered_at ?? null,
        changedFiles: r.changed_files ?? null,
        authorMeta: r.author_meta_json
            ? (JSON.parse(r.author_meta_json) as AuthorMeta)
            : null,
    };
}

export function clearExpiredSnoozes(db: DatabaseSync): void {
    prep(
        db,
        "UPDATE prs SET snoozed_until = NULL, snooze_mode = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?",
    ).run(now());
}

// Insert on first sight, otherwise refresh only ADO-sourced columns. Triage
// columns (lane, state, dismissed, snooze, session, added_at) are untouched.
export function upsertPr(
    db: DatabaseSync,
    pr: PrUpsert,
    refreshActivity = true,
): void {
    const ts = now();
    prep(
        db,
        `
      INSERT INTO prs (canonical, org, project, repo, number, title, description, author,
                       is_vendor, role, teams_json, is_draft, last_commit_sha,
                       last_commit_at, pr_created_at, source_branch, target_branch, added_at, updated_at)
      VALUES ($canonical, $org, $project, $repo, $number, $title, $description, $author,
              $is_vendor, $role, $teams_json, $is_draft, $last_commit_sha,
              $last_commit_at, $pr_created_at, $source_branch, $target_branch, $ts, $ts)
      ON CONFLICT(canonical) DO UPDATE SET
        org = excluded.org, project = excluded.project, repo = excluded.repo,
        number = excluded.number, title = excluded.title,
        description = CASE
          WHEN description IS NULL OR description = '' OR length(excluded.description) >= length(description)
          THEN excluded.description ELSE description END,
        author = excluded.author,
        is_vendor = excluded.is_vendor, role = excluded.role, teams_json = excluded.teams_json,
        is_draft = excluded.is_draft,
        last_commit_sha = excluded.last_commit_sha,
        last_commit_at = CASE
          WHEN excluded.last_commit_at IS NULL AND last_commit_sha IS excluded.last_commit_sha
          THEN last_commit_at ELSE excluded.last_commit_at END,
        reviewed_sha_authored_at = CASE
          WHEN reviewed_sha IS NOT NULL AND reviewed_sha_authored_at IS NULL
            AND reviewed_sha = excluded.last_commit_sha
          THEN CASE
            WHEN excluded.last_commit_at IS NOT NULL THEN excluded.last_commit_at
            WHEN last_commit_sha IS excluded.last_commit_sha THEN last_commit_at
          END ELSE reviewed_sha_authored_at END,
        pr_created_at = excluded.pr_created_at,
        source_branch = excluded.source_branch,
        target_branch = excluded.target_branch,
        updated_at = CASE WHEN $refresh_activity THEN excluded.updated_at ELSE updated_at END
    `,
    ).run({
        $canonical: pr.canonical,
        $org: pr.org,
        $project: pr.project,
        $repo: pr.repo,
        $number: pr.number,
        $title: pr.title,
        $description: pr.description,
        $author: pr.author,
        $is_vendor: b(pr.isVendor),
        $role: pr.role,
        $teams_json: JSON.stringify(pr.teams),
        $is_draft: b(pr.isDraft),
        $last_commit_sha: pr.lastCommitSha,
        $last_commit_at: pr.lastCommitAt,
        $pr_created_at: pr.prCreatedAt,
        $source_branch: pr.sourceBranch ?? null,
        $target_branch: pr.targetBranch ?? null,
        $ts: ts,
        $refresh_activity: b(refreshActivity),
    });
}

export function getPr(db: DatabaseSync, canonical: string): Pr | null {
    clearExpiredSnoozes(db);
    const row = prep(
        db,
        `SELECT p.*, ${REVIEW_COUNT_SQL} AS review_count, ${COVERED_AT_SQL} AS covered_at FROM prs p WHERE canonical = ?`,
    ).get(canonical) as PrRow | undefined;
    return row ? rowToPr(row) : null;
}

// Resolve a PR number to its canonical, across any state (incl. closed and
// dismissed) so search can reach historical PRs. ADO PR ids are unique within
// the org, so number alone is enough; newest wins if somehow duplicated.
export function findCanonicalByNumber(
    db: DatabaseSync,
    number: number,
): string | null {
    const row = prep(
        db,
        "SELECT canonical FROM prs WHERE number = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(number) as { canonical: string } | undefined;
    return row?.canonical ?? null;
}

export function listPrs(db: DatabaseSync, opts: ListOptions = {}): Pr[] {
    clearExpiredSnoozes(db);
    const where: string[] = [];
    if (!opts.includeClosed) where.push("state != 'closed'");
    if (opts.archivedOnly)
        where.push(
            `dismissed = 1 AND dismissed_reason IN (${ARCHIVE_REASONS_SQL})`,
        );
    else if (!opts.includeDismissed) where.push("dismissed = 0");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = prep(
        db,
        `SELECT p.*, ${REVIEW_COUNT_SQL} AS review_count, ${COVERED_AT_SQL} AS covered_at FROM prs p ${clause} ORDER BY updated_at DESC`,
    ).all() as unknown as PrRow[];
    return rows.map(rowToPr);
}

// Migrated PRs whose author the old tracker didn't capture; the poller backfills
// them from ADO a bounded batch per cycle until none remain.
// `accept` filters before the limit, so skipped rows cannot fill the batch.
export function prsMissingAuthor(
    db: DatabaseSync,
    limit = 50,
    accept: (canonical: string) => boolean = () => true,
): { canonical: string; number: number }[] {
    return (
        prep(
            db,
            "SELECT canonical, number FROM prs WHERE author IS NULL",
        ).all() as unknown as {
            canonical: string;
            number: number;
        }[]
    )
        .filter((r) => accept(r.canonical))
        .slice(0, limit);
}

// PRs whose head commit time is not known yet. The poller reads it from ADO a
// bounded batch per cycle. Pass a canonical to look at one PR only.
export function prsMissingCommitAt(
    db: DatabaseSync,
    limit = 50,
    canonical?: string,
): {
    canonical: string;
    project: string;
    repo: string;
    sha: string;
}[] {
    return prep(
        db,
        `SELECT canonical, project, repo, last_commit_sha AS sha FROM prs
       WHERE last_commit_at IS NULL AND last_commit_sha IS NOT NULL
         AND state != 'closed' AND (? IS NULL OR canonical = ?)
       LIMIT ?`,
    ).all(canonical ?? null, canonical ?? null, limit) as unknown as {
        canonical: string;
        project: string;
        repo: string;
        sha: string;
    }[];
}

// Store the real commit time for a head sha. Ignored if the head moved on.
export function setLastCommitAt(
    db: DatabaseSync,
    canonical: string,
    sha: string,
    at: string,
): void {
    prep(
        db,
        "UPDATE prs SET last_commit_at = ? WHERE canonical = ? AND last_commit_sha = ?",
    ).run(at, canonical, sha);
    prep(
        db,
        `UPDATE prs SET reviewed_sha_authored_at = ?
       WHERE canonical = ? AND reviewed_sha = ? AND reviewed_sha_authored_at IS NULL`,
    ).run(at, canonical, sha);
}

export function setAuthor(
    db: DatabaseSync,
    canonical: string,
    author: string,
): void {
    prep(db, "UPDATE prs SET author = ? WHERE canonical = ?").run(
        author,
        canonical,
    );
}

// PRs you've voted on (terminal verdict, not your own) whose "my comment count"
// hasn't been counted yet — drives the one-time backfill and go-forward counts.
export function prsNeedingCommentCount(
    db: DatabaseSync,
    limit = 25,
): { canonical: string; number: number; project: string; repo: string }[] {
    return prep(
        db,
        `SELECT canonical, number, project, repo FROM prs
       WHERE (my_comments IS NULL OR other_comments IS NULL) AND (role IS NULL OR role != 'author')
         AND EXISTS (
           SELECT 1 FROM pr_events e
           WHERE e.canonical = prs.canonical AND e.type = 'reviewed'
             AND json_extract(e.payload, '$.verdict') IS NOT NULL
         )
       LIMIT ?`,
    ).all(limit) as unknown as {
        canonical: string;
        number: number;
        project: string;
        repo: string;
    }[];
}

export function setCommentCounts(
    db: DatabaseSync,
    canonical: string,
    mine: number,
    others: number,
): void {
    prep(
        db,
        "UPDATE prs SET my_comments = ?, other_comments = ? WHERE canonical = ?",
    ).run(mine, others, canonical);
}

// Active board PRs whose file count is missing or stale (a new commit landed
// since it was counted). New PRs bypass the bounded historical backfill.
export function prsNeedingFileCount(
    db: DatabaseSync,
    limit = 20,
    newPrs: ReadonlySet<string> = new Set(),
): {
    canonical: string;
    repo: string;
    sourceBranch: string;
    targetBranch: string;
    sha: string | null;
}[] {
    const rows = prep(
        db,
        `
      SELECT canonical, repo, source_branch AS sourceBranch, target_branch AS targetBranch, last_commit_sha AS sha
      FROM prs
      WHERE state != 'closed' AND dismissed = 0 AND out_of_scope = 0
        AND source_branch IS NOT NULL AND target_branch IS NOT NULL
        AND (changed_files IS NULL OR changed_files_sha IS NOT last_commit_sha)
    `,
    ).all() as unknown as {
        canonical: string;
        repo: string;
        sourceBranch: string;
        targetBranch: string;
        sha: string | null;
    }[];
    return [
        ...rows.filter((pr) => newPrs.has(pr.canonical)),
        ...rows.filter((pr) => !newPrs.has(pr.canonical)).slice(0, limit),
    ];
}

export function setChangedFiles(
    db: DatabaseSync,
    canonical: string,
    count: number,
    sha: string | null,
): void {
    prep(
        db,
        "UPDATE prs SET changed_files = ?, changed_files_sha = ? WHERE canonical = ?",
    ).run(count, sha, canonical);
}

// Prior state of every tracked PR, keyed by canonical, for the reconciler to
// diff against. Reviewer votes come from the snapshot column.
export function listSnapshots(db: DatabaseSync): Map<string, Snapshot> {
    const rows = prep(
        db,
        "SELECT canonical, last_commit_sha, is_draft, state, dismissed, dismissed_reason, reviewers_json FROM prs",
    ).all() as unknown as {
        canonical: string;
        last_commit_sha: string | null;
        is_draft: number;
        state: string;
        dismissed: number;
        dismissed_reason: string | null;
        reviewers_json: string | null;
    }[];
    const map = new Map<string, Snapshot>();
    for (const r of rows) {
        const archived = r.dismissed
            ? isAutoArchive(r.dismissed_reason)
                ? r.dismissed_reason
                : null
            : null;
        map.set(r.canonical, {
            sha: r.last_commit_sha,
            isDraft: !!r.is_draft,
            state: r.state as PrState,
            dismissed: !!r.dismissed && !archived,
            archived,
            votes: r.reviewers_json
                ? (JSON.parse(r.reviewers_json) as Record<string, number>)
                : {},
        });
    }
    return map;
}

// Apply a reconcile plan atomically: events, metadata, and the vote snapshot
// for every PR commit together, so a crash can't half-write a change.
export function applyPlan(
    db: DatabaseSync,
    plan: Plan,
    runId?: number,
): { added: number; updated: number; events: number } {
    let added = 0;
    let updated = 0;
    let eventCount = 0;
    // IMMEDIATE avoids SQLITE_BUSY_SNAPSHOT when another host writes first.
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const item of plan.items) {
            for (const ev of item.events) {
                appendEvent(
                    db,
                    ev.canonical,
                    ev.type,
                    ev.payload,
                    ev.ts,
                    runId,
                );
                eventCount += 1;
            }
            upsertPr(db, item.upsert, item.events.length > 0);
            if (item.revive) revive(db, item.upsert.canonical, "updated");
            setReviewers(db, item.upsert.canonical, item.votes);
            if (item.isAdd) added += 1;
            else if (item.events.length > 0) updated += 1;
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
    return { added, updated, events: eventCount };
}

// Terminal transition detected out of band (PR left the active list).
export function markClosed(
    db: DatabaseSync,
    canonical: string,
    reason: string,
    ts: string = now(),
    runId?: number,
): void {
    appendEvent(db, canonical, "closed", { reason }, ts, runId);
    prep(
        db,
        "UPDATE prs SET state = 'closed', updated_at = ? WHERE canonical = ?",
    ).run(ts, canonical);
}

function setReviewers(
    db: DatabaseSync,
    canonical: string,
    votes: Record<string, number>,
): void {
    prep(db, "UPDATE prs SET reviewers_json = ? WHERE canonical = ?").run(
        JSON.stringify(votes),
        canonical,
    );
}

// Role/teams/reviewState (and the description preview) are cheap metadata that
// can change without a signature change (a team added, a teammate voting, an
// edited description), so the poller refreshes them for every mine PR each
// cycle. No-op for canonicals not yet tracked.
export function setOwnership(
    db: DatabaseSync,
    canonical: string,
    role: PrRole,
    teams: string[],
    reviewState: PrReviewState | null,
    description: string,
    isVendor: boolean,
    otherVotes: { name: string; vote: number }[],
    requiredApproverGroups: string[],
    vendorPattern?: string,
): void {
    const prev = prep(
        db,
        "SELECT review_state AS s, description AS d FROM prs WHERE canonical = ?",
    ).get(canonical) as { s: string | null; d: string | null } | undefined;
    // Don't let a truncated bulk-list description overwrite a longer stored one.
    const keepDesc =
        prev?.d && description.length < prev.d.length ? prev.d : description;
    prep(
        db,
        "UPDATE prs SET role = ?, teams_json = ?, review_state = ?, description = ?, is_vendor = ?, approvals_json = ?, required_approver_groups_json = ? WHERE canonical = ?",
    ).run(
        role,
        JSON.stringify(teams),
        reviewState,
        keepDesc,
        isVendor ? 1 : 0,
        JSON.stringify(otherVotes),
        JSON.stringify(requiredApproverGroups),
        canonical,
    );
    // Record a timeline entry whenever my standing changes (e.g. needs → covered).
    if (prev && prev.s !== reviewState) {
        appendEvent(db, canonical, "review_state", {
            from: prev.s,
            to: reviewState,
        });
    }
    // Wake an "until FTE approves" snooze once a teammate/FTE has approved, and
    // emit a distinct signal (with the approver's name) so the bell can surface
    // "an FTE cleared this for you" unambiguously — separate from a manual clear.
    // The snooze means "hide until someone on my team has vetted this," so a
    // non-vendor (FTE) approving vote wakes it directly — NOT only the stricter
    // team "covered" state, which never applies when ADO lists me as an
    // individual reviewer (role=reviewer) so my own reviewState stays "needs".
    const row = prep(
        db,
        "SELECT snooze_mode AS m FROM prs WHERE canonical = ?",
    ).get(canonical) as { m: string | null } | undefined;
    if (row?.m === "fte") {
        // Attribute the wake to a non-vendor (FTE) approver — a vendor approval
        // doesn't cover the team's review, so it never wakes an fte-snooze.
        const by =
            otherVotes.find(
                (v) => v.vote >= 5 && !isVendorName(v.name, vendorPattern),
            )?.name ?? null;
        if (by || reviewState === "covered" || reviewState === "approved") {
            appendEvent(db, canonical, "fte_woke", { by });
            setSnooze(db, canonical, null, null);
        }
    }
}

// Mark a PR out of scope (I don't need to review it) or back in. This is a
// per-PR override of the repo default. An out-of-scope PR is archived, not
// deleted; fully reversible.
export function setOutOfScope(
    db: DatabaseSync,
    canonical: string,
    value: boolean,
): void {
    prep(db, "UPDATE prs SET scope_override = ? WHERE canonical = ?").run(
        value ? "out" : "in",
        canonical,
    );
    appendEvent(db, canonical, value ? "out_of_scope" : "in_scope");
    applyScopePolicy(db);
}

// The default scope of a repo. null removes the default. Per-PR overrides are kept.
export function setRepoScope(
    db: DatabaseSync,
    repo: string,
    scope: RepoScope | null,
): { archived: number; revived: number; kept: number } {
    if (scope) {
        prep(
            db,
            "INSERT INTO repo_scopes (repo, scope) VALUES (?, ?) ON CONFLICT(repo) DO UPDATE SET scope = excluded.scope",
        ).run(repo, scope);
    } else {
        prep(db, "DELETE FROM repo_scopes WHERE repo = ?").run(repo);
    }
    const result = applyScopePolicy(db);
    // Open PRs that stay visible in an out repo: you author them or review by name.
    const kept =
        scope === "out"
            ? (
                  prep(
                      db,
                      "SELECT COUNT(*) AS n FROM prs WHERE repo = ? AND state != 'closed' AND dismissed = 0 AND out_of_scope = 0 AND role IN ('author', 'reviewer')",
                  ).get(repo) as { n: number }
              ).n
            : 0;
    return { ...result, kept };
}

// Every repo with tracked PRs, with its default scope and PR counts.
export function listRepoScopes(db: DatabaseSync): {
    repo: string;
    scope: RepoScope | null;
    open: number;
    hidden: number;
}[] {
    const rows = prep(
        db,
        `
      SELECT p.repo AS repo, s.scope AS scope,
             SUM(CASE WHEN p.dismissed = 0 THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN p.dismissed = 1 THEN 1 ELSE 0 END) AS hidden
      FROM prs p LEFT JOIN repo_scopes s ON s.repo = p.repo
      WHERE p.state != 'closed' AND p.repo != ''
      GROUP BY p.repo
      UNION
      SELECT repo, scope, 0, 0 FROM repo_scopes
      WHERE repo NOT IN (SELECT repo FROM prs WHERE state != 'closed')
      ORDER BY repo
    `,
    ).all() as unknown as {
        repo: string;
        scope: string | null;
        open: number;
        hidden: number;
    }[];
    return rows.map((r) => ({
        repo: r.repo,
        scope: r.scope as RepoScope | null,
        open: r.open,
        hidden: r.hidden,
    }));
}

// Bring every open PR in line with the scope policy: refresh the effective
// `out_of_scope` flag, archive PRs that are now out, and revive PRs that were
// archived as out of scope and are now in. Never touches a manual dismissal.
export function applyScopePolicy(db: DatabaseSync): {
    archived: number;
    revived: number;
} {
    const defaults = new Map(
        (
            prep(
                db,
                "SELECT repo, scope FROM repo_scopes",
            ).all() as unknown as {
                repo: string;
                scope: string;
            }[]
        ).map((r) => [r.repo, r.scope]),
    );
    const rows = prep(
        db,
        `SELECT canonical, repo, role, scope_override, out_of_scope, dismissed, dismissed_reason
             FROM prs WHERE state != 'closed'`,
    ).all() as unknown as {
        canonical: string;
        repo: string;
        role: string | null;
        scope_override: string | null;
        out_of_scope: number;
        dismissed: number;
        dismissed_reason: string | null;
    }[];
    let archived = 0;
    let revived = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const r of rows) {
            const out = resolveOutOfScope(
                r.scope_override,
                defaults.get(r.repo) ?? null,
                r.role,
            );
            if (out !== !!r.out_of_scope)
                prep(
                    db,
                    "UPDATE prs SET out_of_scope = ? WHERE canonical = ?",
                ).run(b(out), r.canonical);
            if (r.dismissed && !isAutoArchive(r.dismissed_reason)) continue;
            if (out && !r.dismissed) {
                archive(db, r.canonical, "out_of_scope");
                archived += 1;
            } else if (
                !out &&
                r.dismissed &&
                r.dismissed_reason === "out_of_scope"
            ) {
                revive(db, r.canonical, "in_scope");
                revived += 1;
            }
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
    return { archived, revived };
}

function archive(
    db: DatabaseSync,
    canonical: string,
    reason: ArchiveReason,
): void {
    const ts = now();
    const info = prep(
        db,
        "UPDATE prs SET dismissed = 1, dismissed_reason = ?, dismissed_at = ? WHERE canonical = ? AND dismissed = 0",
    ).run(reason, ts, canonical);
    if (info.changes > 0)
        appendEvent(db, canonical, "archived", { reason }, ts);
}

// Clears an Argus archive only. A manual dismissal is never revived. A PR that
// was archived as stale also drops its old review session, so a fresh one starts.
function revive(db: DatabaseSync, canonical: string, because: string): void {
    const row = prep(
        db,
        "SELECT dismissed_reason AS reason FROM prs WHERE canonical = ? AND dismissed = 1",
    ).get(canonical) as { reason: string | null } | undefined;
    if (!row || !isAutoArchive(row.reason)) return;
    prep(
        db,
        `UPDATE prs SET dismissed = 0, dismissed_reason = NULL, dismissed_at = NULL${
            row.reason === "stale" ? ", review_session_id = NULL" : ""
        } WHERE canonical = ?`,
    ).run(canonical);
    appendEvent(db, canonical, "revived", { reason: row.reason, because });
}

// Manual restore from the Archived view. A restored PR stays visible even if it
// is out of scope or idle: the scope override and the revived event guard it.
export function restorePr(db: DatabaseSync, canonical: string): boolean {
    const row = prep(
        db,
        "SELECT dismissed, dismissed_reason AS reason, out_of_scope FROM prs WHERE canonical = ?",
    ).get(canonical) as
        | { dismissed: number; reason: string | null; out_of_scope: number }
        | undefined;
    if (!row?.dismissed || !isAutoArchive(row.reason)) return false;
    if (row.out_of_scope) {
        prep(
            db,
            "UPDATE prs SET scope_override = 'in', out_of_scope = 0 WHERE canonical = ?",
        ).run(canonical);
        appendEvent(db, canonical, "in_scope");
    }
    revive(db, canonical, "manual");
    // The Board reads updated_at as recency, so a restore resets it.
    prep(db, "UPDATE prs SET updated_at = ? WHERE canonical = ?").run(
        now(),
        canonical,
    );
    return true;
}

// A refresh stores the new snapshot, so the next poll cannot see the change.
// Revive a stale archive here when the head commit or draft state moved.
export function reviveStaleOnChange(
    db: DatabaseSync,
    canonical: string,
    sha: string | null,
    isDraft: boolean,
): void {
    const row = prep(
        db,
        "SELECT last_commit_sha AS sha, is_draft AS draft FROM prs WHERE canonical = ? AND dismissed = 1 AND dismissed_reason = 'stale'",
    ).get(canonical) as { sha: string | null; draft: number } | undefined;
    if (row && (row.sha !== sha || !!row.draft !== isDraft))
        revive(db, canonical, "updated");
}

export function listArchived(db: DatabaseSync): Pr[] {
    return listPrs(db, { archivedOnly: true });
}

// Open PRs with no tracked change for `days` or more. Skips snoozed PRs, PRs
// with a review session newer than the last verdict, and PRs restored within the
// window (a restore resets the clock).
export function staleCandidates(
    db: DatabaseSync,
    nowMs = Date.now(),
    days = STALE_ARCHIVE_DAYS,
): StaleCandidate[] {
    clearExpiredSnoozes(db);
    const cutoffMs = nowMs - days * 86_400_000;
    const rows = prep(
        db,
        `
      SELECT p.canonical, p.repo, p.number, p.title, p.author, p.updated_at AS updatedAt
      FROM prs p
      WHERE p.state != 'closed' AND p.dismissed = 0
        AND p.snoozed_until IS NULL AND p.snooze_mode IS NULL
        AND (p.review_session_id IS NULL OR (
          p.reviewed_at IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pr_events r
            WHERE r.canonical = p.canonical AND r.type = 'reviewed'
              AND json_extract(r.payload, '$.sessionId') IS NOT NULL
              AND json_extract(r.payload, '$.verdict') IS NULL
              AND r.id > COALESCE((
                SELECT MAX(v.id) FROM pr_events v
                WHERE v.canonical = p.canonical AND v.type = 'reviewed'
                  AND json_extract(v.payload, '$.verdict') IS NOT NULL
              ), 0)
          )
        ))
        AND NOT EXISTS (
          SELECT 1 FROM pr_events e
          WHERE e.canonical = p.canonical AND e.type = 'revived' AND e.ts > ?
        )
    `,
    ).all(new Date(cutoffMs).toISOString()) as unknown as {
        canonical: string;
        repo: string;
        number: number;
        title: string;
        author: string | null;
        updatedAt: string;
    }[];
    return rows
        .filter((r) => Date.parse(r.updatedAt) <= cutoffMs)
        .map((r) => ({
            ...r,
            idleDays: Math.floor(
                (nowMs - Date.parse(r.updatedAt)) / 86_400_000,
            ),
        }))
        .sort((a, c) => c.idleDays - a.idleDays);
}

// Archive stale PRs. Pass canonicals to limit the sweep to a reviewed preview.
export function archiveStale(
    db: DatabaseSync,
    only?: readonly string[],
    nowMs = Date.now(),
): number {
    const allowed = only ? new Set(only) : null;
    let count = 0;
    for (const c of staleCandidates(db, nowMs)) {
        if (allowed && !allowed.has(c.canonical)) continue;
        archive(db, c.canonical, "stale");
        count += 1;
    }
    return count;
}

// The first stale sweep waits for the user's approval of a preview. After
// that, the poller sweeps on its own.
export function isStaleSweepApproved(db: DatabaseSync): boolean {
    return getSetting(db, "stale_sweep_approved") === "1";
}

export function approveStaleSweep(db: DatabaseSync): void {
    setSetting(db, "stale_sweep_approved", "1");
}

// Migrated PRs may carry a repository GUID instead of its name.
export function prsWithRepoId(
    db: DatabaseSync,
    limit = 50,
    accept: (canonical: string) => boolean = () => true,
): { canonical: string; number: number }[] {
    return (
        prep(
            db,
            `SELECT canonical, number FROM prs
             WHERE state != 'closed'
               AND repo GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*'`,
        ).all() as unknown as { canonical: string; number: number }[]
    )
        .filter((r) => accept(r.canonical))
        .slice(0, limit);
}

export function setRepo(
    db: DatabaseSync,
    canonical: string,
    repo: string,
): void {
    prep(db, "UPDATE prs SET repo = ? WHERE canonical = ?").run(
        repo,
        canonical,
    );
    applyScopePolicy(db);
}

// Move a PR between the quick and full-review lanes (manual triage).
export function setLane(db: DatabaseSync, canonical: string, lane: Lane): void {
    prep(db, "UPDATE prs SET lane = ? WHERE canonical = ?").run(
        lane,
        canonical,
    );
    appendEvent(db, canonical, "lane_changed", { lane });
}

// Authoritative description write (from `az pr show`, which returns full text,
// unlike the bulk list). Bypasses the anti-truncation guard used elsewhere.
export function setDescription(
    db: DatabaseSync,
    canonical: string,
    description: string,
): void {
    prep(db, "UPDATE prs SET description = ? WHERE canonical = ?").run(
        description,
        canonical,
    );
}

// Link the child session that reviewed this PR, so a later re-review can target
// it. Cleared by passing null.
export function setReviewSession(
    db: DatabaseSync,
    canonical: string,
    sessionId: string | null,
): void {
    prep(db, "UPDATE prs SET review_session_id = ? WHERE canonical = ?").run(
        sessionId,
        canonical,
    );
    appendEvent(
        db,
        canonical,
        "reviewed",
        sessionId ? { sessionId } : { cleared: true },
    );
}

// Fully untrack a PR: delete its row and event history. Used to undo an
// erroneous add / let the user drop a PR that shouldn't be on the board. Unlike
// dismiss (which keeps a tombstone so it never resurrects), remove is a clean
// delete — auto-discovery may re-add it later if it genuinely qualifies.
export function removePr(db: DatabaseSync, canonical: string): void {
    prep(db, "DELETE FROM pr_events WHERE canonical = ?").run(canonical);
    prep(db, "DELETE FROM prs WHERE canonical = ?").run(canonical);
}

// Issue a one-time token for an automatic review. Overlapping reviews of one
// PR each keep their own token.
export function issueAutomaticReviewToken(
    db: DatabaseSync,
    canonical: string,
    nowMs = Date.now(),
): string {
    const token = randomUUID();
    prep(
        db,
        "INSERT INTO automatic_review_tokens (canonical, token, issued_at) VALUES (?, ?, ?)",
    ).run(canonical, token, nowMs);
    return token;
}

// While an automatic review of a PR holds a valid token, `approved` needs one
// of those tokens. Other verdicts, and PRs with no automatic review, pass.
// Tokens expire so a crashed review cannot block approvals indefinitely.
export function checkVerdictAllowed(
    db: DatabaseSync,
    canonical: string,
    verdict: string | undefined,
    token?: string,
    nowMs = Date.now(),
): boolean {
    prep(
        db,
        "DELETE FROM automatic_review_tokens WHERE canonical = ? AND issued_at < ?",
    ).run(canonical, nowMs - AUTOMATIC_TOKEN_TTL_MS);
    const rows = prep(
        db,
        "SELECT token FROM automatic_review_tokens WHERE canonical = ?",
    ).all(canonical) as { token: string }[];
    if (rows.length === 0) return true;
    if (token && rows.some((r) => r.token === token)) {
        if (!verdict) return true;
        // Another host can consume the token first; only one delete wins.
        const { changes } = prep(
            db,
            "DELETE FROM automatic_review_tokens WHERE canonical = ? AND token = ?",
        ).run(canonical, token);
        if (Number(changes) === 1) return true;
    }
    return verdict !== "approved";
}

// Remove one token, for a dispatch that failed before the review started.
export function revokeAutomaticReviewToken(
    db: DatabaseSync,
    canonical: string,
    token: string,
): void {
    prep(
        db,
        "DELETE FROM automatic_review_tokens WHERE canonical = ? AND token = ?",
    ).run(canonical, token);
}

// Explicitly record a review outcome: the verdict, the commit reviewed (for
// re-push detection), and optionally the session that did it. The verdict is
// reflected into review_state immediately so the board collapses without
// waiting for the next ADO poll (which then reconciles the same value).
export function recordReview(
    db: DatabaseSync,
    canonical: string,
    opts: { verdict?: string; sha?: string; sessionId?: string },
): void {
    if (opts.sessionId)
        prep(
            db,
            "UPDATE prs SET review_session_id = ? WHERE canonical = ?",
        ).run(opts.sessionId, canonical);
    if (opts.sha) {
        prep(db, "UPDATE prs SET reviewed_sha = ? WHERE canonical = ?").run(
            opts.sha,
            canonical,
        );
        // The reviewed sha is normally the head we last saw, so its authored date is
        // last_commit_at (from the az PR list) — capture it now, no REST needed. If a
        // re-push means the sha differs, leave it null (a later poll can't recover it).
        prep(
            db,
            `
        UPDATE prs
        SET reviewed_sha_authored_at = CASE WHEN reviewed_sha = last_commit_sha THEN last_commit_at ELSE NULL END
        WHERE canonical = ?
      `,
        ).run(canonical);
    }
    const VERDICT_STATES = new Set([
        "approved",
        "suggestions",
        "waiting",
        "rejected",
    ]);
    if (opts.verdict && VERDICT_STATES.has(opts.verdict)) {
        prep(db, "UPDATE prs SET reviewed_at = ? WHERE canonical = ?").run(
            now(),
            canonical,
        );
        // Mark my comment count stale so the poller recounts once (comments are
        // effectively final at verdict time; a re-review re-triggers the count).
        prep(
            db,
            "UPDATE prs SET my_comments = NULL, other_comments = NULL WHERE canonical = ?",
        ).run(canonical);
        const prev = prep(
            db,
            "SELECT review_state AS s FROM prs WHERE canonical = ?",
        ).get(canonical) as { s: string | null } | undefined;
        prep(db, "UPDATE prs SET review_state = ? WHERE canonical = ?").run(
            opts.verdict,
            canonical,
        );
        if (prev && prev.s !== opts.verdict) {
            appendEvent(db, canonical, "review_state", {
                from: prev.s,
                to: opts.verdict,
            });
        }
    }
    appendEvent(db, canonical, "reviewed", {
        verdict: opts.verdict ?? null,
        sha: opts.sha ?? null,
        sessionId: opts.sessionId ?? null,
    });
}

// Hide a PR: `until` (ISO) for a timed snooze, or mode "fte" to hide until a
// teammate/FTE approves (the poller wakes it in setOwnership). null clears it.
export function setSnooze(
    db: DatabaseSync,
    canonical: string,
    until: string | null,
    mode: "time" | "fte" | null = until ? "time" : null,
): void {
    prep(
        db,
        "UPDATE prs SET snoozed_until = ?, snooze_mode = ? WHERE canonical = ?",
    ).run(until, mode, canonical);
    appendEvent(
        db,
        canonical,
        "snoozed",
        mode ? { until, mode } : { cleared: true },
    );
}

// Store completability + comment counts for one of my authored PRs.
export function setAuthorMeta(
    db: DatabaseSync,
    canonical: string,
    update: AuthorMetaUpdate,
): void {
    const previous = getPr(db, canonical)?.authorMeta;
    const meta: AuthorMeta = {
        completable: previous?.completable ?? false,
        blockers: previous?.blockers ?? [],
        activeComments: previous?.activeComments ?? 0,
        resolvedComments: previous?.resolvedComments ?? 0,
        mergeStatus: update.mergeStatus,
        lastSuccessfulAt: {
            policies: update.policies.ok
                ? update.policies.lastSuccessfulAt
                : (previous?.lastSuccessfulAt?.policies ?? null),
            comments: update.comments.ok
                ? update.comments.lastSuccessfulAt
                : (previous?.lastSuccessfulAt?.comments ?? null),
        },
        ...(update.policies.ok ? update.policies.value : {}),
        ...(update.comments.ok ? update.comments.value : {}),
    };
    prep(db, "UPDATE prs SET author_meta_json = ? WHERE canonical = ?").run(
        JSON.stringify(meta),
        canonical,
    );
}

// Sessions ready to archive — computed directly: a closed PR (merged or
// abandoned) that still has a linked review session, OR an open PR that has
// gone stale (no activity past the recency window) with a linked session. Both
// are deterministic, so they don't depend on the poller catching a transition.
// Archiving clears the session link (see markReviewSessionsArchived), so items
// drop off — a stale PR that later wakes up gets a fresh review session, it is
// not re-flagged here. `status` distinguishes the reason ('completed'/reason
// vs 'stale') so the archive prompt reads correctly.
export function getArchivable(
    db: DatabaseSync,
    recencyDays: number,
): ArchivableSession[] {
    const staleMs = recencyDays * 86_400_000;
    const nowMs = Date.now();
    const rows = prep(
        db,
        `
      SELECT p.repo AS repo, p.number AS number, p.review_session_id AS sessionId,
        p.state AS state, p.updated_at AS updatedAt,
        (SELECT json_extract(e.payload, '$.reason') FROM pr_events e
         WHERE e.canonical = p.canonical AND e.type = 'closed'
         ORDER BY e.ts DESC LIMIT 1) AS closeReason
      FROM prs p
      WHERE p.review_session_id IS NOT NULL AND (p.dismissed = 0 OR p.dismissed_reason IN (${ARCHIVE_REASONS_SQL}))
      ORDER BY p.updated_at DESC
    `,
    ).all() as unknown as {
        repo: string;
        number: number;
        sessionId: string;
        state: string;
        updatedAt: string;
        closeReason: string | null;
    }[];
    // Staleness is decided in JS with Date.parse (updated_at is stored in a
    // locale format that is not lexicographically sortable), matching the rest
    // of the store. Closed PRs are always archivable; open PRs only once idle
    // past the recency window.
    return rows
        .filter(
            (r) =>
                r.state === "closed" ||
                nowMs - Date.parse(r.updatedAt) > staleMs,
        )
        .map((r) => ({
            repo: r.repo,
            number: r.number,
            sessionId: r.sessionId,
            status:
                r.state === "closed" ? (r.closeReason ?? "completed") : "stale",
        }));
}

// Drop the review-session link on PRs whose sessions were just archived, so
// they leave the archivable list. Keyed by sessionId (what the banner acts on).
export function markReviewSessionsArchived(
    db: DatabaseSync,
    sessionIds: string[],
): void {
    if (sessionIds.length === 0) return;
    const placeholders = sessionIds.map(() => "?").join(",");
    prep(
        db,
        `UPDATE prs SET review_session_id = NULL WHERE review_session_id IN (${placeholders})`,
    ).run(...sessionIds);
}
