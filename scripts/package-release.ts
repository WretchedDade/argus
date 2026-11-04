// Stages the release archive layout in release/argus-<version>/.
// Run after `npm run build`.
// Usage: node scripts/package-release.ts [--output-root DIRECTORY]
import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import {
    RELEASE_FILES,
    resetReleaseStage,
    writeReleaseEvidence,
} from "./release-evidence.ts";

const root = path.resolve(import.meta.dirname, "..");
const readJson = <T>(file: string) =>
    JSON.parse(readFileSync(path.join(root, file), "utf8")) as T;

const pkg = readJson<{ version: string }>("package.json");
const lock = readJson<{ packages: Record<string, { version: string }> }>(
    "package-lock.json",
);
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

// extension.mjs bundles everything except these packages. Pin them to the
// versions in package-lock.json.
const external = ["@azure/identity", "@azure/identity-broker"];
const dependencies = Object.fromEntries(
    external.map((dep) => {
        const entry = lock.packages[`node_modules/${dep}`];
        if (!entry) throw new Error(`${dep} not found in package-lock.json`);
        return [dep, entry.version];
    }),
);
const stagedManifest =
    JSON.stringify(
        {
            name: "argus",
            version: pkg.version,
            private: true,
            type: "module",
            dependencies,
        },
        null,
        4,
    ) + "\n";

// Install from the root lockfile so the production tree matches the tested
// one. The manifest has no scripts, so the root "prepare" hook does not run.
writeFileSync(
    path.join(ext, "package.json"),
    JSON.stringify({ ...pkg, scripts: undefined }, null, 4) + "\n",
);
cpSync(
    path.join(root, "package-lock.json"),
    path.join(ext, "package-lock.json"),
);
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: ext,
    stdio: "inherit",
    shell: true,
});
writeFileSync(path.join(ext, "package.json"), stagedManifest);
rmSync(path.join(ext, "package-lock.json"), { force: true });
// The lockfile links the workspace package, which esbuild already bundles. The
// link points outside the ZIP, so remove it.
rmSync(path.join(ext, "node_modules", "@devstart"), {
    recursive: true,
    force: true,
});

// Fail early if the runtime dependencies do not resolve from the staged folder.
execFileSync(
    process.execPath,
    [
        "-e",
        "Promise.all([import('@azure/identity'),import('@azure/identity-broker')]).then(()=>console.log('runtime dependencies resolve'))",
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
