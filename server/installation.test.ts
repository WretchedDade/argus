import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { readInstallation } from "./installation.ts";

describe("server/installation", () => {
    it("distinguishes plugin payloads from ZIP and source installs", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-installation-"));
        try {
            const extension = path.join(dir, "extension");
            mkdirSync(extension);
            writeFileSync(
                path.join(dir, "package.json"),
                '{"version":"1.0.0"}',
            );
            assert.deepEqual(readInstallation(extension), {
                version: "1.0.0",
                plugin: false,
            });
            const file = path.join(extension, "package.json");
            writeFileSync(file, '{"version":"1.1.0"}');
            assert.deepEqual(readInstallation(extension), {
                version: "1.1.0",
                plugin: false,
            });
            writeFileSync(
                file,
                '{"version":"1.2.0","argusDistribution":"plugin"}',
            );
            assert.deepEqual(readInstallation(extension), {
                version: "1.2.0",
                plugin: true,
            });
            writeFileSync(file, "{");
            assert.throws(() => readInstallation(extension));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
