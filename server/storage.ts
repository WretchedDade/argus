import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ArgusStore } from "./db.ts";

export type DbLocation = "local" | "onedrive";

export interface StorageEnv {
    env: NodeJS.ProcessEnv;
    home?: string;
    // Folder of the extension. Older versions kept the database in its data folder.
    extensionDir?: string;
}

export interface ResolvedStorage {
    file: string;
    // Why this file was chosen.
    source: "env" | "choice" | "legacy" | "default";
    location: DbLocation | null; // null when ARGUS_DB_FILE sets the path
    legacyPath: string | null; // set while an old OneDrive file is still in use by default
}

const CHOICE_FILE = "storage.json";

export function oneDriveRoot(env: NodeJS.ProcessEnv): string | null {
    return env.OneDriveCommercial || env.OneDrive || null;
}

export function oneDriveDbPath(env: NodeJS.ProcessEnv): string | null {
    const root = oneDriveRoot(env);
    return root ? path.join(root, "Desktop", "argus.db") : null;
}

export function localDbPath(s: StorageEnv): string {
    const base =
        s.env.LOCALAPPDATA ||
        path.join(s.home ?? homedir(), "AppData", "Local");
    return path.join(base, "argus", "argus.db");
}

// The choice lives beside the local database, not inside the database,
// because Argus must know where the database is before it opens it.
export function choiceFilePath(s: StorageEnv): string {
    return path.join(path.dirname(localDbPath(s)), CHOICE_FILE);
}

export function readChoice(s: StorageEnv): DbLocation | null {
    try {
        const parsed = JSON.parse(readFileSync(choiceFilePath(s), "utf-8")) as {
            location?: unknown;
        };
        return parsed.location === "local" || parsed.location === "onedrive"
            ? parsed.location
            : null;
    } catch {
        return null;
    }
}

export function writeChoice(s: StorageEnv, location: DbLocation): void {
    const file = choiceFilePath(s);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ location }, null, 2) + "\n");
}

export function extensionDbPath(s: StorageEnv): string | null {
    return s.extensionDir
        ? path.join(s.extensionDir, "data", "argus.db")
        : null;
}

// Order: ARGUS_DB_FILE, the saved choice, an existing file from an older
// version (kept so no data is lost), then the local default.
export function resolveDbFile(s: StorageEnv): ResolvedStorage {
    if (s.env.ARGUS_DB_FILE) {
        return {
            file: s.env.ARGUS_DB_FILE,
            source: "env",
            location: null,
            legacyPath: null,
        };
    }
    const local = localDbPath(s);
    const oneDrive = oneDriveDbPath(s.env);
    const extensionDb = extensionDbPath(s);
    const choice = readChoice(s);
    if (choice === "onedrive" && oneDrive) {
        return {
            file: oneDrive,
            source: "choice",
            location: "onedrive",
            legacyPath: null,
        };
    }
    if (choice) {
        return {
            file: local,
            source: "choice",
            location: "local",
            legacyPath: null,
        };
    }
    if (!existsSync(local)) {
        if (oneDrive && existsSync(oneDrive)) {
            return {
                file: oneDrive,
                source: "legacy",
                location: "onedrive",
                legacyPath: oneDrive,
            };
        }
        // Older versions used this file when OneDrive was absent.
        if (extensionDb && existsSync(extensionDb)) {
            return {
                file: extensionDb,
                source: "legacy",
                location: "local",
                legacyPath: null,
            };
        }
    }
    return {
        file: local,
        source: "default",
        location: "local",
        legacyPath: null,
    };
}

// Runs before the database opens. When the user chose a location that has no
// file yet, copy the database from the old location now, so writes made
// before the reload are included. An existing target file is never replaced.
export function migrateToChoice(
    s: StorageEnv,
    resolved: ResolvedStorage,
): string | null {
    if (resolved.source !== "choice" || existsSync(resolved.file)) return null;
    const source = [
        localDbPath(s),
        oneDriveDbPath(s.env),
        extensionDbPath(s),
    ].find(
        (f): f is string =>
            !!f &&
            path.resolve(f) !== path.resolve(resolved.file) &&
            existsSync(f),
    );
    if (!source) return null;
    const from = new ArgusStore(source);
    try {
        from.copyTo(resolved.file);
    } finally {
        from.close();
    }
    return source;
}
