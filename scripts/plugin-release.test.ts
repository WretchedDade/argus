import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { RELEASE_FILES, writeReleaseEvidence } from "./release-evidence.ts";
import {
    stagePlugin,
    verifyPluginEvidence,
    publishPlugin,
} from "./plugin-release.ts";

function releaseFixture(root: string, version: string) {
    const source = path.join(root, `source-${version}`);
    const release = path.join(root, "releases", `argus-${version}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(
        path.join(source, "package.json"),
        JSON.stringify({ version }),
    );
    writeFileSync(path.join(source, "package-lock.json"), '{"packages":{}}');
    for (const file of Object.keys(RELEASE_FILES)) {
        const target = path.join(release, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, "fixture\r\n");
    }
    writeFileSync(
        path.join(release, "extension/package.json"),
        JSON.stringify({
            name: "argus",
            version,
            type: "module",
            argusDistribution: "zip",
        }),
    );
    writeFileSync(
        path.join(release, "extension/ado-auth-config.example.json"),
        '{"clientId":"","tenantId":""}',
    );
    const native = path.join(
        release,
        "extension",
        "node_modules",
        "runtime",
        "native.node",
    );
    mkdirSync(path.dirname(native), { recursive: true });
    writeFileSync(native, Buffer.from([0, 255, 13, 10, 128]));
    writeReleaseEvidence(source, release, {
        commit: "a".repeat(40),
        dirty: false,
    });
    const file = path.join(release, "release-manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
    >;
    writeFileSync(
        file,
        JSON.stringify({ ...manifest, platform: "win32", architecture: "x64" }),
    );
    return release;
}

describe("scripts/plugin-release", () => {
    it("stages the verified ZIP runtime as an installable marketplace payload", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-plugin-stage-"));
        try {
            const release = releaseFixture(dir, "1.0.0");
            const stage = stagePlugin(release, path.join(dir, "plugins"));
            verifyPluginEvidence(stage, "a".repeat(40));
            const catalog = path.join(".github", "plugin", "marketplace.json");
            assert.equal(
                readFileSync(path.join(stage, catalog), "utf8"),
                readFileSync(
                    path.resolve(import.meta.dirname, "..", "plugin", catalog),
                    "utf8",
                ),
            );
            const manifest = JSON.parse(
                readFileSync(
                    path.join(stage, ".claude-plugin/plugin.json"),
                    "utf8",
                ),
            ) as { extensions: string; skills: string };
            assert.equal(manifest.extensions, "extensions");
            assert.equal(manifest.skills, "extensions/argus/skills");
            assert.equal(
                readFileSync(
                    path.join(stage, "extensions/argus/extension.mjs"),
                    "utf8",
                ),
                readFileSync(
                    path.join(release, "extension/extension.mjs"),
                    "utf8",
                ),
            );
            const runtime = JSON.parse(
                readFileSync(
                    path.join(stage, "extensions/argus/package.json"),
                    "utf8",
                ),
            ) as { argusDistribution: string };
            assert.equal(runtime.argusDistribution, "plugin");
            assert.throws(() => stagePlugin(release, release), /overlap/);
            assert.throws(
                () => stagePlugin(release, path.dirname(release)),
                /overlap/,
            );
            writeFileSync(
                path.join(stage, "extensions/argus/extension.mjs"),
                "tampered",
            );
            assert.throws(() => verifyPluginEvidence(stage), /checksum/);
            writeFileSync(
                path.join(release, "extension/argus.config.json"),
                "{}",
            );
            assert.throws(
                () => stagePlugin(release, path.join(dir, "other")),
                /checksum/,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("publishes append-only commits, preserves source HEAD, and rejects downgrades", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-plugin-publish-"));
        const git = (cwd: string, ...args: string[]) =>
            execFileSync("git", args, {
                cwd,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }).trim();
        try {
            const remote = path.join(dir, "origin.git");
            git(dir, "init", "--bare", remote);
            const source = path.join(dir, "source");
            mkdirSync(source);
            git(source, "init");
            git(source, "config", "user.name", "Fixture");
            git(source, "config", "user.email", "fixture@example.test");
            writeFileSync(
                path.join(source, "source.txt"),
                "keep source separate",
            );
            git(source, "add", ".");
            git(source, "commit", "-m", "Source fixture");
            git(source, "remote", "add", "origin", remote);
            const sourceHead = git(source, "rev-parse", "HEAD");
            const first = stagePlugin(
                releaseFixture(dir, "1.0.0"),
                path.join(dir, "plugins"),
            );
            assert.equal(publishPlugin(source, first), true);
            const firstHead = git(
                source,
                "ls-remote",
                "origin",
                "refs/heads/plugin",
            ).split(/\s/)[0];
            assert.equal(publishPlugin(source, first), false);
            const second = stagePlugin(
                releaseFixture(dir, "1.1.0"),
                path.join(dir, "plugins"),
            );
            assert.equal(publishPlugin(source, second), true);
            git(source, "fetch", "origin", "plugin");
            assert.equal(git(source, "rev-parse", "FETCH_HEAD^"), firstHead);
            assert.equal(git(source, "rev-parse", "HEAD"), sourceHead);
            assert.equal(git(source, "status", "--porcelain"), "");
            assert.throws(
                () => publishPlugin(source, first),
                /newer|different/,
            );
            const acquired = path.join(dir, "acquired");
            git(
                dir,
                "-c",
                "core.autocrlf=true",
                "clone",
                "--branch",
                "plugin",
                remote,
                acquired,
            );
            verifyPluginEvidence(acquired, "a".repeat(40));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
