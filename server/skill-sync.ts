import { createHash } from "node:crypto";
import {
    cpSync,
    existsSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

// Written next to an installed baseline skill. It records the hashes that let
// Argus tell an unmodified copy from one the user has edited.
export const SKILL_SIDECAR = ".argus-skill.json";

interface Sidecar {
    bundledHash: string;
    installedHash: string;
}

export type SkillSyncResult =
    | { state: "none" }
    | { state: "updated" }
    | { state: "pending"; bundledHash: string };

// Hash every file (relative path and content) except the top-level sidecar.
export function hashDir(dir: string): string {
    const hash = createHash("sha256");
    const walk = (current: string): void => {
        const entries = readdirSync(current, { withFileTypes: true }).sort(
            (a, b) => a.name.localeCompare(b.name),
        );
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name !== SKILL_SIDECAR || current !== dir) {
                hash.update(path.relative(dir, full).replaceAll("\\", "/"));
                hash.update("\0");
                // Normalize line endings so a Git checkout setting cannot change the hash.
                hash.update(
                    readFileSync(full, "utf-8").replaceAll("\r\n", "\n"),
                );
                hash.update("\0");
            }
        }
    };
    walk(dir);
    return hash.digest("hex");
}

function writeSidecar(src: string, dest: string): void {
    const sidecar: Sidecar = {
        bundledHash: hashDir(src),
        installedHash: hashDir(dest),
    };
    writeFileSync(
        path.join(dest, SKILL_SIDECAR),
        JSON.stringify(sidecar, null, 4) + "\n",
    );
}

function readSidecar(dest: string): Sidecar | null {
    try {
        const parsed = JSON.parse(
            readFileSync(path.join(dest, SKILL_SIDECAR), "utf-8"),
        ) as Partial<Sidecar>;
        return typeof parsed.bundledHash === "string" &&
            typeof parsed.installedHash === "string"
            ? (parsed as Sidecar)
            : null;
    } catch {
        return null;
    }
}

// Record the current bundled and installed hashes, so a skill the user merged
// by hand stops showing as pending.
export function acknowledgeSkill(src: string, dest: string): void {
    writeSidecar(src, dest);
}

// Copy the bundled skill into place and record its hashes.
export function installSkill(src: string, dest: string): void {
    cpSync(src, dest, { recursive: true });
    writeSidecar(src, dest);
}

// Run when Argus starts. Updates an unmodified installed skill in place. Leaves
// an edited skill alone and reports it as pending. Ignores a skill without a
// sidecar, because Argus did not install it.
export function syncSkill(src: string, dest: string): SkillSyncResult {
    if (!existsSync(src) || !existsSync(dest)) return { state: "none" };
    const sidecar = readSidecar(dest);
    if (!sidecar) return { state: "none" };

    const bundledHash = hashDir(src);
    if (bundledHash === sidecar.bundledHash) return { state: "none" };

    // Only a copy that equals the bundled version Argus last recorded is safe
    // to replace. A merged copy records different hashes, so it stays pending.
    if (
        sidecar.installedHash !== sidecar.bundledHash ||
        hashDir(dest) !== sidecar.installedHash
    )
        return { state: "pending", bundledHash };

    rmSync(dest, { recursive: true, force: true });
    installSkill(src, dest);
    return { state: "updated" };
}
