import type { DatabaseSync } from "node:sqlite";
import { salvageConfigOverrides, type ConfigOverrides } from "../config.ts";
import type { ReleaseInfo } from "../update-check.ts";
import { prep } from "./prep.ts";

export interface UpdateCheck {
    checkedAt: number;
    release: ReleaseInfo | null;
}

export function getSetting(db: DatabaseSync, key: string): string | null {
    const row = prep(db, "SELECT value FROM settings WHERE key = ?").get(
        key,
    ) as { value: string } | undefined;
    return row?.value ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
    prep(
        db,
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
}

// User config overrides (set from the Settings screen), merged onto defaults.
export function getConfigOverrides(db: DatabaseSync): ConfigOverrides {
    const row = prep(
        db,
        "SELECT value FROM settings WHERE key = 'config'",
    ).get() as { value: string } | undefined;
    return row ? salvageConfigOverrides(JSON.parse(row.value)) : {};
}

export function saveConfigOverrides(
    db: DatabaseSync,
    overrides: ConfigOverrides,
): void {
    prep(
        db,
        "INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(overrides));
}

// First-run gate: true once the user has confirmed org/project/team setup.
// Until then the UI shows the setup screen instead of an empty, mis-configured
// board (the shipped defaults are one team's, so ownership is wrong otherwise).
export function isSetupComplete(db: DatabaseSync): boolean {
    return getSetting(db, "setup_complete") === "1";
}

export function markSetupComplete(db: DatabaseSync): void {
    setSetting(db, "setup_complete", "1");
}

// Notice ids the user dismissed from the bell. An id changes when there is
// something new to say, so a dismissed notice does not return unchanged.
export function getDismissedNotices(db: DatabaseSync): string[] {
    const raw = getSetting(db, "dismissed_notices");
    return raw ? (JSON.parse(raw) as string[]) : [];
}

export function dismissNotice(db: DatabaseSync, id: string): void {
    // Session hosts share one database, so lock before the read-modify-write.
    db.exec("BEGIN IMMEDIATE");
    try {
        const ids = new Set(getDismissedNotices(db));
        ids.add(id);
        setSetting(db, "dismissed_notices", JSON.stringify([...ids]));
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

export function restoreNotice(db: DatabaseSync, id: string): void {
    db.exec("BEGIN IMMEDIATE");
    try {
        const ids = new Set(getDismissedNotices(db));
        if (ids.delete(id)) {
            setSetting(db, "dismissed_notices", JSON.stringify([...ids]));
        }
        db.exec("COMMIT");
    } catch (err) {
        db.exec("ROLLBACK");
        throw err;
    }
}

// Shared across session hosts so the daily GitHub check runs once a day.
export function getUpdateCheck(db: DatabaseSync): UpdateCheck | null {
    const raw = getSetting(db, "update_check");
    return raw ? (JSON.parse(raw) as UpdateCheck) : null;
}

export function setUpdateCheck(db: DatabaseSync, value: UpdateCheck): void {
    setSetting(db, "update_check", JSON.stringify(value));
}

// Team (container reviewer) names seen during discovery, for the Settings picker.
export function getSeenTeams(db: DatabaseSync): string[] {
    const v = getSetting(db, "seen_teams");
    return v ? (JSON.parse(v) as string[]) : [];
}

export function addSeenTeams(db: DatabaseSync, names: string[]): void {
    const merged = [...new Set([...getSeenTeams(db), ...names])].sort();
    setSetting(db, "seen_teams", JSON.stringify(merged));
}
