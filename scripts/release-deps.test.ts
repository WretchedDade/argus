import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
    generateNotices,
    pruneLockfile,
    type Lockfile,
} from "./release-deps.ts";

const lock: Lockfile = {
    lockfileVersion: 3,
    packages: {
        "": { dependencies: { app: "1.0.0", react: "1.0.0" } },
        "node_modules/app": {
            version: "1.0.0",
            dependencies: { shared: "^1.0.0", nested: "^2.0.0" },
            peerDependencies: { opt: "*" },
            peerDependenciesMeta: { opt: { optional: true } },
        },
        "node_modules/shared": { version: "1.2.0" },
        "node_modules/nested": { version: "1.0.0" },
        "node_modules/app/node_modules/nested": {
            version: "2.0.0",
            dependencies: { shared: "^1.0.0" },
        },
        "node_modules/react": { version: "1.0.0" },
        "node_modules/opt": { version: "1.0.0" },
    },
};

test("pruneLockfile keeps only the runtime tree", () => {
    const pruned = pruneLockfile(lock, { name: "x", version: "9.9.9" }, [
        "app",
    ]);
    assert.deepEqual(Object.keys(pruned.packages), [
        "",
        "node_modules/app",
        "node_modules/app/node_modules/nested",
        "node_modules/shared",
    ]);
    assert.deepEqual(pruned.packages[""].dependencies, { app: "1.0.0" });
    assert.equal(pruned.packages["node_modules/shared"].version, "1.2.0");
});

test("pruneLockfile fails on a missing root or locked dependency", () => {
    const manifest = { name: "x", version: "1.0.0" };
    assert.throws(() => pruneLockfile(lock, manifest, ["nope"]), /not found/);
    const broken: Lockfile = {
        lockfileVersion: 3,
        packages: {
            "": {},
            "node_modules/a": { version: "1.0.0", dependencies: { b: "1" } },
        },
    };
    assert.throws(() => pruneLockfile(broken, manifest, ["a"]), /not locked/);
});

test("generateNotices lists each installed package with its license text", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "argus-notices-"));
    try {
        const pkg = path.join(dir, "node_modules/app");
        mkdirSync(pkg, { recursive: true });
        writeFileSync(
            path.join(pkg, "package.json"),
            JSON.stringify({ name: "app", version: "1.0.0", license: "MIT" }),
        );
        writeFileSync(path.join(pkg, "LICENSE.md"), "Fixture license text");
        const notices = generateNotices(
            dir,
            pruneLockfile(lock, { name: "x", version: "1.0.0" }, ["react"]),
        );
        assert.doesNotMatch(notices, /app 1\.0\.0/);
        const all = generateNotices(dir, {
            lockfileVersion: 3,
            packages: { "node_modules/app": { version: "1.0.0" } },
        });
        assert.match(all, /app 1\.0\.0\nLicense: MIT\n\nFixture license text/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
