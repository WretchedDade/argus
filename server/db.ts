import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
    ActivityEntry,
    ActivityEvent,
    ArchivableSession,
    AuthorMeta,
    Insights,
    InsightsCount,
    InsightsLoadBucket,
    InsightsWaiting,
    Lane,
    LoadDayPr,
    LoadDetail,
    Pr,
    PrEvent,
    PrEventType,
    PrReviewState,
    PrRole,
    PrUpsert,
    RepoScope,
    RunEvent,
    WeeklyReviewEffort,
    WeeklyReviewFacts,
} from "./types.ts";
import { STALE_ARCHIVE_DAYS } from "./types.ts";
import type { Plan, Snapshot } from "./ado/reconcile.ts";
import type { ConfigOverrides } from "./config.ts";
import { runMigrations } from "./store/migrations.ts";
import { prep } from "./store/prep.ts";
import * as activity from "./store/activity.ts";
import * as events from "./store/events.ts";
import type { PollRun, PollRunResult } from "./store/activity.ts";
import * as prs from "./store/prs.ts";
import { manuallyDismissed } from "./store/prs.ts";
import * as settings from "./store/settings.ts";

// Operational log rows returned to the activity/runs routes.
export type { ActivityEntry };

export type { PollRun, PollRunResult } from "./store/activity.ts";

export {
    resolveOutOfScope,
    type ListOptions,
    type StaleCandidate,
} from "./store/prs.ts";

const HOUR_MS = 3_600_000;
const WEEK_MS = 604_800_000;

// Median of an unsorted numeric list (null when empty).
function median(xs: number[]): number | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, c) => a - c);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank percentile (null when empty).
function percentile(xs: number[], p: number): number | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, c) => a - c);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ISO date (YYYY-MM-DD) of the Monday starting the week that contains `ms`.
function weekKey(ms: number): string {
    const d = new Date(ms);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}

function localDayKey(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The last `n` week-start keys, oldest first, ending with the current week.
function recentWeeks(n: number): string[] {
    const start = weekKey(Date.now());
    const startMs = Date.parse(start);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--)
        out.push(new Date(startMs - i * WEEK_MS).toISOString().slice(0, 10));
    return out;
}

// Heuristic author classification for the review-load breakdown. Automated bots
// are matched by name; everyone else falls back to the vendor/FTE flag. The
// pattern is intentionally conservative and can be extended as new bots appear.
const AUTOMATED_RE =
    /dependabot|renovate|\bbot\b|build service|azure pipelines|automation|\bagency\b/i;
function classifyAuthor(
    author: string | null,
    isVendor: boolean,
): "FTE" | "Vendor" | "Automated" {
    if (author && AUTOMATED_RE.test(author)) return "Automated";
    return isVendor ? "Vendor" : "FTE";
}

function weeklyReviewEffort(pr: {
    finalLane: Lane;
    changedFiles: number | null;
    totalComments: number | null;
    otherComments: number | null;
    reviewActions: number;
    updateEpisodes: number;
}): WeeklyReviewEffort | null {
    if (
        pr.changedFiles === null ||
        pr.totalComments === null ||
        pr.otherComments === null
    )
        return null;
    const size =
        pr.changedFiles <= 2
            ? 1
            : pr.changedFiles <= 5
              ? 2
              : pr.changedFiles <= 10
                ? 3
                : pr.changedFiles <= 20
                  ? 4
                  : 5;
    const updates = pr.updateEpisodes <= 1 ? 0 : pr.updateEpisodes <= 4 ? 1 : 2;
    const depth =
        (pr.finalLane === "review" ? 1 : 0) +
        (pr.totalComments === 0 ? 0 : pr.totalComments <= 2 ? 1 : 2);
    const discussion =
        pr.otherComments <= 3 ? 0 : pr.otherComments <= 10 ? 1 : 2;
    const revisits = pr.reviewActions <= 1 ? 0 : pr.reviewActions === 2 ? 1 : 2;
    return {
        score: size + updates + depth + discussion + revisits,
        size,
        updates,
        depth,
        discussion,
        revisits,
    };
}

export class ArgusStore {
    #db: DatabaseSync;

    constructor(file: string) {
        mkdirSync(path.dirname(file), { recursive: true });
        this.#db = new DatabaseSync(file);
        this.#db.exec("PRAGMA busy_timeout = 5000;"); // wait out transient locks (e.g. a lingering process after reload) instead of throwing SQLITE_BUSY; set before WAL so concurrent first opens wait too
        this.#enableWal();
        runMigrations(this.#db);
        this.applyScopePolicy();
        // Baseline "changes seen" to now on first run so you start caught up rather
        // than facing the entire migrated history as unseen.
        if (!this.getChangesSeenAt()) this.setChangesSeenAt();
    }

    // SQLite does not apply busy_timeout to the first switch to WAL, so retry while another process holds the lock.
    #enableWal(): void {
        for (let attempt = 0; ; attempt++) {
            try {
                this.#db.exec("PRAGMA journal_mode = WAL;");
                return;
            } catch (err) {
                if (attempt >= 50 || !/locked|busy/i.test(String(err))) {
                    throw err;
                }
                Atomics.wait(
                    new Int32Array(new SharedArrayBuffer(4)),
                    0,
                    0,
                    100,
                );
            }
        }
    }

    #prep(sql: string): StatementSync {
        return prep(this.#db, sql);
    }

    upsertPr(pr: PrUpsert): void {
        prs.upsertPr(this.#db, pr);
    }

    getPr(canonical: string): Pr | null {
        return prs.getPr(this.#db, canonical);
    }

    findCanonicalByNumber(number: number): string | null {
        return prs.findCanonicalByNumber(this.#db, number);
    }

    listPrs(opts: prs.ListOptions = {}): Pr[] {
        return prs.listPrs(this.#db, opts);
    }

    appendEvent(
        canonical: string,
        type: PrEventType,
        payload?: Record<string, unknown>,
        ts?: string,
        runId?: number,
    ): void {
        events.appendEvent(this.#db, canonical, type, payload, ts, runId);
    }

    listEvents(canonical: string): PrEvent[] {
        return events.listEvents(this.#db, canonical);
    }

    weeklyReviewFacts(startKey: string): WeeklyReviewFacts {
        const [year, month, day] = startKey.split("-").map(Number);
        const start = new Date(year, month - 1, day);
        const end = new Date(year, month - 1, day + 7);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const endKey = localDayKey(end.getTime());
        const rows = this.#prep(
            `
      WITH verdict_reviews AS (
        SELECT canonical, ts
        FROM pr_events
        WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
      ),
      weekly AS (
        SELECT canonical, COUNT(*) AS reviewActions, MAX(ts) AS latestReviewAt
        FROM verdict_reviews
        WHERE ts >= ? AND ts < ?
        GROUP BY canonical
      ),
      lifetime AS (
        SELECT canonical, COUNT(*) AS lifetimeReviewActions
        FROM verdict_reviews
        GROUP BY canonical
      ),
      updates AS (
        SELECT canonical, COUNT(*) AS updateEpisodes
        FROM pr_events
        WHERE type = 'commit_pushed'
        GROUP BY canonical
      )
      SELECT p.canonical, p.repo, p.number, p.title, p.author, p.is_vendor AS isVendor,
             p.lane AS finalLane, p.changed_files AS changedFiles, p.my_comments AS totalComments,
             p.other_comments AS otherComments,
             w.reviewActions, l.lifetimeReviewActions, COALESCE(u.updateEpisodes, 0) AS updateEpisodes,
             w.latestReviewAt
      FROM weekly w
      JOIN prs p ON p.canonical = w.canonical
      JOIN lifetime l ON l.canonical = w.canonical
      LEFT JOIN updates u ON u.canonical = w.canonical
      ORDER BY w.latestReviewAt DESC, p.repo ASC, p.number DESC, p.canonical ASC
    `,
        ).all(startIso, endIso) as unknown as {
            canonical: string;
            repo: string;
            number: number;
            title: string;
            author: string | null;
            isVendor: number;
            finalLane: string;
            changedFiles: number | null;
            totalComments: number | null;
            otherComments: number | null;
            reviewActions: number;
            lifetimeReviewActions: number;
            updateEpisodes: number;
            latestReviewAt: string;
        }[];
        const prs = rows.map((row) => {
            const pr = {
                canonical: row.canonical,
                repo: row.repo,
                number: row.number,
                title: row.title,
                author: row.author,
                authorType: classifyAuthor(row.author, !!row.isVendor),
                reviewActions: row.reviewActions,
                lifetimeReviewActions: row.lifetimeReviewActions,
                updateEpisodes: row.updateEpisodes,
                latestReviewAt: row.latestReviewAt,
                finalLane: row.finalLane as Lane,
                changedFiles: row.changedFiles,
                totalComments: row.totalComments,
                otherComments: row.otherComments,
            };
            return { ...pr, effort: weeklyReviewEffort(pr) };
        });
        const scored = prs.flatMap((pr) =>
            pr.effort ? [pr.effort.score] : [],
        );
        return {
            startKey,
            endKey,
            actionCount: prs.reduce((total, pr) => total + pr.reviewActions, 0),
            uniquePrCount: prs.length,
            prs,
            coverage: {
                sizeKnown: prs.filter((pr) => pr.changedFiles !== null).length,
                commentsKnown: prs.filter(
                    (pr) =>
                        pr.totalComments !== null && pr.otherComments !== null,
                ).length,
                scoreKnown: scored.length,
            },
            effort: {
                total: scored.reduce((total, score) => total + score, 0),
                average: scored.length
                    ? scored.reduce((total, score) => total + score, 0) /
                      scored.length
                    : null,
            },
        };
    }

    // Windowed feed of MY PR activity (authored + reviewed), for external
    // consumers (Clio's capture pulse). Every tracked PR is mine in some role, so
    // the source is simply pr_events joined to PR identity, restricted to the
    // event types that represent real PR activity (triage-noise types are dropped)
    // and to events in [sinceMs, untilMs). Authored `added`/`closed` are relabeled
    // as authored_opened/authored_merged. Vote churn by other reviewers only
    // surfaces on PRs I authored (on PRs I review, only my own vote is "mine").
    listPrActivity(sinceMs: number, untilMs: number): ActivityEvent[] {
        return events.listPrActivity(this.#db, sinceMs, untilMs);
    }

    listRunEvents(runId: number): RunEvent[] {
        return events.listRunEvents(this.#db, runId);
    }

    listUnreadChanges(limit?: number): RunEvent[] {
        return events.listUnreadChanges(this.#db, limit);
    }

    markChangesReadForPr(canonical: string): void {
        events.markChangesReadForPr(this.#db, canonical);
    }

    markAllChangesRead(): void {
        events.markAllChangesRead(this.#db);
    }

    prsMissingAuthor(
        limit = 50,
        accept: (canonical: string) => boolean = () => true,
    ): { canonical: string; number: number }[] {
        return prs.prsMissingAuthor(this.#db, limit, accept);
    }

    prsMissingCommitAt(
        limit = 50,
        canonical?: string,
    ): {
        canonical: string;
        project: string;
        repo: string;
        sha: string;
    }[] {
        return prs.prsMissingCommitAt(this.#db, limit, canonical);
    }

    setLastCommitAt(canonical: string, sha: string, at: string): void {
        prs.setLastCommitAt(this.#db, canonical, sha, at);
    }

    setAuthor(canonical: string, author: string): void {
        prs.setAuthor(this.#db, canonical, author);
    }

    prsNeedingCommentCount(
        limit = 25,
    ): { canonical: string; number: number; project: string; repo: string }[] {
        return prs.prsNeedingCommentCount(this.#db, limit);
    }

    setCommentCounts(canonical: string, mine: number, others: number): void {
        prs.setCommentCounts(this.#db, canonical, mine, others);
    }

    prsNeedingFileCount(
        limit = 20,
        newPrs: ReadonlySet<string> = new Set(),
    ): {
        canonical: string;
        repo: string;
        sourceBranch: string;
        targetBranch: string;
        sha: string | null;
    }[] {
        return prs.prsNeedingFileCount(this.#db, limit, newPrs);
    }

    setChangedFiles(
        canonical: string,
        count: number,
        sha: string | null,
    ): void {
        prs.setChangedFiles(this.#db, canonical, count, sha);
    }

    // --- Insights: aggregate analytics computed on demand from events + PRs ---

    // Per-day breakdown for the Load & capacity drill-down: which PRs arrived,
    // which you reviewed, and which were on your plate on a given local day. The
    // bucket logic mirrors computeInsights's daily series (must stay in sync).
    loadDayDetail(
        dayKey: string,
        recencyDays: number,
        work: { endHour: number; days: number[] } = {
            endHour: 17,
            days: [1, 2, 3, 4, 5],
        },
    ): LoadDetail {
        const nowMs = Date.now();
        const staleMs = recencyDays * 86_400_000;
        const [y, m, d] = dayKey.split("-").map(Number);
        const dayStart = new Date(y, m - 1, d).getTime();
        const dayEnd = dayStart + 86_400_000;

        const rollToBusinessDay = (ms: number): number => {
            const dt = new Date(ms);
            const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            if (
                dt.getHours() >= work.endHour ||
                !work.days.includes(dt.getDay())
            )
                day.setDate(day.getDate() + 1);
            let guard = 0;
            while (!work.days.includes(day.getDay()) && guard++ < 8)
                day.setDate(day.getDate() + 1);
            return day.getTime();
        };
        const VERDICT = new Set([
            "approved",
            "suggestions",
            "waiting",
            "rejected",
        ]);
        const dayAfter = (ms: number): number => {
            const dt = new Date(ms);
            dt.setHours(0, 0, 0, 0);
            dt.setDate(dt.getDate() + 1);
            return dt.getTime();
        };

        const closedTs = new Map<string, number>();
        for (const r of this.#prep(
            "SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical",
        ).all() as unknown as { canonical: string; ts: string }[]) {
            closedTs.set(r.canonical, Date.parse(r.ts));
        }
        const prs = this.#prep(
            `
      SELECT canonical, repo, number, title, role, is_draft AS isDraft, dismissed, out_of_scope AS outOfScope,
             review_state AS reviewState, added_at AS addedAt, updated_at AS updatedAt, reviewed_at AS reviewedAt
      FROM prs
    `,
        ).all() as unknown as {
            canonical: string;
            repo: string;
            number: number;
            title: string;
            role: string | null;
            isDraft: number;
            dismissed: number;
            outOfScope: number;
            reviewState: string | null;
            addedAt: string;
            updatedAt: string;
            reviewedAt: string | null;
        }[];

        const row = (p: (typeof prs)[number]): LoadDayPr => ({
            canonical: p.canonical,
            repo: p.repo,
            number: p.number,
            title: p.title,
            state: p.reviewState,
            ageDays: Math.max(
                0,
                Math.floor((dayEnd - Date.parse(p.addedAt)) / 86_400_000),
            ),
            dayKey,
        });

        const arrived: LoadDayPr[] = [];
        const onPlate: LoadDayPr[] = [];
        for (const p of prs) {
            if (p.role === "author" || p.dismissed || p.outOfScope || p.isDraft)
                continue;
            const start = Date.parse(p.addedAt);
            if (!Number.isFinite(start)) continue;
            const rolled = rollToBusinessDay(start);
            if (rolled >= dayStart && rolled < dayEnd) arrived.push(row(p));
            const ends: number[] = [];
            const cl = closedTs.get(p.canonical);
            if (cl) ends.push(cl);
            if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
            else if (p.reviewState && VERDICT.has(p.reviewState))
                ends.push(
                    dayAfter(
                        p.reviewedAt
                            ? Date.parse(p.reviewedAt)
                            : Date.parse(p.updatedAt),
                    ),
                );
            ends.push(Date.parse(p.updatedAt) + staleMs);
            const end = ends.length ? Math.min(...ends) : nowMs;
            if (start < dayEnd && end > dayStart) onPlate.push(row(p));
        }

        const reviewed: LoadDayPr[] = [];
        for (const r of this.#prep(
            `
      SELECT e.canonical, MAX(e.ts) AS ts, p.repo, p.number, p.title, p.review_state AS reviewState, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
        AND e.ts >= ? AND e.ts < ?
      GROUP BY e.canonical
    `,
        ).all(
            new Date(dayStart).toISOString(),
            new Date(dayEnd).toISOString(),
        ) as unknown as {
            canonical: string;
            ts: string;
            repo: string;
            number: number;
            title: string;
            reviewState: string | null;
            addedAt: string;
        }[]) {
            reviewed.push({
                canonical: r.canonical,
                repo: r.repo,
                number: r.number,
                title: r.title,
                state: r.reviewState,
                ageDays: Math.max(
                    0,
                    Math.floor((dayEnd - Date.parse(r.addedAt)) / 86_400_000),
                ),
                dayKey,
            });
        }

        const byAge = (a: LoadDayPr, b: LoadDayPr) => b.ageDays - a.ageDays;
        return {
            key: dayKey,
            endKey: dayKey,
            granularity: "day",
            peakDayKey: dayKey,
            arrived: arrived.sort(byAge),
            reviewed: reviewed.sort(byAge),
            onPlate: onPlate.sort(byAge),
        };
    }

    loadWeekDetail(
        weekKey: string,
        recencyDays: number,
        work: { endHour: number; days: number[] } = {
            endHour: 17,
            days: [1, 2, 3, 4, 5],
        },
    ): LoadDetail {
        const start = new Date(`${weekKey}T00:00:00`);
        const days = Array.from({ length: 7 }, (_, i) => {
            const day = new Date(start);
            day.setDate(day.getDate() + i);
            return localDayKey(day.getTime());
        });
        const details = days.map((day) =>
            this.loadDayDetail(day, recencyDays, work),
        );
        const peak = details.reduce((best, detail) =>
            detail.onPlate.length > best.onPlate.length ? detail : best,
        );
        const weekEnd = new Date(start);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const byAge = (a: LoadDayPr, b: LoadDayPr) => b.ageDays - a.ageDays;

        const arrived = this.#prep(
            `
      SELECT canonical, repo, number, title, review_state AS reviewState, added_at AS addedAt
      FROM prs
      WHERE (role IS NULL OR role != 'author') AND dismissed = 0 AND out_of_scope = 0 AND is_draft = 0
        AND added_at >= ? AND added_at < ?
    `,
        ).all(start.toISOString(), weekEnd.toISOString()) as unknown as {
            canonical: string;
            repo: string;
            number: number;
            title: string;
            reviewState: string | null;
            addedAt: string;
        }[];
        const reviewed = this.#prep(
            `
      SELECT e.canonical, MAX(e.ts) AS ts, p.repo, p.number, p.title, p.review_state AS reviewState, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
        AND e.ts >= ? AND e.ts < ?
      GROUP BY e.canonical
    `,
        ).all(start.toISOString(), weekEnd.toISOString()) as unknown as {
            canonical: string;
            ts: string;
            repo: string;
            number: number;
            title: string;
            reviewState: string | null;
            addedAt: string;
        }[];
        const toRow = (
            p: {
                canonical: string;
                repo: string;
                number: number;
                title: string;
                reviewState: string | null;
                addedAt: string;
            },
            at: string,
        ): LoadDayPr => ({
            canonical: p.canonical,
            repo: p.repo,
            number: p.number,
            title: p.title,
            state: p.reviewState,
            ageDays: Math.max(
                0,
                Math.floor(
                    (Date.parse(at) + 86_400_000 - Date.parse(p.addedAt)) /
                        86_400_000,
                ),
            ),
            dayKey: localDayKey(Date.parse(at)),
        });

        return {
            key: weekKey,
            endKey: days[6],
            granularity: "week",
            peakDayKey: peak.key,
            arrived: arrived
                .map((p) => toRow(p, p.addedAt))
                .sort(
                    (a, b) => a.dayKey.localeCompare(b.dayKey) || byAge(a, b),
                ),
            reviewed: reviewed
                .map((p) => toRow(p, p.ts))
                .sort(
                    (a, b) => a.dayKey.localeCompare(b.dayKey) || byAge(a, b),
                ),
            onPlate: peak.onPlate,
        };
    }

    computeInsights(
        recencyDays: number,
        work: { endHour: number; days: number[] } = {
            endHour: 17,
            days: [1, 2, 3, 4, 5],
        },
    ): Insights {
        const nowMs = Date.now();
        const staleMs = recencyDays * 86_400_000;
        const weeks = recentWeeks(8);

        // Roll an arrival timestamp forward to the business day the PR could actually
        // be picked up: after-hours arrivals (>= workEndHour) and non-work-day
        // arrivals move to the next work day's start. So a Friday-evening or weekend
        // PR counts as Monday inflow instead of vanishing from the weekday view.
        const rollToBusinessDay = (ms: number): number => {
            const d = new Date(ms);
            const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            if (
                d.getHours() >= work.endHour ||
                !work.days.includes(d.getDay())
            ) {
                day.setDate(day.getDate() + 1);
            }
            let guard = 0;
            while (!work.days.includes(day.getDay()) && guard++ < 8)
                day.setDate(day.getDate() + 1);
            return day.getTime();
        };

        // Verdict reviews (one recordReview per completed review), with their PR.
        const reviewed = this.#prep(
            `
      SELECT e.canonical, e.ts, p.lane, p.added_at AS addedAt
      FROM pr_events e JOIN prs p ON e.canonical = p.canonical
      WHERE e.type = 'reviewed' AND json_extract(e.payload, '$.verdict') IS NOT NULL
      ORDER BY e.ts ASC
    `,
        ).all() as unknown as {
            canonical: string;
            ts: string;
            lane: string;
            addedAt: string;
        }[];

        // Throughput: unique PRs reviewed in each week, bucketed by final lane.
        const tpByWeek = new Map<string, Map<string, string>>();
        for (const r of reviewed) {
            const wk = weekKey(Date.parse(r.ts));
            const cell =
                tpByWeek.get(wk) ?? tpByWeek.set(wk, new Map()).get(wk)!;
            cell.set(r.canonical, r.lane);
        }

        // All PR rows, decoded once, for latency / backlog / distribution / authored.
        const prs = this.#prep(
            `
      SELECT canonical, repo, number, title, author, role, teams_json AS teamsJson, is_vendor AS isVendor,
             lane, state, is_draft AS isDraft, dismissed, dismissed_reason AS dismissedReason, out_of_scope AS outOfScope,
             snoozed_until AS snoozedUntil, snooze_mode AS snoozeMode, review_state AS reviewState,
             added_at AS addedAt, pr_created_at AS prCreatedAt, last_commit_at AS lastCommitAt,
             updated_at AS updatedAt, author_meta_json AS authorMetaJson,
             reviewed_sha AS reviewedSha, reviewed_at AS reviewedAt, reviewed_sha_authored_at AS reviewedShaAuthoredAt,
             my_comments AS myComments
      FROM prs
    `,
        ).all() as unknown as {
            canonical: string;
            repo: string;
            number: number;
            title: string;
            author: string | null;
            role: string | null;
            teamsJson: string | null;
            isVendor: number;
            lane: string;
            state: string;
            isDraft: number;
            dismissed: number;
            dismissedReason: string | null;
            outOfScope: number;
            snoozedUntil: string | null;
            snoozeMode: string | null;
            reviewState: string | null;
            addedAt: string;
            prCreatedAt: string | null;
            lastCommitAt: string | null;
            updatedAt: string;
            authorMetaJson: string | null;
            reviewedSha: string | null;
            reviewedAt: string | null;
            reviewedShaAuthoredAt: string | null;
            myComments: number | null;
        }[];

        // Latency: authored date of the reviewed sha -> when you recorded the verdict
        // (how long the finished code waited on you). Reviews whose sha date isn't
        // resolved yet count as pending, not zero.
        const latHours: number[] = [];
        const latPoints: {
            at: string;
            hours: number;
            repo: string;
            number: number;
            verdict: string | null;
        }[] = [];
        let latPending = 0;
        for (const p of prs) {
            if (!p.reviewedSha || !p.reviewedAt) continue;
            // Exclude stale open PRs: their wait time is dominated by author inactivity,
            // not your responsiveness, so they skew slowest/p90 (same stale test as the
            // rest of the store).
            if (
                p.state !== "closed" &&
                nowMs - Date.parse(p.updatedAt) > staleMs
            )
                continue;
            if (!p.reviewedShaAuthoredAt) {
                latPending++;
                continue;
            }
            const h =
                (Date.parse(p.reviewedAt) -
                    Date.parse(p.reviewedShaAuthoredAt)) /
                HOUR_MS;
            if (Number.isFinite(h) && h >= 0) {
                latHours.push(h);
                latPoints.push({
                    at: p.reviewedAt,
                    hours: h,
                    repo: p.repo,
                    number: p.number,
                    verdict: p.reviewState,
                });
            }
        }
        latPoints.sort((a, c) => Date.parse(a.at) - Date.parse(c.at));
        const latBucketDefs: [string, number, number][] = [
            ["< 12h", 0, 12],
            ["12–24h", 12, 24],
            ["1–2d", 24, 48],
            ["2–4d", 48, 96],
            ["> 4d", 96, Infinity],
        ];
        const latDistribution: InsightsCount[] = latBucketDefs.map(
            ([label]) => ({ label, count: 0 }),
        );
        for (const h of latHours) {
            const i = latBucketDefs.findIndex(
                ([, lo, hi]) => h >= lo && h < hi,
            );
            if (i >= 0) latDistribution[i].count++;
        }

        const isSnoozed = (p: {
            snoozeMode: string | null;
            snoozedUntil: string | null;
        }): boolean =>
            p.snoozeMode === "fte" ||
            (!!p.snoozedUntil && Date.parse(p.snoozedUntil) > nowMs);

        // Active review queue: PRs I (or my team) review that are still live.
        const activeReview = prs.filter(
            (p) =>
                p.role !== "author" &&
                p.state !== "closed" &&
                !p.dismissed &&
                !p.outOfScope,
        );

        // Distribution across the active queue: where my review load comes from.
        const teamCount = new Map<string, number>();
        const repoCount = new Map<string, number>();
        const authorType = { FTE: 0, Vendor: 0, Automated: 0 };
        for (const p of activeReview) {
            authorType[classifyAuthor(p.author, !!p.isVendor)]++;
            repoCount.set(p.repo, (repoCount.get(p.repo) ?? 0) + 1);
            const teams = p.teamsJson
                ? (JSON.parse(p.teamsJson) as string[])
                : [];
            if (teams.length === 0)
                teamCount.set("Direct", (teamCount.get("Direct") ?? 0) + 1);
            for (const t of teams)
                teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
        }
        const topCounts = (m: Map<string, number>): InsightsCount[] =>
            [...m.entries()]
                .map(([label, count]) => ({ label, count }))
                .sort((a, c) => c.count - a.count);

        // Review reach: raw footprint records — PRs (not yours, known author) that
        // entered your review queue, with when/who/vendor/teams. The client windows
        // and aggregates these, so the recency selector switches instantly. Excludes
        // your own PRs by name too (migrated PRs can have a null role).
        const myNames = new Set(
            prs
                .filter((p) => p.role === "author" && p.author)
                .map((p) => p.author as string),
        );
        const reachItems = prs
            .filter(
                (p) =>
                    p.role !== "author" &&
                    !manuallyDismissed(p) &&
                    !!p.author &&
                    !myNames.has(p.author),
            )
            .map((p) => ({
                at: p.addedAt,
                author: p.author as string,
                vendor: !!p.isVendor,
                repo: p.repo,
                teams: p.teamsJson ? (JSON.parse(p.teamsJson) as string[]) : [],
            }));

        // Vote pattern: how you land your final verdict, grouped by author type. Only
        // PRs you actually voted on (a terminal review_state), excluding your own.
        const VERDICTS = [
            "approved",
            "suggestions",
            "waiting",
            "rejected",
        ] as const;
        const voteByType = new Map<
            string,
            {
                approved: number;
                suggestions: number;
                waiting: number;
                rejected: number;
            }
        >();
        let voteTotal = 0;
        for (const p of prs) {
            if (
                p.role === "author" ||
                manuallyDismissed(p) ||
                !p.author ||
                myNames.has(p.author)
            )
                continue;
            const v = p.reviewState;
            if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
            const type = classifyAuthor(p.author, !!p.isVendor);
            const cell =
                voteByType.get(type) ??
                voteByType
                    .set(type, {
                        approved: 0,
                        suggestions: 0,
                        waiting: 0,
                        rejected: 0,
                    })
                    .get(type)!;
            cell[v as (typeof VERDICTS)[number]]++;
            voteTotal++;
        }
        const commentCounts: number[] = [];
        for (const p of prs) {
            if (
                p.role === "author" ||
                manuallyDismissed(p) ||
                !p.author ||
                myNames.has(p.author)
            )
                continue;
            const v = p.reviewState;
            if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
            if (p.myComments != null) commentCounts.push(p.myComments);
        }
        const avgComments = commentCounts.length
            ? commentCounts.reduce((a, b) => a + b, 0) / commentCounts.length
            : null;

        // Review depth: what your comment counts reveal beyond the average. One record
        // per voted PR that has a resolved comment count, tagged with author type,
        // repo, and review latency so the client can slice engagement several ways.
        type DepthItem = {
            comments: number;
            type: string;
            repo: string;
            latencyHours: number | null;
        };
        const depthItems: DepthItem[] = [];
        for (const p of prs) {
            if (
                p.role === "author" ||
                manuallyDismissed(p) ||
                !p.author ||
                myNames.has(p.author)
            )
                continue;
            const v = p.reviewState;
            if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
            if (p.myComments == null) continue;
            let latencyHours: number | null = null;
            if (p.reviewedAt && p.reviewedShaAuthoredAt) {
                const h =
                    (Date.parse(p.reviewedAt) -
                        Date.parse(p.reviewedShaAuthoredAt)) /
                    HOUR_MS;
                if (Number.isFinite(h) && h >= 0) latencyHours = h;
            }
            depthItems.push({
                comments: p.myComments,
                type: classifyAuthor(p.author, !!p.isVendor),
                repo: p.repo,
                latencyHours,
            });
        }
        const depthComments = depthItems.map((d) => d.comments);
        const depthTotal = depthComments.reduce((a, b) => a + b, 0);
        const depthHistDefs: [string, number, number][] = [
            ["0", 0, 1],
            ["1–2", 1, 3],
            ["3–5", 3, 6],
            ["6+", 6, Infinity],
        ];
        const depthHistogram: InsightsCount[] = depthHistDefs.map(
            ([label]) => ({ label, count: 0 }),
        );
        for (const c of depthComments) {
            const i = depthHistDefs.findIndex(
                ([, lo, hi]) => c >= lo && c < hi,
            );
            if (i >= 0) depthHistogram[i].count++;
        }
        const avgBy = (items: DepthItem[]): number | null =>
            items.length
                ? items.reduce((a, d) => a + d.comments, 0) / items.length
                : null;
        const depthByType = ["FTE", "Vendor", "Automated"]
            .map((label) => {
                const items = depthItems.filter((d) => d.type === label);
                return {
                    label,
                    avg: avgBy(items),
                    count: items.length,
                    total: items.reduce((a, d) => a + d.comments, 0),
                };
            })
            .filter((t) => t.count > 0);
        const repoGroups = new Map<string, DepthItem[]>();
        for (const d of depthItems)
            (
                repoGroups.get(d.repo) ??
                repoGroups.set(d.repo, []).get(d.repo)!
            ).push(d);
        const depthByRepo = [...repoGroups.entries()]
            .map(([label, items]) => ({
                label,
                avg: avgBy(items)!,
                count: items.length,
            }))
            .sort((a, c) => c.avg - a.avg);
        const depthLatDefs: [string, number, number][] = [
            ["< 1 day", 0, 24],
            ["1–3 days", 24, 72],
            ["> 3 days", 72, Infinity],
        ];
        const depthByLatency = depthLatDefs
            .map(([label, lo, hi]) => {
                const items = depthItems.filter(
                    (d) =>
                        d.latencyHours != null &&
                        d.latencyHours >= lo &&
                        d.latencyHours < hi,
                );
                return { label, avg: avgBy(items), count: items.length };
            })
            .filter((b) => b.count > 0);
        const zeroRate = depthComments.length
            ? depthComments.filter((c) => c === 0).length / depthComments.length
            : null;

        // Vote journey: each time you RECORDED a verdict on a PR is one "turn" — a
        // real engagement / context switch, even when the verdict repeats (you came
        // back after a re-push and re-reviewed). Recorded verdicts (`reviewed` events)
        // give the multi-turn sequence; no dedup.
        const GATE_VERDICTS = new Set(["waiting", "rejected"]); // blocking
        const seqByCanon = new Map<string, string[]>();
        for (const r of this.#db
            .prepare(
                `SELECT canonical, payload FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY canonical, ts ASC, id ASC`,
            )
            .all() as unknown as {
            canonical: string;
            payload: string | null;
        }[]) {
            if (!r.payload) continue;
            const v = (JSON.parse(r.payload) as { verdict?: string }).verdict;
            if (!v) continue;
            (
                seqByCanon.get(r.canonical) ??
                seqByCanon.set(r.canonical, []).get(r.canonical)!
            ).push(v);
        }
        // Universe = the same voted PRs as "How you vote" (a recorded verdict, not
        // your own PR), so the count lines up. PRs you recorded through Argus bring
        // their full sequence; PRs you only voted on in ADO bring a single turn from
        // their current verdict.
        const voteOutcomes = { firstPass: 0, gated: 0, held: 0 };
        const turnMap = new Map<string, number>(); // `${turn}|${verdict}` -> count
        let votePathMeasured = 0;
        for (const p of prs) {
            if (
                p.role === "author" ||
                manuallyDismissed(p) ||
                !p.author ||
                myNames.has(p.author)
            )
                continue;
            const v = p.reviewState;
            if (!v || !(VERDICTS as readonly string[]).includes(v)) continue;
            const recorded = seqByCanon.get(p.canonical);
            const turns = recorded && recorded.length ? recorded : [v];
            votePathMeasured++;
            turns.forEach((verdict, i) => {
                const key = `${i + 1}|${verdict}`;
                turnMap.set(key, (turnMap.get(key) ?? 0) + 1);
            });
            const final = turns[turns.length - 1];
            if (GATE_VERDICTS.has(final)) voteOutcomes.held++;
            else if (turns.some((x) => GATE_VERDICTS.has(x)))
                voteOutcomes.gated++;
            else voteOutcomes.firstPass++;
        }
        const votePathTurns = [...turnMap.entries()].map(([k, count]) => {
            const [turn, verdict] = k.split("|");
            return { turn: Number(turn), verdict, count };
        });

        // Review origin + team coverage over ALL tracked PRs (all-time, incl. closed
        // — the active queue is inflated by stale PRs). Origin = why a PR is on your
        // plate: directly named ("Individual") vs via a team container. For team PRs,
        // coverage = who satisfies the review — you (you voted, so role became
        // 'reviewer'), a teammate ('covered'), or nobody yet. A PR in two containers
        // counts under each, matching the existing by-team load donut.
        type CovPr = {
            number: number;
            repo: string;
            title: string;
            coverage: "me" | "teammate" | "needs";
        };
        type Cov = {
            total: number;
            me: number;
            teammate: number;
            needs: number;
            prs: CovPr[];
        };
        const originCov = new Map<string, Cov>();
        const covRank = { me: 0, teammate: 1, needs: 2 };
        const bumpCov = (
            key: string,
            cov: "me" | "teammate" | "needs",
            pr: { number: number; repo: string; title: string },
        ) => {
            const c =
                originCov.get(key) ??
                originCov
                    .set(key, {
                        total: 0,
                        me: 0,
                        teammate: 0,
                        needs: 0,
                        prs: [],
                    })
                    .get(key)!;
            c.total++;
            c[cov]++;
            c.prs.push({
                number: pr.number,
                repo: pr.repo,
                title: pr.title,
                coverage: cov,
            });
        };
        for (const p of prs) {
            if (p.role === "author" || p.dismissed || p.outOfScope) continue;
            // Drop stale open PRs — abandoned reviews that just bloat "still needs".
            if (
                p.state !== "closed" &&
                nowMs - Date.parse(p.updatedAt) > staleMs
            )
                continue;
            const teams = p.teamsJson
                ? (JSON.parse(p.teamsJson) as string[])
                : [];
            if (teams.length === 0) {
                if (p.role === "reviewer") bumpCov("Individual", "me", p);
                continue;
            }
            const cov =
                p.role === "reviewer"
                    ? "me"
                    : p.reviewState === "covered"
                      ? "teammate"
                      : "needs";
            for (const t of teams) bumpCov(t, cov, p);
        }
        const reviewCoverageOrigins = [...originCov.entries()]
            .map(([team, c]) => ({
                ...c,
                team,
                prs: [...c.prs].sort(
                    (a, b) => covRank[a.coverage] - covRank[b.coverage],
                ),
            }))
            .sort((a, b) => b.total - a.total);

        // Review rhythm / context-switching: each recorded verdict is a "pickup" — an
        // act of stopping your own work to load someone else's PR. Emitted as a flat,
        // timestamped list (repo + team + title); the client bins into days to show
        // volume, batching (clustered vs scattered), and breadth (distinct contexts).
        const prMeta = new Map<
            string,
            {
                repo: string;
                team: string | null;
                title: string;
                number: number;
                author: string | null;
                isVendor: boolean;
            }
        >();
        for (const p of prs) {
            const t = p.teamsJson
                ? ((JSON.parse(p.teamsJson) as string[])[0] ?? null)
                : null;
            prMeta.set(p.canonical, {
                repo: p.repo,
                team: t,
                title: p.title,
                number: p.number,
                author: p.author,
                isVendor: !!p.isVendor,
            });
        }
        const rhythmItems: {
            at: string;
            repo: string;
            team: string | null;
            number: number;
            title: string;
            verdict: string | null;
            author: string | null;
            isVendor: boolean;
        }[] = [];
        for (const r of this.#db
            .prepare(
                `SELECT canonical, ts, json_extract(payload, '$.verdict') AS verdict FROM pr_events
         WHERE type = 'reviewed' AND json_extract(payload, '$.verdict') IS NOT NULL
         ORDER BY ts ASC`,
            )
            .all() as unknown as {
            canonical: string;
            ts: string;
            verdict: string | null;
        }[]) {
            const m = prMeta.get(r.canonical);
            if (!m) continue;
            rhythmItems.push({
                at: r.ts,
                repo: m.repo,
                team: m.team,
                number: m.number,
                title: m.title,
                verdict: r.verdict,
                author: m.author,
                isVendor: m.isVendor,
            });
        }

        // "Waiting on you": live PRs awaiting your first vote, measured from the
        // author's last push (when the ball actually landed in your court). Stale /
        // abandoned PRs are excluded — those are the author's move, not your latency.
        const waiting = activeReview.filter(
            (p) =>
                !p.isDraft &&
                !isSnoozed(p) &&
                (p.reviewState === "needs" || p.reviewState === null) &&
                nowMs - Date.parse(p.updatedAt) <= staleMs,
        );
        const bucketDefs: [string, number, number][] = [
            ["< 1 day", 0, 24],
            ["1–3 days", 24, 72],
            ["3–7 days", 72, 168],
            ["> 7 days", 168, Infinity],
        ];
        const buckets: InsightsCount[] = bucketDefs.map(([label]) => ({
            label,
            count: 0,
        }));
        const aged = waiting.map((p) => ({
            p,
            waitingHours:
                (nowMs - Date.parse(p.lastCommitAt ?? p.addedAt)) / HOUR_MS,
        }));
        for (const { waitingHours } of aged) {
            const i = bucketDefs.findIndex(
                ([, lo, hi]) => waitingHours >= lo && waitingHours < hi,
            );
            if (i >= 0) buckets[i].count++;
        }
        const longest: InsightsWaiting[] = [...aged]
            .sort((a, c) => c.waitingHours - a.waitingHours)
            .slice(0, 5)
            .map(({ p, waitingHours }) => ({
                canonical: p.canonical,
                repo: p.repo,
                number: p.number,
                title: p.title,
                waitingHours,
            }));

        // Authored side.
        const closedTs = new Map<string, string>();
        for (const r of this.#prep(
            "SELECT canonical, MIN(ts) AS ts FROM pr_events WHERE type = 'closed' GROUP BY canonical",
        ).all() as unknown as { canonical: string; ts: string }[]) {
            closedTs.set(r.canonical, r.ts);
        }
        const authored = prs.filter((p) => p.role === "author");
        const openAuthored = authored.filter((p) => p.state !== "closed");
        const parseMeta = (j: string | null): AuthorMeta | null =>
            j ? (JSON.parse(j) as AuthorMeta) : null;
        let completable = 0;
        let blocked = 0;
        const openList: Insights["authored"]["openList"] = [];
        for (const p of openAuthored) {
            const m = parseMeta(p.authorMetaJson);
            if (m?.completable) completable++;
            else if (m && m.blockers.length > 0) blocked++;
            openList.push({
                canonical: p.canonical,
                repo: p.repo,
                number: p.number,
                title: p.title,
                activeComments: m?.activeComments ?? 0,
                blockers: m?.blockers ?? [],
                completable: m?.completable ?? false,
            });
        }
        openList.sort(
            (a, c) =>
                c.activeComments - a.activeComments ||
                c.blockers.length - a.blockers.length,
        );
        const mergeHours: number[] = [];
        for (const p of authored) {
            if (p.state !== "closed" || !p.prCreatedAt) continue;
            const end = closedTs.get(p.canonical);
            if (!end) continue;
            const h = (Date.parse(end) - Date.parse(p.prCreatedAt)) / HOUR_MS;
            if (Number.isFinite(h) && h >= 0) mergeHours.push(h);
        }

        // --- Load & capacity ---
        // "On your plate" = PRs you're on the hook for. A PR lands when it enters your
        // queue (added_at) and stays on your plate until it leaves your court:
        //   - it closes (merges / abandoned), OR
        //   - a teammate covers the team's review (you never had to), OR
        //   - you cast a verdict — it counts through that day, then leaves the next
        //     day (the ball is now in the author's court), OR
        //   - it goes stale (idle past the recency window).
        // Snoozing does NOT take it off your plate (deferred, still yours). Excluded
        // entirely: your own PRs, dismissed, out-of-scope, and drafts (not ready).
        const intervals: { start: number; end: number }[] = [];
        const inflowMs: number[] = [];
        const VERDICT_STATES = new Set([
            "approved",
            "suggestions",
            "waiting",
            "rejected",
        ]);
        // Midnight starting the day AFTER `ms` (local) — a verdicted PR counts through
        // the day you acted, then leaves your plate the next day.
        const dayAfter = (ms: number): number => {
            const d = new Date(ms);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 1);
            return d.getTime();
        };
        for (const p of prs) {
            if (p.role === "author" || p.dismissed || p.outOfScope || p.isDraft)
                continue;
            const start = Date.parse(p.addedAt);
            if (!Number.isFinite(start)) continue;
            inflowMs.push(start);
            const ends: number[] = [];
            const cl = closedTs.get(p.canonical);
            if (cl) ends.push(Date.parse(cl));
            // A teammate covered the team's review — off your plate from when it settled.
            if (p.reviewState === "covered") ends.push(Date.parse(p.updatedAt));
            // You cast a verdict (approved/suggestions/waiting/rejected): it was on your
            // plate through that day, then leaves the next day — the ball is now in the
            // author's court. Verdict day = when you recorded it, else when it settled.
            else if (p.reviewState && VERDICT_STATES.has(p.reviewState)) {
                ends.push(
                    dayAfter(
                        p.reviewedAt
                            ? Date.parse(p.reviewedAt)
                            : Date.parse(p.updatedAt),
                    ),
                );
            }
            // Stale: idle past the recency window, no longer live load.
            const staleCut = Date.parse(p.updatedAt) + staleMs;
            if (Number.isFinite(staleCut)) ends.push(staleCut);
            const end = ends.length ? Math.min(...ends) : nowMs;
            if (end > start) intervals.push({ start, end });
        }
        const DAY_MS = 86_400_000;
        const WINDOW_DAYS = 84; // 12 weeks, enough to derive both series
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const firstDayStart = todayStart.getTime() - (WINDOW_DAYS - 1) * DAY_MS;
        const dayBuckets = Array.from({ length: WINDOW_DAYS }, (_, i) => {
            const dayStart = firstDayStart + i * DAY_MS;
            const dayEnd = dayStart + DAY_MS;
            let level = 0;
            for (const iv of intervals)
                if (iv.start < dayEnd && iv.end > dayStart) level++;
            return { dayStart, level, inflow: 0, throughput: 0 };
        });
        const dayIndex = (ms: number): number =>
            Math.floor((ms - firstDayStart) / DAY_MS);
        // Raw inflow per day (used by the weekly view, which sums whole weeks — a
        // Friday-evening PR belongs to its own week there, so it must NOT roll).
        for (const ms of inflowMs) {
            const i = dayIndex(ms);
            if (i >= 0 && i < WINDOW_DAYS) dayBuckets[i].inflow++;
        }
        // Business-day-rolled inflow, used only by the daily view: after-hours /
        // weekend arrivals move to the next work day so they land on (e.g.) Monday
        // instead of vanishing from the weekday-only day chart.
        const rolledInflow = new Array<number>(WINDOW_DAYS).fill(0);
        for (const ms of inflowMs) {
            const i = dayIndex(rollToBusinessDay(ms));
            if (i >= 0 && i < WINDOW_DAYS) rolledInflow[i]++;
        }
        const dailyReviewed = new Set<string>();
        for (const review of reviewed) {
            const i = dayIndex(Date.parse(review.ts));
            const key = `${i}|${review.canonical}`;
            if (i >= 0 && i < WINDOW_DAYS && !dailyReviewed.has(key)) {
                dailyReviewed.add(key);
                dayBuckets[i].throughput++;
            }
        }
        const daily: InsightsLoadBucket[] = dayBuckets
            .slice(-14)
            .filter((d) => {
                const wd = new Date(d.dayStart).getDay();
                return wd !== 0 && wd !== 6; // drop Sunday / Saturday
            })
            .map((d) => ({
                key: new Date(d.dayStart).toISOString().slice(0, 10),
                inflow: rolledInflow[dayIndex(d.dayStart)],
                throughput: d.throughput,
                backlog: d.level,
            }));
        const loadWeeks = recentWeeks(12);
        const weeklyLoad = new Map<
            string,
            { inflow: number; throughput: number; peak: number }
        >();
        for (const d of dayBuckets) {
            const wk = weekKey(d.dayStart);
            const cell =
                weeklyLoad.get(wk) ??
                weeklyLoad
                    .set(wk, { inflow: 0, throughput: 0, peak: 0 })
                    .get(wk)!;
            cell.inflow += d.inflow;
            cell.peak = Math.max(cell.peak, d.level);
        }
        for (const [week, prsReviewed] of tpByWeek) {
            const cell = weeklyLoad.get(week);
            if (cell) cell.throughput = prsReviewed.size;
        }
        const loadWeekly: InsightsLoadBucket[] = loadWeeks.map((week) => {
            const cell = weeklyLoad.get(week) ?? {
                inflow: 0,
                throughput: 0,
                peak: 0,
            };
            return {
                key: week,
                inflow: cell.inflow,
                throughput: cell.throughput,
                backlog: cell.peak,
            };
        });
        const peakDay = dayBuckets.reduce(
            (best, d) => (d.level > best.level ? d : best),
            { dayStart: 0, level: 0, inflow: 0, throughput: 0 },
        );

        // Balance / sustainability series, derived from the daily load series
        // (weekdays only — weekends aren't work days). Per day: inflow, throughput,
        // and concurrent load (level). The client windows this and derives streaks
        // ("falling behind" = inflow > throughput; "overload" = level >= heavy line)
        // so the stats always match the visible range. Heavy line = p75 of level.
        const balanceDays = dayBuckets.filter((d) => {
            const wd = new Date(d.dayStart).getDay();
            return wd !== 0 && wd !== 6;
        });
        const sortedLevels = balanceDays
            .map((d) => d.level)
            .sort((a, b) => a - b);
        const heavyLine = sortedLevels.length
            ? Math.max(1, sortedLevels[Math.floor(sortedLevels.length * 0.75)])
            : 1;
        const balanceSeries = balanceDays.map((d) => ({
            key: new Date(d.dayStart).toISOString().slice(0, 10),
            inflow: d.inflow,
            throughput: d.throughput,
            level: d.level,
        }));

        const trackingSince =
            (
                this.#db.prepare("SELECT MIN(ts) AS t FROM pr_events").get() as
                    { t?: string } | undefined
            )?.t ?? null;

        return {
            generatedAt: new Date().toISOString(),
            summary: {
                reviewsAllTime: new Set(
                    reviewed.map((review) => review.canonical),
                ).size,
                firstReviewAt: rhythmItems.length ? rhythmItems[0].at : null,
                lastReviewAt: rhythmItems.length
                    ? rhythmItems[rhythmItems.length - 1].at
                    : null,
                trackingSince,
            },
            latency: {
                count: latHours.length,
                pending: latPending,
                medianHours: median(latHours),
                p90Hours: percentile(latHours, 90),
                fastestHours: latHours.length ? Math.min(...latHours) : null,
                slowestHours: latHours.length ? Math.max(...latHours) : null,
                points: latPoints,
                distribution: latDistribution,
            },
            throughput: {
                total: new Set(
                    reviewed
                        .filter((review) =>
                            weeks.includes(weekKey(Date.parse(review.ts))),
                        )
                        .map((review) => review.canonical),
                ).size,
                weekly: weeks.map((week) => {
                    const prsReviewed =
                        tpByWeek.get(week) ?? new Map<string, string>();
                    const quick = [...prsReviewed.values()].filter(
                        (lane) => lane === "quick",
                    ).length;
                    const review = prsReviewed.size - quick;
                    return { week, quick, review, total: prsReviewed.size };
                }),
            },
            load: {
                daily,
                weekly: loadWeekly,
                peak: {
                    count: peakDay.level,
                    at:
                        peakDay.level > 0
                            ? new Date(peakDay.dayStart)
                                  .toISOString()
                                  .slice(0, 10)
                            : null,
                },
            },
            backlog: {
                waitingCount: waiting.length,
                longestHours: aged.length
                    ? Math.max(...aged.map((a) => a.waitingHours))
                    : null,
                buckets,
                longest,
            },
            distribution: {
                byTeam: topCounts(teamCount),
                byRepo: topCounts(repoCount),
                byAuthorType: (["FTE", "Vendor", "Automated"] as const)
                    .map((label) => ({ label, count: authorType[label] }))
                    .filter((x) => x.count > 0),
            },
            reach: {
                items: reachItems,
            },
            votePattern: {
                byType: (["FTE", "Vendor", "Automated"] as const)
                    .filter((t) => voteByType.has(t))
                    .map((t) => ({ label: t, ...voteByType.get(t)! })),
                total: voteTotal,
                avgComments,
                commentsMeasured: commentCounts.length,
            },
            reviewDepth: {
                measured: depthComments.length,
                totalComments: depthTotal,
                avg: avgComments,
                median: median(depthComments),
                p90: percentile(depthComments, 90),
                zeroRate,
                histogram: depthHistogram,
                byType: depthByType,
                byRepo: depthByRepo,
                byLatency: depthByLatency,
            },
            votePath: {
                measured: votePathMeasured,
                outcomes: voteOutcomes,
                turns: votePathTurns,
            },
            reviewCoverage: {
                origins: reviewCoverageOrigins,
            },
            reviewRhythm: {
                items: rhythmItems,
            },
            balance: {
                days: balanceSeries,
                heavyLine,
            },
            authored: {
                open: openAuthored.length,
                completable,
                blocked,
                mergedCount: mergeHours.length,
                medianMergeHours: median(mergeHours),
                openList,
            },
        };
    }

    getChangesSeenAt(): string | null {
        return events.getChangesSeenAt(this.#db);
    }

    setChangesSeenAt(ts?: string): void {
        events.setChangesSeenAt(this.#db, ts);
    }

    listSnapshots(): Map<string, Snapshot> {
        return prs.listSnapshots(this.#db);
    }

    applyPlan(
        plan: Plan,
        runId?: number,
    ): { added: number; updated: number; events: number } {
        return prs.applyPlan(this.#db, plan, runId);
    }

    markClosed(
        canonical: string,
        reason: string,
        ts?: string,
        runId?: number,
    ): void {
        prs.markClosed(this.#db, canonical, reason, ts, runId);
    }

    setOwnership(
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
        prs.setOwnership(
            this.#db,
            canonical,
            role,
            teams,
            reviewState,
            description,
            isVendor,
            otherVotes,
            requiredApproverGroups,
            vendorPattern,
        );
    }

    setOutOfScope(canonical: string, value: boolean): void {
        prs.setOutOfScope(this.#db, canonical, value);
    }

    setRepoScope(
        repo: string,
        scope: RepoScope | null,
    ): { archived: number; revived: number; kept: number } {
        return prs.setRepoScope(this.#db, repo, scope);
    }

    listRepoScopes(): {
        repo: string;
        scope: RepoScope | null;
        open: number;
        hidden: number;
    }[] {
        return prs.listRepoScopes(this.#db);
    }

    applyScopePolicy(): { archived: number; revived: number } {
        return prs.applyScopePolicy(this.#db);
    }

    restorePr(canonical: string): boolean {
        return prs.restorePr(this.#db, canonical);
    }

    reviveStaleOnChange(
        canonical: string,
        sha: string | null,
        isDraft: boolean,
    ): void {
        prs.reviveStaleOnChange(this.#db, canonical, sha, isDraft);
    }

    listArchived(): Pr[] {
        return prs.listArchived(this.#db);
    }

    staleCandidates(
        nowMs = Date.now(),
        days = STALE_ARCHIVE_DAYS,
    ): prs.StaleCandidate[] {
        return prs.staleCandidates(this.#db, nowMs, days);
    }

    archiveStale(only?: readonly string[], nowMs = Date.now()): number {
        return prs.archiveStale(this.#db, only, nowMs);
    }

    isStaleSweepApproved(): boolean {
        return prs.isStaleSweepApproved(this.#db);
    }

    approveStaleSweep(): void {
        prs.approveStaleSweep(this.#db);
    }

    prsWithRepoId(
        limit = 50,
        accept: (canonical: string) => boolean = () => true,
    ): { canonical: string; number: number }[] {
        return prs.prsWithRepoId(this.#db, limit, accept);
    }

    setRepo(canonical: string, repo: string): void {
        prs.setRepo(this.#db, canonical, repo);
    }

    setLane(canonical: string, lane: Lane): void {
        prs.setLane(this.#db, canonical, lane);
    }

    setDescription(canonical: string, description: string): void {
        prs.setDescription(this.#db, canonical, description);
    }

    setReviewSession(canonical: string, sessionId: string | null): void {
        prs.setReviewSession(this.#db, canonical, sessionId);
    }

    removePr(canonical: string): void {
        prs.removePr(this.#db, canonical);
    }

    issueAutomaticReviewToken(canonical: string, nowMs = Date.now()): string {
        return prs.issueAutomaticReviewToken(this.#db, canonical, nowMs);
    }

    checkVerdictAllowed(
        canonical: string,
        verdict: string | undefined,
        token?: string,
        nowMs = Date.now(),
    ): boolean {
        return prs.checkVerdictAllowed(
            this.#db,
            canonical,
            verdict,
            token,
            nowMs,
        );
    }

    revokeAutomaticReviewToken(canonical: string, token: string): void {
        prs.revokeAutomaticReviewToken(this.#db, canonical, token);
    }

    recordReview(
        canonical: string,
        opts: { verdict?: string; sha?: string; sessionId?: string },
    ): void {
        prs.recordReview(this.#db, canonical, opts);
    }

    setSnooze(
        canonical: string,
        until: string | null,
        mode?: "time" | "fte" | null,
    ): void {
        prs.setSnooze(this.#db, canonical, until, mode);
    }

    setAuthorMeta(canonical: string, meta: AuthorMeta): void {
        prs.setAuthorMeta(this.#db, canonical, meta);
    }

    getArchivable(recencyDays: number): ArchivableSession[] {
        return prs.getArchivable(this.#db, recencyDays);
    }

    markReviewSessionsArchived(sessionIds: string[]): void {
        prs.markReviewSessionsArchived(this.#db, sessionIds);
    }

    // --- operational logging (pruned by age) ---

    startPollRun(startedAt?: string): number {
        return activity.startPollRun(this.#db, startedAt);
    }

    finishPollRun(
        runId: number,
        result: PollRunResult,
        finishedAt?: string,
    ): void {
        activity.finishPollRun(this.#db, runId, result, finishedAt);
    }

    // Size of the active queue (what the Board shows): not closed, not dismissed.
    countTracked(): number {
        const r = this.#prep(
            "SELECT COUNT(*) AS n FROM prs WHERE state != 'closed' AND dismissed = 0 AND out_of_scope = 0",
        ).get() as {
            n: number;
        };
        return r.n;
    }

    recordActivity(
        level: string,
        msg: string,
        data?: Record<string, unknown>,
        runId?: number,
    ): void {
        activity.recordActivity(this.#db, level, msg, data, runId);
    }

    listActivity(limit?: number): ActivityEntry[] {
        return activity.listActivity(this.#db, limit);
    }

    listActivityForRun(runId: number): ActivityEntry[] {
        return activity.listActivityForRun(this.#db, runId);
    }

    listPollRuns(limit?: number): PollRun[] {
        return activity.listPollRuns(this.#db, limit);
    }

    getRun(id: number): PollRun | null {
        return activity.getRun(this.#db, id);
    }

    acquirePollLease(owner: string, ttlMs: number, nowMs?: number): boolean {
        return activity.acquirePollLease(this.#db, owner, ttlMs, nowMs);
    }

    releasePollLease(owner: string): void {
        activity.releasePollLease(this.#db, owner);
    }

    pruneLogs(retentionDays: number): void {
        activity.pruneLogs(this.#db, retentionDays);
    }

    // Delete all PR data, events, logs, and tokens. Keeps the user's config and
    // setup state. The poller rebuilds the board from ADO on the next run.
    deleteAllData(): void {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
            for (const table of [
                "pr_events",
                "prs",
                "poll_runs",
                "activity_log",
                "changes_read",
                "automatic_review_tokens",
            ])
                this.#db.exec(`DELETE FROM ${table}`);
            this.#db.exec(
                "DELETE FROM settings WHERE key IN ('changes_seen_at', 'seen_teams')",
            );
            this.#db.exec("COMMIT");
        } catch (err) {
            this.#db.exec("ROLLBACK");
            throw err;
        }
        // Free the pages so deleted text does not stay in the file.
        // VACUUM runs in the WAL, so checkpoint after it to shrink the main file.
        this.#db.exec("VACUUM");
        this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }

    getConfigOverrides(): ConfigOverrides {
        return settings.getConfigOverrides(this.#db);
    }

    saveConfigOverrides(overrides: ConfigOverrides): void {
        settings.saveConfigOverrides(this.#db, overrides);
    }

    isSetupComplete(): boolean {
        return settings.isSetupComplete(this.#db);
    }

    markSetupComplete(): void {
        settings.markSetupComplete(this.#db);
    }

    getDismissedNotices(): string[] {
        return settings.getDismissedNotices(this.#db);
    }

    dismissNotice(id: string): void {
        settings.dismissNotice(this.#db, id);
    }

    restoreNotice(id: string): void {
        settings.restoreNotice(this.#db, id);
    }

    getUpdateCheck(): settings.UpdateCheck | null {
        return settings.getUpdateCheck(this.#db);
    }

    setUpdateCheck(value: settings.UpdateCheck): void {
        settings.setUpdateCheck(this.#db, value);
    }

    getSeenTeams(): string[] {
        return settings.getSeenTeams(this.#db);
    }

    addSeenTeams(names: string[]): void {
        settings.addSeenTeams(this.#db, names);
    }

    counts(): { prs: number; events: number } {
        const prs = this.#prep("SELECT COUNT(*) AS n FROM prs").get() as {
            n: number;
        };
        const events = this.#prep(
            "SELECT COUNT(*) AS n FROM pr_events",
        ).get() as { n: number };
        return { prs: prs.n, events: events.n };
    }

    // Consistent snapshot into a new file. Fails if the target file exists.
    copyTo(file: string): void {
        mkdirSync(path.dirname(file), { recursive: true });
        this.#db.prepare("VACUUM INTO ?").run(file);
    }

    close(): void {
        this.#db.close();
    }
}
