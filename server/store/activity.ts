import type { DatabaseSync } from "node:sqlite";
import type { ActivityEntry } from "../types.ts";
import { log } from "../log.ts";
import { prep } from "./prep.ts";

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

export interface PollRunResult {
    ok: boolean;
    mine?: number;
    tracked?: number;
    added?: number;
    updated?: number;
    events?: number;
    closed?: number;
    error?: string | null;
}

interface ActivityRow {
    id: number;
    ts: string;
    level: string;
    msg: string;
    data: string | null;
    run_id: number | null;
}

interface PollRunRow {
    id: number;
    started_at: string;
    finished_at: string | null;
    ok: number;
    mine: number | null;
    tracked: number | null;
    added: number | null;
    updated: number | null;
    events: number | null;
    closed: number | null;
    error: string | null;
}

const now = (): string => new Date().toISOString();

function rowToActivity(r: ActivityRow): ActivityEntry {
    return {
        id: r.id,
        ts: r.ts,
        level: r.level,
        msg: r.msg,
        data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null,
        runId: r.run_id,
    };
}

function rowToRun(r: PollRunRow): PollRun {
    return {
        id: r.id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        ok: !!r.ok,
        mine: r.mine,
        tracked: r.tracked,
        added: r.added,
        updated: r.updated,
        events: r.events,
        closed: r.closed,
        error: r.error,
    };
}

export function startPollRun(
    db: DatabaseSync,
    startedAt: string = now(),
): number {
    const info = prep(db, "INSERT INTO poll_runs (started_at) VALUES (?)").run(
        startedAt,
    );
    return Number(info.lastInsertRowid);
}

export function finishPollRun(
    db: DatabaseSync,
    runId: number,
    result: PollRunResult,
    finishedAt: string = now(),
): void {
    prep(
        db,
        `
      UPDATE poll_runs SET finished_at = ?, ok = ?, mine = ?, tracked = ?, added = ?, updated = ?,
                           events = ?, closed = ?, error = ?
      WHERE id = ?
    `,
    ).run(
        finishedAt,
        result.ok ? 1 : 0,
        result.mine ?? null,
        result.tracked ?? null,
        result.added ?? null,
        result.updated ?? null,
        result.events ?? null,
        result.closed ?? null,
        result.error ?? null,
        runId,
    );
}

// Append one trace line and mirror it to the extension log.
export function recordActivity(
    db: DatabaseSync,
    level: string,
    msg: string,
    data?: Record<string, unknown>,
    runId?: number,
): void {
    prep(
        db,
        "INSERT INTO activity_log (ts, level, msg, data, run_id) VALUES (?, ?, ?, ?, ?)",
    ).run(now(), level, msg, data ? JSON.stringify(data) : null, runId ?? null);
    log(
        data ? `${msg} ${JSON.stringify(data)}` : msg,
        level === "info" ? undefined : level,
    );
}

export function listActivity(db: DatabaseSync, limit = 100): ActivityEntry[] {
    const rows = prep(
        db,
        "SELECT * FROM (SELECT * FROM activity_log ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
    ).all(limit) as unknown as ActivityRow[];
    return rows.map(rowToActivity);
}

// Trace lines for one run, in order, for the run-detail view.
export function listActivityForRun(
    db: DatabaseSync,
    runId: number,
): ActivityEntry[] {
    const rows = prep(
        db,
        "SELECT * FROM activity_log WHERE run_id = ? ORDER BY id ASC",
    ).all(runId) as unknown as ActivityRow[];
    return rows.map(rowToActivity);
}

export function listPollRuns(db: DatabaseSync, limit = 50): PollRun[] {
    const rows = prep(
        db,
        "SELECT * FROM poll_runs ORDER BY id DESC LIMIT ?",
    ).all(limit) as unknown as PollRunRow[];
    return rows.map(rowToRun);
}

export function getRun(db: DatabaseSync, id: number): PollRun | null {
    const row = prep(db, "SELECT * FROM poll_runs WHERE id = ?").get(id) as
        PollRunRow | undefined;
    return row ? rowToRun(row) : null;
}

// Take or renew the poll lease. True when `owner` may poll. Another owner's
// lease blocks us until it expires.
export function acquirePollLease(
    db: DatabaseSync,
    owner: string,
    ttlMs: number,
    nowMs: number = Date.now(),
): boolean {
    db.exec("BEGIN IMMEDIATE");
    try {
        const row = prep(
            db,
            "SELECT owner, expires_at FROM poll_lease WHERE id = 1",
        ).get() as { owner: string; expires_at: number } | undefined;
        const free = !row || row.owner === owner || row.expires_at <= nowMs;
        if (free) {
            prep(
                db,
                "INSERT OR REPLACE INTO poll_lease (id, owner, expires_at) VALUES (1, ?, ?)",
            ).run(owner, nowMs + ttlMs);
        }
        db.exec("COMMIT");
        return free;
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

export function releasePollLease(db: DatabaseSync, owner: string): void {
    prep(db, "DELETE FROM poll_lease WHERE id = 1 AND owner = ?").run(owner);
}

// Drop operational logs older than the retention window. Cheap; run per cycle.
export function pruneLogs(db: DatabaseSync, retentionDays: number): void {
    const cutoff = new Date(
        Date.now() - retentionDays * 86_400_000,
    ).toISOString();
    prep(db, "DELETE FROM activity_log WHERE ts < ?").run(cutoff);
    prep(db, "DELETE FROM poll_runs WHERE started_at < ?").run(cutoff);
}
