import { execFileSync, spawnSync } from "node:child_process";
import {
    closeSync,
    cpSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isNewerVersion } from "../server/update-check.ts";
import {
    payloadChecksums,
    RELEASE_FILES,
    releaseManifestSchema,
    releaseStage,
    resetReleaseStage,
    verifyReleaseEvidence,
} from "./release-evidence.ts";

const pluginFiles = path.resolve(import.meta.dirname, "..", "plugin");
const runtimeSchema = z
    .object({
        version: z.string(),
        argusDistribution: z.enum(["zip", "plugin"]).optional(),
    })
    .passthrough();
const readJson = (file: string): unknown =>
    JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 4) + "\n");
};
const manifestAt = (stage: string) =>
    releaseManifestSchema.parse(
        readJson(path.join(stage, "release-manifest.json")),
    );

function overlaps(first: string, second: string): boolean {
    const relative = path.relative(first, second);
    return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
    );
}

export function stagePlugin(release: string, outputRoot: string): string {
    release = path.resolve(release);
    verifyReleaseEvidence(release);
    const manifest = manifestAt(release);
    const releasedRuntime = runtimeSchema.parse(
        readJson(path.join(release, "extension", "package.json")),
    );
    if (releasedRuntime.argusDistribution !== "zip")
        throw new Error(
            "This release predates plugin support. Publish a plugin-aware ZIP release first.",
        );
    if (manifest.platform !== "win32" || manifest.architecture !== "x64")
        throw new Error("The Argus plugin requires a Windows x64 release.");
    const stage = releaseStage(outputRoot, manifest.packageVersion);
    if (overlaps(release, stage) || overlaps(stage, release))
        throw new Error("Plugin output must not overlap the input release.");
    resetReleaseStage(outputRoot, manifest.packageVersion);
    const extension = path.join(stage, "extensions", "argus");
    cpSync(path.join(release, "extension"), extension, { recursive: true });
    for (const file of ["LICENSE", "THIRD-PARTY-NOTICES", "INSTALL.md"])
        cpSync(path.join(release, file), path.join(stage, file));
    const runtimeFile = path.join(extension, "package.json");
    writeJson(runtimeFile, { ...releasedRuntime, argusDistribution: "plugin" });
    cpSync(pluginFiles, stage, { recursive: true });
    const pluginManifest = path.join(stage, ".claude-plugin", "plugin.json");
    const pluginMetadata = z
        .record(z.string(), z.unknown())
        .parse(readJson(pluginManifest));
    writeJson(pluginManifest, {
        ...pluginMetadata,
        version: manifest.packageVersion,
    });
    writeJson(path.join(stage, "release-manifest.json"), {
        ...manifest,
        files: payloadChecksums(stage),
    });
    verifyPluginEvidence(stage);
    return stage;
}

export function verifyPluginEvidence(
    stage: string,
    expectedSourceCommit?: string,
): void {
    const manifest = manifestAt(stage);
    if (
        expectedSourceCommit &&
        (manifest.sourceDirty || manifest.sourceCommit !== expectedSourceCommit)
    )
        throw new Error(
            "Plugin source must be clean and match the release source commit.",
        );
    const actual = payloadChecksums(stage, true);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
        throw new Error("Plugin payload checksum mismatch.");
    const required = [
        ...Object.keys(RELEASE_FILES)
            .filter((file) => file !== "install.ps1")
            .map((file) => file.replace(/^extension\//, "extensions/argus/")),
        ".claude-plugin/plugin.json",
        ".github/plugin/marketplace.json",
        ".gitattributes",
    ];
    for (const file of required)
        if (!actual[file]) throw new Error(`Missing plugin file: ${file}`);
    const runtime = runtimeSchema.parse(
        readJson(path.join(stage, "extensions", "argus", "package.json")),
    );
    if (
        runtime.version !== manifest.packageVersion ||
        runtime.argusDistribution !== "plugin" ||
        runtime.scripts
    )
        throw new Error("Plugin runtime manifest mismatch.");
    const plugin = z.object({
        name: z.literal("argus"),
        version: z.literal(manifest.packageVersion),
        extensions: z.literal("extensions"),
        skills: z.literal("extensions/argus/skills"),
    });
    plugin.parse(readJson(path.join(stage, ".claude-plugin", "plugin.json")));
    z.object({
        name: z.literal("argus"),
        plugins: z.tuple([
            z.object({
                name: z.literal("argus"),
                source: z.literal("."),
            }),
        ]),
    }).parse(
        readJson(path.join(stage, ".github", "plugin", "marketplace.json")),
    );
    for (const file of ["argus.config.json", "ado-auth-config.json", "data"])
        if (
            Object.keys(actual).some(
                (entry) =>
                    entry === `extensions/argus/${file}` ||
                    entry.startsWith(`extensions/argus/${file}/`),
            )
        )
            throw new Error("Plugin contains writable user state.");
}

export function publishPlugin(sourceRepo: string, stage: string): boolean {
    stage = path.resolve(stage);
    const manifest = manifestAt(stage);
    verifyPluginEvidence(stage, manifest.sourceCommit);
    const git = (...args: string[]) =>
        execFileSync("git", args, {
            cwd: sourceRepo,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
    const remote = spawnSync(
        "git",
        ["ls-remote", "--exit-code", "origin", "refs/heads/plugin"],
        {
            cwd: sourceRepo,
            encoding: "utf8",
        },
    );
    if (remote.error) throw remote.error;
    if (remote.status !== 0 && remote.status !== 2)
        throw new Error(`Plugin branch lookup failed: ${remote.stderr}`);
    let parent: string | null = null;
    if (remote.status === 0) {
        git("fetch", "--no-tags", "origin", "refs/heads/plugin");
        parent = git("rev-parse", "FETCH_HEAD");
    }
    const work = mkdtempSync(path.join(tmpdir(), "argus-plugin-index-"));
    try {
        let previousVersion: string | undefined;
        if (parent) {
            const previousFile = path.join(work, "release-manifest.json");
            const descriptor = openSync(previousFile, "w");
            try {
                // Dependency inventories can exceed the subprocess stdout buffer.
                execFileSync(
                    "git",
                    ["show", `${parent}:release-manifest.json`],
                    {
                        cwd: sourceRepo,
                        stdio: ["ignore", descriptor, "pipe"],
                    },
                );
            } finally {
                closeSync(descriptor);
            }
            previousVersion = manifestAt(work).packageVersion;
            if (
                previousVersion !== manifest.packageVersion &&
                !isNewerVersion(manifest.packageVersion, previousVersion)
            )
                throw new Error("A newer plugin version is already published.");
        }
        const gitDir = git("rev-parse", "--absolute-git-dir");
        const run = (...args: string[]) =>
            execFileSync(
                "git",
                [
                    `--git-dir=${gitDir}`,
                    `--work-tree=${stage}`,
                    "-c",
                    "core.autocrlf=false",
                    "-c",
                    "core.filemode=false",
                    "-c",
                    "core.longpaths=true",
                    "-c",
                    "user.name=github-actions[bot]",
                    "-c",
                    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                    ...args,
                ],
                {
                    cwd: stage,
                    env: {
                        ...process.env,
                        GIT_INDEX_FILE: path.join(work, "index"),
                    },
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                },
            ).trim();
        run("read-tree", "--empty");
        run("add", "--force", "--all", "--", ".");
        const tree = run("write-tree");
        if (parent) {
            if (tree === git("rev-parse", `${parent}^{tree}`)) return false;
            if (previousVersion === manifest.packageVersion)
                throw new Error(
                    "This plugin version already has a different payload. Publish a new version.",
                );
        }
        const commit = run(
            "commit-tree",
            tree,
            ...(parent ? ["-p", parent] : []),
            "-m",
            `Publish Argus v${manifest.packageVersion} as a plugin\n\nSource: ${manifest.sourceCommit}\n\nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`,
        );
        // A concurrent publication must fail, never replace another publisher's work.
        git("push", "origin", `${commit}:refs/heads/plugin`);
        return true;
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const [command, input, output, ...extra] = process.argv.slice(2);
    if (
        extra.length ||
        !input ||
        (command === "stage" ? !output : command !== "publish" || output)
    )
        throw new Error(
            "Usage: node scripts/plugin-release.ts stage RELEASE_DIRECTORY OUTPUT_ROOT | publish PLUGIN_DIRECTORY",
        );
    if (command === "stage") console.log(stagePlugin(input, output));
    else
        console.log(
            publishPlugin(path.resolve(import.meta.dirname, ".."), input)
                ? "Plugin branch published."
                : "Plugin payload is already published.",
        );
}
