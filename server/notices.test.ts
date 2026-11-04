import assert from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildNotices } from "./notices.ts";
import { fetchLatestRelease, isNewerVersion } from "./update-check.ts";
import {
    acknowledgeSkill,
    hashDir,
    installSkill,
    replaceSkill,
    SKILL_SIDECAR,
    syncSkill,
} from "./skill-sync.ts";

// Version comparison
assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
assert.equal(isNewerVersion("v1.0.0", "0.9.9"), true);
assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
assert.equal(isNewerVersion("0.1.0", "0.2.0"), false);
assert.equal(isNewerVersion("garbage", "0.1.0"), false);

// Release fetch
const releaseJson = (assets: unknown[]) =>
    (async () =>
        new Response(
            JSON.stringify({
                tag_name: "v0.3.0",
                html_url: "https://x/r",
                assets,
            }),
        )) as typeof fetch;
const zipAsset = {
    name: "argus-v0.3.0-windows.zip",
    state: "uploaded",
    browser_download_url: "https://x/dl/argus-v0.3.0-windows.zip",
};
const sumAsset = {
    name: "argus-v0.3.0-windows.zip.sha256",
    state: "uploaded",
    browser_download_url: "https://x/dl/argus-v0.3.0-windows.zip.sha256",
};
// A release without its checksum is not offered, so the update fails closed.
assert.equal(await fetchLatestRelease(releaseJson([zipAsset])), null);
assert.deepEqual(await fetchLatestRelease(releaseJson([zipAsset, sumAsset])), {
    version: "0.3.0",
    url: "https://x/r",
    zipUrl: "https://x/dl/argus-v0.3.0-windows.zip",
    checksumUrl: "https://x/dl/argus-v0.3.0-windows.zip.sha256",
});
// A release without the ZIP asset is not offered as an update.
// A failed upload leaves a placeholder asset in the starter state.
assert.equal(
    await fetchLatestRelease(
        releaseJson([{ ...zipAsset, state: "starter" }, sumAsset]),
    ),
    null,
);
assert.equal(await fetchLatestRelease(releaseJson([])), null);
assert.equal(
    await fetchLatestRelease(
        releaseJson([
            { name: "other.zip", browser_download_url: "https://x/o" },
        ]),
    ),
    null,
);
const badFetch = (async () =>
    new Response("no", { status: 404 })) as typeof fetch;
assert.equal(await fetchLatestRelease(badFetch), null);
const throwFetch = (async () => {
    throw new Error("offline");
}) as typeof fetch;
assert.equal(await fetchLatestRelease(throwFetch), null);

// Notices
const release = {
    version: "0.2.0",
    url: "https://x/r",
    zipUrl: "https://x/dl/argus-v0.2.0-windows.zip",
    checksumUrl: "https://x/dl/argus-v0.2.0-windows.zip.sha256",
};
const base = {
    appVersion: "0.1.0",
    release,
    checkForUpdates: true,
    skill: null,
};
const update = buildNotices(base)[0];
assert.equal(update.actionLabel, "Update now");
// Argus runs the update itself, so there is no chat prompt.
assert.equal(update.prompt, undefined);
assert.deepEqual(
    buildNotices(base).map((n) => n.id),
    ["app-update:0.2.0"],
);
assert.equal(buildNotices({ ...base, checkForUpdates: false }).length, 0);
assert.equal(buildNotices({ ...base, appVersion: "0.2.0" }).length, 0);
assert.equal(buildNotices({ ...base, release: null }).length, 0);
// A cached release saved before checksumUrl existed gives no update notice.
assert.equal(
    buildNotices({
        ...base,
        release: {
            version: "0.2.0",
            url: "https://x/r",
            zipUrl: release.zipUrl,
        } as typeof release,
    }).length,
    0,
);
const withSkill = buildNotices({
    ...base,
    release: null,
    skill: { bundledHash: "abc", bundledPath: "a", installedPath: "b" },
});
assert.deepEqual(
    withSkill.map((n) => n.id),
    ["skill-update:abc"],
);
const legacy = buildNotices({
    ...base,
    release: null,
    legacyDb: {
        path: "O:\\Desktop\\argus.db",
        localPath: "L:\\argus.db",
        choiceFile: "L:\\storage.json",
    },
});
assert.deepEqual(
    legacy.map((n) => n.id),
    ["storage-legacy"],
);
assert.match(legacy[0].prompt ?? "", /L:\\storage\.json/);

// Skill sync
const dir = mkdtempSync(path.join(tmpdir(), "argus-skill-test-"));
const src = path.join(dir, "bundled");
const dest = path.join(dir, "installed");
mkdirSync(src);
writeFileSync(path.join(src, "SKILL.md"), "v1\r\n");

assert.deepEqual(syncSkill(src, dest), { state: "none" }); // not installed
installSkill(src, dest);
assert.equal(hashDir(src), hashDir(dest)); // sidecar excluded from the hash
assert.deepEqual(syncSkill(src, dest), { state: "none" }); // unchanged

writeFileSync(path.join(src, "SKILL.md"), "v2\n");
assert.deepEqual(syncSkill(src, dest), { state: "updated" });
assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf-8"), "v2\n");

writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
writeFileSync(path.join(src, "SKILL.md"), "v3\n");
const pending = syncSkill(src, dest);
assert.equal(pending.state, "pending");
assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf-8"), "my edit\n");

// After a merge is acknowledged, the next baseline update must not replace it.
acknowledgeSkill(src, dest);
assert.deepEqual(syncSkill(src, dest), { state: "none" });
writeFileSync(path.join(src, "SKILL.md"), "v4\n");
assert.equal(syncSkill(src, dest).state, "pending");
assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf-8"), "my edit\n");
rmSync(path.join(dest, SKILL_SIDECAR));
assert.deepEqual(syncSkill(src, dest), { state: "none" }); // not ours

// Using the new version replaces the edited copy and keeps a backup.
installSkill(src, dest);
writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
writeFileSync(path.join(src, "SKILL.md"), "v5\n");
assert.equal(syncSkill(src, dest).state, "pending");
const backup = path.join(dir, "backups", "pr-review");
replaceSkill(src, dest, backup);
assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf-8"), "v5\n");
assert.equal(readFileSync(path.join(backup, "SKILL.md"), "utf-8"), "my edit\n");
assert.deepEqual(syncSkill(src, dest), { state: "none" });
writeFileSync(path.join(src, "SKILL.md"), "v6\n");
assert.deepEqual(syncSkill(src, dest), { state: "updated" }); // baseline again

// A failed replacement keeps the working install.
writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
assert.throws(() =>
    replaceSkill(path.join(dir, "missing-src"), dest, path.join(dir, "b2")),
);
assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf-8"), "my edit\n");
assert.deepEqual(
    readdirSync(path.dirname(dest)).filter((n) => n.includes("-swap-")),
    [],
);

// Sibling folders that the user owns survive a replacement.
const userBackup = `${dest}.old`;
mkdirSync(userBackup);
writeFileSync(path.join(userBackup, "SKILL.md"), "user backup\n");
replaceSkill(src, dest, path.join(dir, "b3"));
assert.equal(
    readFileSync(path.join(userBackup, "SKILL.md"), "utf-8"),
    "user backup\n",
);

rmSync(dir, { recursive: true, force: true });
