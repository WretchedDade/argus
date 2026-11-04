import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseChecksum, applyUpdate } from "./updater.ts";

const release = {
    version: "0.2.0",
    url: "https://x/r",
    zipUrl: "https://x/dl/argus-v0.2.0-windows.zip",
    checksumUrl: "https://x/dl/argus-v0.2.0-windows.zip.sha256",
};
const zipBytes = Buffer.from("pretend zip");
const goodHash = createHash("sha256").update(zipBytes).digest("hex");

const fakeFetch = (checksumText: string) =>
    (async (url: string) =>
        new Response(
            url.endsWith(".sha256") ? checksumText : zipBytes,
        )) as typeof fetch;

function deps(checksumText: string, withScript = false) {
    const calls = { extract: 0, install: [] as string[][] };
    return {
        calls,
        deps: {
            fetchFn: fakeFetch(checksumText),
            extract: async (_zip: string, dest: string) => {
                calls.extract++;
                if (!withScript) return;
                const dir = path.join(dest, "argus-v0.2.0");
                mkdirSync(dir, { recursive: true });
                writeFileSync(path.join(dir, "install.ps1"), "");
            },
            install: async (script: string, dest: string) => {
                calls.install.push([script, dest]);
            },
        },
    };
}

assert.equal(parseChecksum(`${goodHash}  file.zip\n`), goodHash);
assert.equal(parseChecksum(goodHash.toUpperCase()), goodHash);
assert.equal(parseChecksum("not a hash"), null);

// A checksum mismatch stops before anything is extracted or installed.
const bad = deps(`${"0".repeat(64)}  file.zip`);
await assert.rejects(
    applyUpdate(release, "C:\\ext", bad.deps),
    /does not match its checksum/,
);
assert.equal(bad.calls.extract, 0);
assert.equal(bad.calls.install.length, 0);

// An unreadable checksum file also fails closed.
const junk = deps("<html>404</html>");
await assert.rejects(
    applyUpdate(release, "C:\\ext", junk.deps),
    /checksum file is not valid/,
);
assert.equal(junk.calls.install.length, 0);

// A matching checksum extracts, but the script is missing from the fake extract.
const good = deps(`${goodHash}  file.zip`);
await assert.rejects(
    applyUpdate(release, "C:\\ext", good.deps),
    /does not contain install\.ps1/,
);
assert.equal(good.calls.extract, 1);
assert.equal(good.calls.install.length, 0);

// A matching checksum runs the script from the ZIP against the install folder.
const ok = deps(`${goodHash}  file.zip`, true);
const seen: string[] = [];
await applyUpdate(release, "C:\\ext", ok.deps, (p) => seen.push(p));
assert.deepEqual(seen, [
    "downloading",
    "verifying",
    "extracting",
    "installing",
]);
assert.equal(ok.calls.install.length, 1);
assert.match(ok.calls.install[0][0], /argus-v0\.2\.0[\\/]install\.ps1$/);
assert.equal(ok.calls.install[0][1], "C:\\ext");
