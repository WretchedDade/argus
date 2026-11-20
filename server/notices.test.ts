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
import { describe, it } from "vitest";

describe("server/notices", () => {
    it("shows plugin-manager instructions without offering a ZIP install", () => {
        const inputs = {
            appVersion: "0.2.0",
            checkForUpdates: true,
            pluginInstalled: true,
            pluginRelease: {
                version: "0.3.0",
                url: "https://x/plugin-release",
            },
            release: {
                version: "0.4.0",
                url: "https://x/r",
                zipUrl: "https://x/zip",
                checksumUrl: "https://x/checksum",
            },
            skill: null,
        };
        const notices = buildNotices(inputs);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].id, "plugin-update:0.3.0");
        assert.equal(notices[0].kind, "plugin-update");
        assert.match(notices[0].detail, /You have 0\.2\.0/);
        assert.match(notices[0].detail, /plugin manager/);
        assert.equal(notices[0].actionLabel, undefined);
        assert.equal(notices[0].prompt, undefined);
        assert.equal(
            buildNotices({ ...inputs, checkForUpdates: false }).length,
            0,
        );
        assert.equal(
            buildNotices({ ...inputs, pluginRelease: null }).length,
            0,
        );
        for (const appVersion of ["0.3.0", "0.4.0"]) {
            assert.equal(buildNotices({ ...inputs, appVersion }).length, 0);
        }
    });

    it("compares release versions", async () => {
        assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
        assert.equal(isNewerVersion("v1.0.0", "0.9.9"), true);
        assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
        assert.equal(isNewerVersion("0.1.0", "0.2.0"), false);
        assert.equal(isNewerVersion("garbage", "0.1.0"), false);
    });
    it("requires published archives and checksums for releases", async () => {
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
            browser_download_url:
                "https://x/dl/argus-v0.3.0-windows.zip.sha256",
        };
        assert.equal(await fetchLatestRelease(releaseJson([zipAsset])), null);
        assert.deepEqual(
            await fetchLatestRelease(releaseJson([zipAsset, sumAsset])),
            {
                version: "0.3.0",
                url: "https://x/r",
                zipUrl: "https://x/dl/argus-v0.3.0-windows.zip",
                checksumUrl: "https://x/dl/argus-v0.3.0-windows.zip.sha256",
            },
        );
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
    });
    it("builds notices from release, skill, and storage state", async () => {
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
        assert.equal(update.prompt, undefined);
        assert.deepEqual(
            buildNotices(base).map((n) => n.id),
            ["app-update:0.2.0"],
        );
        assert.equal(
            buildNotices({ ...base, checkForUpdates: false }).length,
            0,
        );
        assert.equal(buildNotices({ ...base, appVersion: "0.2.0" }).length, 0);
        assert.equal(buildNotices({ ...base, release: null }).length, 0);
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
    });
    it("syncs and replaces skills without losing user edits", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-skill-test-"));
        const src = path.join(dir, "bundled");
        const dest = path.join(dir, "installed");
        mkdirSync(src);
        writeFileSync(path.join(src, "SKILL.md"), "v1\r\n");
        assert.deepEqual(syncSkill(src, dest), { state: "none" });
        installSkill(src, dest);
        assert.equal(hashDir(src), hashDir(dest));
        assert.deepEqual(syncSkill(src, dest), { state: "none" });
        writeFileSync(path.join(src, "SKILL.md"), "v2\n");
        assert.deepEqual(syncSkill(src, dest), { state: "updated" });
        assert.equal(
            readFileSync(path.join(dest, "SKILL.md"), "utf-8"),
            "v2\n",
        );
        writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
        writeFileSync(path.join(src, "SKILL.md"), "v3\n");
        const pending = syncSkill(src, dest);
        assert.equal(pending.state, "pending");
        assert.equal(
            readFileSync(path.join(dest, "SKILL.md"), "utf-8"),
            "my edit\n",
        );
        acknowledgeSkill(src, dest);
        assert.deepEqual(syncSkill(src, dest), { state: "none" });
        writeFileSync(path.join(src, "SKILL.md"), "v4\n");
        assert.equal(syncSkill(src, dest).state, "pending");
        assert.equal(
            readFileSync(path.join(dest, "SKILL.md"), "utf-8"),
            "my edit\n",
        );
        rmSync(path.join(dest, SKILL_SIDECAR));
        assert.deepEqual(syncSkill(src, dest), { state: "none" });
        installSkill(src, dest);
        writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
        writeFileSync(path.join(src, "SKILL.md"), "v5\n");
        assert.equal(syncSkill(src, dest).state, "pending");
        const backup = path.join(dir, "backups", "pr-review");
        replaceSkill(src, dest, backup);
        assert.equal(
            readFileSync(path.join(dest, "SKILL.md"), "utf-8"),
            "v5\n",
        );
        assert.equal(
            readFileSync(path.join(backup, "SKILL.md"), "utf-8"),
            "my edit\n",
        );
        assert.deepEqual(syncSkill(src, dest), { state: "none" });
        writeFileSync(path.join(src, "SKILL.md"), "v6\n");
        assert.deepEqual(syncSkill(src, dest), { state: "updated" });
        writeFileSync(path.join(dest, "SKILL.md"), "my edit\n");
        assert.throws(() =>
            replaceSkill(
                path.join(dir, "missing-src"),
                dest,
                path.join(dir, "b2"),
            ),
        );
        assert.equal(
            readFileSync(path.join(dest, "SKILL.md"), "utf-8"),
            "my edit\n",
        );
        assert.deepEqual(
            readdirSync(path.dirname(dest)).filter((n) => n.includes("-swap-")),
            [],
        );
        const userBackup = `${dest}.old`;
        mkdirSync(userBackup);
        writeFileSync(path.join(userBackup, "SKILL.md"), "user backup\n");
        replaceSkill(src, dest, path.join(dir, "b3"));
        assert.equal(
            readFileSync(path.join(userBackup, "SKILL.md"), "utf-8"),
            "user backup\n",
        );
        rmSync(dir, { recursive: true, force: true });
    });
});
