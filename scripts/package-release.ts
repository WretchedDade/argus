// Stages the release archive layout in release/argus-<version>/.
// Run after `npm run build`. Usage: node scripts/package-release.ts
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

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file: string) =>
    JSON.parse(readFileSync(path.join(root, file), "utf8"));

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const name = `argus-${pkg.version}`;
const stage = path.join(root, "release", name);
const ext = path.join(stage, "extension");

for (const required of ["extension.mjs", "dist", "skills/pr-review"]) {
    if (!existsSync(path.join(root, required)))
        throw new Error(`Missing ${required}. Run "npm run build" first.`);
}

rmSync(path.join(root, "release"), { recursive: true, force: true });
mkdirSync(ext, { recursive: true });

cpSync(path.join(root, "extension.mjs"), path.join(ext, "extension.mjs"));
cpSync(path.join(root, "dist"), path.join(ext, "dist"), { recursive: true });
// The first-run setup copies this bundled skill when the user accepts it.
cpSync(
    path.join(root, "skills", "pr-review"),
    path.join(ext, "skills", "pr-review"),
    { recursive: true },
);
cpSync(
    path.join(root, "argus.config.example.json"),
    path.join(ext, "argus.config.example.json"),
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
writeFileSync(
    path.join(ext, "package.json"),
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
    ) + "\n",
);

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: ext,
    stdio: "inherit",
    shell: true,
});

cpSync(path.join(root, "docs", "INSTALL.md"), path.join(stage, "INSTALL.md"));
cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));

// Fail early if the runtime dependencies do not resolve from the staged folder.
execFileSync(
    process.execPath,
    [
        "-e",
        "Promise.all([import('@azure/identity'),import('@azure/identity-broker')]).then(()=>console.log('runtime dependencies resolve'))",
    ],
    { cwd: ext, stdio: "inherit" },
);

console.log(`Staged ${stage}`);
