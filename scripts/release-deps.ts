import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type LockPackage = {
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    [key: string]: unknown;
};
export type Lockfile = {
    lockfileVersion: number;
    packages: Record<string, LockPackage>;
    [key: string]: unknown;
};

// Same lookup as Node: nearest node_modules folder up the tree wins.
function resolveLocation(
    lock: Lockfile,
    from: string,
    name: string,
): string | undefined {
    let base = from;
    for (;;) {
        const candidate = `${base}${base ? "/" : ""}node_modules/${name}`;
        if (lock.packages[candidate]) return candidate;
        if (!base) return undefined;
        const cut = base.lastIndexOf("/node_modules/");
        base = cut === -1 ? "" : base.slice(0, cut);
    }
}

// Keeps only the packages the given roots need at runtime, with the versions
// and integrity values already in the committed lockfile.
export function pruneLockfile(
    lock: Lockfile,
    manifest: { name: string; version: string },
    roots: readonly string[],
): Lockfile {
    const keep = new Set<string>();
    const visit = (location: string) => {
        if (keep.has(location)) return;
        keep.add(location);
        const entry = lock.packages[location];
        const optionalPeers = entry.peerDependenciesMeta ?? {};
        const wanted = [
            ...Object.keys(entry.dependencies ?? {}),
            ...Object.keys(entry.optionalDependencies ?? {}),
            ...Object.keys(entry.peerDependencies ?? {}).filter(
                (peer) => !optionalPeers[peer]?.optional,
            ),
        ];
        const optional = new Set(Object.keys(entry.optionalDependencies ?? {}));
        for (const dep of wanted) {
            const found = resolveLocation(lock, location, dep);
            if (found) visit(found);
            else if (!optional.has(dep))
                throw new Error(`${dep} (needed by ${location}) is not locked`);
        }
    };
    const rootDependencies: Record<string, string> = {};
    for (const root of roots) {
        const location = resolveLocation(lock, "", root);
        if (!location)
            throw new Error(`${root} not found in package-lock.json`);
        visit(location);
        rootDependencies[root] = lock.packages[location].version ?? "";
    }
    const packages: Record<string, LockPackage> = {
        "": {
            name: manifest.name,
            version: manifest.version,
            dependencies: rootDependencies,
        },
    };
    for (const location of [...keep].sort())
        packages[location] = lock.packages[location];
    return {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: lock.lockfileVersion,
        requires: true,
        packages,
    };
}

const LICENSE_FILE = /^(licen[cs]e|notice|copying)(\.|$)/i;

function licenseText(folder: string): string {
    const files = readdirSync(folder).filter((name) => LICENSE_FILE.test(name));
    return files
        .sort()
        .map((name) => readFileSync(path.join(folder, name), "utf8").trim())
        .join("\n\n");
}

function licenseId(license: unknown): string {
    if (typeof license === "string") return license;
    if (license && typeof license === "object" && "type" in license)
        return String(license.type);
    return "UNKNOWN";
}

// Lists every package in the installed tree with its license and license text.
export function generateNotices(extensionDir: string, lock: Lockfile): string {
    const entries = Object.keys(lock.packages)
        .filter((location) => location.startsWith("node_modules/"))
        .sort()
        .flatMap((location) => {
            const folder = path.join(extensionDir, location);
            const file = path.join(folder, "package.json");
            if (!existsSync(file)) return [];
            const info = JSON.parse(readFileSync(file, "utf8")) as {
                name: string;
                version: string;
                license?: unknown;
            };
            const text = licenseText(folder);
            return [
                [
                    `${info.name} ${info.version}`,
                    `License: ${licenseId(info.license)}`,
                    "",
                    text || "(No license file in the package.)",
                ].join("\n"),
            ];
        });
    const rule = "-".repeat(72);
    return (
        [
            "THIRD-PARTY NOTICES",
            "",
            "Argus ships the packages below in extension/node_modules.",
            `${entries.length} packages.`,
            "",
            ...entries.flatMap((entry) => [rule, entry, ""]),
        ].join("\n") + "\n"
    );
}
