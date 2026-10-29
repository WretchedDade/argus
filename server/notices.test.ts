import assert from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
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
const okFetch = (async () =>
    new Response(
        JSON.stringify({ tag_name: "v0.3.0", html_url: "https://x/r" }),
    )) as typeof fetch;
assert.deepEqual(await fetchLatestRelease(okFetch), {
    version: "0.3.0",
    url: "https://x/r",
});
const badFetch = (async () =>
    new Response("no", { status: 404 })) as typeof fetch;
assert.equal(await fetchLatestRelease(badFetch), null);
const throwFetch = (async () => {
    throw new Error("offline");
}) as typeof fetch;
assert.equal(await fetchLatestRelease(throwFetch), null);

// Notices
const release = { version: "0.2.0", url: "https://x/r" };
const base = {
    appVersion: "0.1.0",
    release,
    checkForUpdates: true,
    installDir: "C:\\ext",
    skill: null,
};
const update = buildNotices(base)[0];
assert.equal(update.actionLabel, "Update with Copilot");
assert.match(update.prompt ?? "", /argus-v0\.2\.0-windows\.zip/);
assert.match(update.prompt ?? "", /C:\\ext/);
assert.deepEqual(
    buildNotices(base).map((n) => n.id),
    ["app-update:0.2.0"],
);
assert.equal(buildNotices({ ...base, checkForUpdates: false }).length, 0);
assert.equal(buildNotices({ ...base, appVersion: "0.2.0" }).length, 0);
assert.equal(buildNotices({ ...base, release: null }).length, 0);
const withSkill = buildNotices({
    ...base,
    release: null,
    skill: { bundledHash: "abc", bundledPath: "a", installedPath: "b" },
});
assert.deepEqual(
    withSkill.map((n) => n.id),
    ["skill-update:abc"],
);

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

rmSync(dir, { recursive: true, force: true });
console.log("notices tests passed");
