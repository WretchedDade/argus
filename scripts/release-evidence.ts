import { createHash } from "node:crypto";
import {
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

// Null sources are generated during staging.
export const RELEASE_FILES: Readonly<Record<string, string | null>> = {
    "extension/extension.mjs": "extension.mjs",
    "extension/dist/index.html": "dist/index.html",
    "extension/skills/pr-review/SKILL.md": "skills/pr-review/SKILL.md",
    "extension/argus.config.example.json": "argus.config.example.json",
    "extension/package.json": null,
    "extension/ado-auth-config.example.json": null,
    "INSTALL.md": "docs/INSTALL.md",
    "install.ps1": "scripts/install.ps1",
    LICENSE: "LICENSE",
};

const packageSchema = z.object({
    version: z.string(),
    scripts: z.unknown().optional(),
});
const dependencySchema = z.object({
    path: z.string(),
    name: z.string(),
    version: z.string(),
    license: z.unknown(),
    resolved: z.string().nullable(),
    integrity: z.string().nullable(),
});
export const releaseManifestSchema = z.object({
    formatVersion: z.literal(1),
    packageVersion: z.string(),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/i),
    sourceDirty: z.boolean(),
    platform: z.string(),
    architecture: z.string(),
    nodeVersion: z.string(),
    sourceLockSha256: z.string().regex(/^[0-9a-f]{64}$/i),
    dependencies: z.array(dependencySchema),
    files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/i)),
});
const lockSchema = z.object({
    packages: z.record(
        z.string(),
        z.object({
            resolved: z.string().optional(),
            integrity: z.string().optional(),
        }),
    ),
});
const installedPackageSchema = z.object({
    name: z.string(),
    version: z.string(),
    license: z.unknown().optional(),
});

export function releaseStage(outputRoot: string, version: string): string {
    // This value becomes a deletion target. Reject paths, not just bad versions.
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
        throw new Error("Invalid release version");
    return path.join(path.resolve(outputRoot), `argus-${version}`);
}

export function resetReleaseStage(outputRoot: string, version: string): string {
    const stage = releaseStage(outputRoot, version);
    // Never delete the parent: it can contain other versions or acquired ZIPs.
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    return stage;
}

const sha256 = (data: Buffer) =>
    createHash("sha256").update(data).digest("hex");

export function payloadChecksums(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    function visit(dir: string) {
        for (const name of readdirSync(dir).sort()) {
            const file = path.join(dir, name);
            if (file === path.join(root, "release-manifest.json")) continue;
            const stat = lstatSync(file);
            if (stat.isSymbolicLink())
                throw new Error("Release payload must not contain links");
            if (stat.isDirectory()) visit(file);
            else if (stat.isFile())
                files[path.relative(root, file).split(path.sep).join("/")] =
                    sha256(readFileSync(file));
            else throw new Error("Release payload contains a non-file entry");
        }
    }
    visit(root);
    return files;
}

export function writeReleaseEvidence(
    root: string,
    stage: string,
    source: { commit: string; dirty: boolean },
): void {
    const pkg = packageSchema.parse(
        JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")),
    );
    const lockBytes = readFileSync(path.join(root, "package-lock.json"));
    const lock = lockSchema.parse(JSON.parse(lockBytes.toString("utf8")));
    // Inventory the packages actually present, not every dev dependency in the
    // source lock. Licenses/notices remain in their original package folders.
    const dependencies = Object.entries(lock.packages)
        .filter(([location]) => location.startsWith("node_modules/"))
        .flatMap(([location, value]) => {
            const file = path.join(
                stage,
                "extension",
                location,
                "package.json",
            );
            if (!existsSync(file)) return [];
            const installed = installedPackageSchema.parse(
                JSON.parse(readFileSync(file, "utf8")),
            );
            return [
                {
                    path: location,
                    name: installed.name,
                    version: installed.version,
                    license: installed.license ?? null,
                    resolved: value.resolved ?? null,
                    integrity: value.integrity ?? null,
                },
            ];
        });
    writeFileSync(
        path.join(stage, "release-manifest.json"),
        JSON.stringify(
            {
                formatVersion: 1,
                packageVersion: pkg.version,
                sourceCommit: source.commit,
                sourceDirty: source.dirty,
                platform: process.platform,
                architecture: process.arch,
                nodeVersion: process.version,
                sourceLockSha256: sha256(lockBytes),
                dependencies,
                // This file cannot hash itself. The workflow hashes the final ZIP.
                files: payloadChecksums(stage),
            },
            null,
            4,
        ) + "\n",
    );
}

export function verifyReleaseEvidence(
    stage: string,
    expectedSourceCommit?: string,
): void {
    const manifest = releaseManifestSchema.parse(
        JSON.parse(
            readFileSync(path.join(stage, "release-manifest.json"), "utf8"),
        ),
    );
    if (expectedSourceCommit) {
        if (manifest.sourceDirty)
            throw new Error("Release source must be clean");
        if (manifest.sourceCommit !== expectedSourceCommit)
            throw new Error("Release source commit does not match GITHUB_SHA");
    }
    const actual = payloadChecksums(stage);
    const expected = manifest.files;
    if (
        !expected ||
        Object.keys(actual).length !== Object.keys(expected).length ||
        Object.entries(actual).some(([file, hash]) => expected[file] !== hash)
    )
        throw new Error("Release payload checksum mismatch");
    for (const file of Object.keys(RELEASE_FILES))
        if (!actual[file]) throw new Error(`Missing release file: ${file}`);
    const pkg = packageSchema.parse(
        JSON.parse(
            readFileSync(path.join(stage, "extension/package.json"), "utf8"),
        ),
    );
    if (pkg.version !== manifest.packageVersion || pkg.scripts)
        throw new Error("Release runtime manifest mismatch");
    const registration: unknown = JSON.parse(
        readFileSync(
            path.join(stage, "extension/ado-auth-config.example.json"),
            "utf8",
        ),
    );
    if (
        JSON.stringify(registration) !==
        JSON.stringify({ clientId: "", tenantId: "" })
    )
        throw new Error("Registration template must contain only empty IDs");
    for (const file of ["argus.config.json", "ado-auth-config.json", "data"]) {
        if (existsSync(path.join(stage, "extension", file)))
            throw new Error("Release contains writable user state");
    }
}
