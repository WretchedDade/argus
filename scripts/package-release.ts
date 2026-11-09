// Stages the release archive layout in release/argus-<version>/.
// Run after `npm run build`.
// Usage: node scripts/package-release.ts [--output-root DIRECTORY]
import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import {
    generateNotices,
    pruneLockfile,
    type Lockfile,
} from "./release-deps.ts";
import {
    RELEASE_FILES,
    resetReleaseStage,
    writeReleaseEvidence,
} from "./release-evidence.ts";

const root = path.resolve(import.meta.dirname, "..");
const readJson = <T>(file: string) =>
    JSON.parse(readFileSync(path.join(root, file), "utf8")) as T;

const pkg = readJson<{ version: string }>("package.json");
const lock = readJson<Lockfile>("package-lock.json");
const name = `argus-${pkg.version}`;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output-root"))
    throw new Error(
        "Usage: node scripts/package-release.ts [--output-root DIRECTORY]",
    );
const outputRoot = args[1] ? path.resolve(args[1]) : path.join(root, "release");
const stage = path.join(outputRoot, name);
const ext = path.join(stage, "extension");

for (const required of Object.values(RELEASE_FILES)) {
    if (!required) continue;
    if (!existsSync(path.join(root, required)))
        throw new Error(`Missing ${required}. Run "npm run build" first.`);
}

resetReleaseStage(outputRoot, pkg.version);
mkdirSync(ext, { recursive: true });

for (const [destination, source] of Object.entries(RELEASE_FILES)) {
    if (!source) continue;
    const target = path.join(stage, destination);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, source), target);
}
cpSync(path.join(root, "dist"), path.join(ext, "dist"), { recursive: true });
// The first-run setup copies this bundled skill when the user accepts it.
cpSync(
    path.join(root, "skills", "pr-review"),
    path.join(ext, "skills", "pr-review"),
    { recursive: true },
);
// Template only: never copy registration values from a developer's machine.
writeFileSync(
    path.join(ext, "ado-auth-config.example.json"),
    JSON.stringify({ clientId: "", tenantId: "" }, null, 4) + "\n",
);

// extension.mjs bundles everything except these packages. Install only them,
// with the versions and integrity values from the committed lockfile.
const external = ["@azure/identity", "@azure/identity-broker", "pino"];
const stagedLock = pruneLockfile(
    lock,
    { name: "argus", version: pkg.version },
    external,
);
const stagedManifest = {
    name: "argus",
    version: pkg.version,
    private: true,
    type: "module",
    dependencies: stagedLock.packages[""].dependencies,
};
writeFileSync(
    path.join(ext, "package.json"),
    JSON.stringify(stagedManifest, null, 4) + "\n",
);
writeFileSync(
    path.join(ext, "package-lock.json"),
    JSON.stringify(stagedLock, null, 4) + "\n",
);
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: ext,
    stdio: "inherit",
    shell: true,
});
writeFileSync(
    path.join(stage, "THIRD-PARTY-NOTICES"),
    generateNotices(ext, stagedLock),
);
// Fail early if the runtime dependencies do not resolve from the staged folder.
execFileSync(
    process.execPath,
    [
        "-e",
        "Promise.all([import('@azure/identity'),import('@azure/identity-broker'),import('pino')]).then(()=>console.log('runtime dependencies resolve'))",
    ],
    { cwd: ext, stdio: "inherit" },
);

writeReleaseEvidence(root, stage, {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
    }).trim(),
    dirty: !!execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        { cwd: root, encoding: "utf8" },
    ).trim(),
});
console.log(`Staged ${stage} with release evidence`);
