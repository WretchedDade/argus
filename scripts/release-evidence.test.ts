import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    payloadChecksums,
    releaseStage,
    resetReleaseStage,
    writeReleaseEvidence,
    verifyReleaseEvidence,
} from "./release-evidence.ts";

const dir = mkdtempSync(path.join(tmpdir(), "argus-release-test-"));
try {
    const output = path.join(dir, "acquired");
    mkdirSync(output);
    const sibling = path.join(output, "keep.zip");
    writeFileSync(sibling, "unrelated acquired artifact");
    const stage = resetReleaseStage(output, "0.1.0");
    writeFileSync(path.join(stage, "stale"), "old");
    assert.equal(resetReleaseStage(output, "0.1.0"), stage);
    assert.ok(!existsSync(path.join(stage, "stale")));
    assert.equal(readFileSync(sibling, "utf8"), "unrelated acquired artifact");
    for (const version of ["../", "..\\other", "0.1.0/../../", "", "v0.1.0"])
        assert.throws(() => releaseStage(output, version), /Invalid release/);
    assert.equal(
        releaseStage(output, "1.2.3-beta.1"),
        path.join(output, "argus-1.2.3-beta.1"),
    );

    const source = path.join(dir, "source");
    mkdirSync(source);
    writeFileSync(path.join(source, "package.json"), '{"version":"0.1.0"}');
    const lock = {
        packages: {
            "node_modules/runtime": {
                version: "1.0.0",
                resolved:
                    "https://registry.npmjs.org/runtime/-/runtime-1.0.0.tgz",
                integrity: "sha512-fixture",
            },
            "node_modules/dev-only": { version: "2.0.0", dev: true },
        },
    };
    writeFileSync(path.join(source, "package-lock.json"), JSON.stringify(lock));
    const runtime = path.join(stage, "extension/node_modules/runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({
            name: "runtime",
            version: "1.0.0",
            license: "MIT",
        }),
    );
    writeFileSync(path.join(runtime, "LICENSE"), "fixture license");
    const entry = path.join(stage, "extension/extension.mjs");
    writeFileSync(entry, "export default {};");
    for (const file of [
        "extension/dist/index.html",
        "extension/skills/pr-review/SKILL.md",
        "extension/package.json",
        "extension/ado-auth-config.example.json",
        "INSTALL.md",
        "LICENSE",
    ]) {
        const target = path.join(stage, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, "fixture");
    }
    writeFileSync(
        path.join(stage, "extension/package.json"),
        '{"version":"0.1.0"}',
    );
    writeFileSync(
        path.join(stage, "extension/ado-auth-config.example.json"),
        '{"clientId":"","tenantId":""}',
    );
    writeReleaseEvidence(source, stage, {
        commit: "a".repeat(40),
        dirty: false,
    });
    const manifest = JSON.parse(
        readFileSync(path.join(stage, "release-manifest.json"), "utf8"),
    );
    assert.equal(manifest.packageVersion, "0.1.0");
    assert.equal(manifest.sourceCommit, "a".repeat(40));
    assert.equal(manifest.sourceDirty, false);
    assert.equal(manifest.dependencies.length, 1);
    assert.equal(manifest.dependencies[0].integrity, "sha512-fixture");
    assert.equal(manifest.dependencies[0].license, "MIT");
    verifyReleaseEvidence(stage);
    writeReleaseEvidence(source, stage, {
        commit: "a".repeat(40),
        dirty: false,
    });
    verifyReleaseEvidence(stage);
    assert.ok(manifest.files["extension/node_modules/runtime/LICENSE"]);
    assert.ok(!manifest.files["release-manifest.json"]);
    assert.equal(
        manifest.files["extension/extension.mjs"],
        createHash("sha256").update(readFileSync(entry)).digest("hex"),
    );
    writeFileSync(entry, "changed");
    assert.throws(() => verifyReleaseEvidence(stage), /checksum mismatch/);
    assert.notEqual(
        payloadChecksums(stage)["extension/extension.mjs"],
        manifest.files["extension/extension.mjs"],
    );
    writeFileSync(entry, "export default {};");
    writeFileSync(path.join(stage, "extra"), "unexpected");
    assert.throws(() => verifyReleaseEvidence(stage), /checksum mismatch/);
    rmSync(path.join(stage, "extra"));
    writeFileSync(path.join(stage, "extension/ado-auth-config.json"), "{}");
    writeReleaseEvidence(source, stage, {
        commit: "a".repeat(40),
        dirty: false,
    });
    assert.throws(() => verifyReleaseEvidence(stage), /writable user state/);
    rmSync(path.join(stage, "extension/ado-auth-config.json"));
    const link = path.join(stage, "linked-source");
    symlinkSync(
        source,
        link,
        process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => payloadChecksums(stage), /must not contain links/);
    rmSync(link);
} finally {
    rmSync(dir, { recursive: true, force: true });
}
console.log("release evidence self-check OK");
