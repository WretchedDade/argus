import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ReleaseInfo } from "./update-check.ts";

const execFileAsync = promisify(execFile);

export interface UpdateDeps {
    fetchFn?: typeof fetch;
    extract?: (zipFile: string, destination: string) => Promise<void>;
    install?: (script: string, destination: string) => Promise<void>;
}

const POWERSHELL = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
];

// The paths go through the environment so that no quoting rules apply to them.
const extractZip = async (zipFile: string, destination: string) => {
    await execFileAsync(
        "powershell.exe",
        [
            ...POWERSHELL,
            "-Command",
            "Expand-Archive -LiteralPath $env:ARGUS_ZIP -DestinationPath $env:ARGUS_DEST -Force",
        ],
        {
            env: {
                ...process.env,
                ARGUS_ZIP: zipFile,
                ARGUS_DEST: destination,
            },
        },
    );
};

const runInstaller = async (script: string, destination: string) => {
    await execFileAsync("powershell.exe", [
        ...POWERSHELL,
        "-File",
        script,
        "-Destination",
        destination,
    ]);
};

async function download(fetchFn: typeof fetch, url: string): Promise<Buffer> {
    const res = await fetchFn(url, {
        headers: { "User-Agent": "argus-update" },
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

// Accepts a bare hash or the `<hash>  <file name>` form of `sha256sum`.
export function parseChecksum(text: string): string | null {
    const match = text.trim().match(/^([0-9a-f]{64})(?:\s|$)/i);
    return match ? match[1].toLowerCase() : null;
}

// Downloads the release ZIP, checks its SHA-256, and runs the install script
// from the ZIP. Fails before it touches the install when the checksum differs.
export async function applyUpdate(
    release: ReleaseInfo,
    installDir: string,
    deps: UpdateDeps = {},
): Promise<void> {
    const fetchFn = deps.fetchFn ?? fetch;
    const extract = deps.extract ?? extractZip;
    const install = deps.install ?? runInstaller;

    const [zip, checksumText] = await Promise.all([
        download(fetchFn, release.zipUrl),
        download(fetchFn, release.checksumUrl),
    ]);
    const expected = parseChecksum(checksumText.toString("utf-8"));
    if (!expected) throw new Error("The checksum file is not valid.");
    const actual = createHash("sha256").update(zip).digest("hex");
    if (actual !== expected) {
        throw new Error(
            "The downloaded ZIP does not match its checksum. Nothing was installed.",
        );
    }

    const work = await mkdtemp(path.join(tmpdir(), "argus-update-"));
    try {
        const zipFile = path.join(work, "release.zip");
        const extracted = path.join(work, "extracted");
        await writeFile(zipFile, zip);
        await extract(zipFile, extracted);
        const script = path.join(
            extracted,
            `argus-v${release.version}`,
            "install.ps1",
        );
        if (!existsSync(script)) {
            throw new Error("The ZIP does not contain install.ps1.");
        }
        await install(script, installDir);
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}
