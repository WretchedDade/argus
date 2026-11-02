import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    localDbPath,
    migrateToChoice,
    oneDriveDbPath,
    readChoice,
    resolveDbFile,
    writeChoice,
} from "./storage.ts";
import { ArgusStore } from "./db.ts";

const root = mkdtempSync(path.join(tmpdir(), "argus-storage-test-"));
const localAppData = path.join(root, "Local");
const oneDrive = path.join(root, "OneDrive");
const s = { env: { LOCALAPPDATA: localAppData, OneDrive: oneDrive } };
const local = path.join(localAppData, "argus", "argus.db");
const old = path.join(oneDrive, "Desktop", "argus.db");

assert.equal(localDbPath(s), local);
assert.equal(oneDriveDbPath(s.env), old);
assert.equal(oneDriveDbPath({}), null);

// Fresh install: local, even when OneDrive exists.
let r = resolveDbFile(s);
assert.deepEqual([r.file, r.source, r.legacyPath], [local, "default", null]);

// Existing OneDrive file and no local file: keep the old path and flag it.
mkdirSync(path.dirname(old), { recursive: true });
writeFileSync(old, "");
r = resolveDbFile(s);
assert.deepEqual([r.file, r.source, r.legacyPath], [old, "legacy", old]);

// After the user moves the file, the local one wins.
mkdirSync(path.dirname(local), { recursive: true });
writeFileSync(local, "");
r = resolveDbFile(s);
assert.deepEqual([r.file, r.source], [local, "default"]);
rmSync(local);

// A saved choice beats the legacy rule and clears the notice.
assert.equal(readChoice(s), null);
writeChoice(s, "onedrive");
assert.equal(readChoice(s), "onedrive");
r = resolveDbFile(s);
assert.deepEqual([r.file, r.source, r.legacyPath], [old, "choice", null]);
writeChoice(s, "local");
r = resolveDbFile(s);
assert.deepEqual([r.file, r.location], [local, "local"]);

// "onedrive" without OneDrive falls back to local.
r = resolveDbFile({ env: { LOCALAPPDATA: localAppData } });
assert.equal(r.file, local);

// ARGUS_DB_FILE beats everything.
r = resolveDbFile({ env: { ...s.env, ARGUS_DB_FILE: "X:\\custom.db" } });
assert.deepEqual(
    [r.file, r.source, r.location],
    ["X:\\custom.db", "env", null],
);

// copyTo makes a usable snapshot and refuses to overwrite.
const src = new ArgusStore(path.join(root, "src.db"));
src.markSetupComplete();
const copy = path.join(root, "nested", "copy.db");
src.copyTo(copy);
src.close();
const dup = new ArgusStore(copy);
assert.equal(dup.isSetupComplete(), true);
dup.close();
assert.throws(() => {
    const again = new ArgusStore(path.join(root, "src.db"));
    try {
        again.copyTo(copy);
    } finally {
        again.close();
    }
});

// A chosen location with no file yet gets a consistent copy at startup.
const copyRoot = mkdtempSync(path.join(tmpdir(), "argus-storage-copy-"));
const cs = {
    env: {
        LOCALAPPDATA: path.join(copyRoot, "Local"),
        OneDrive: path.join(copyRoot, "OD"),
    },
    extensionDir: path.join(copyRoot, "ext"),
};
const extDb = path.join(cs.extensionDir, "data", "argus.db");
const seed = new ArgusStore(extDb);
seed.markSetupComplete();
seed.close();
// Older no-OneDrive installs keep their extension-folder database.
r = resolveDbFile(cs);
assert.deepEqual([r.file, r.source, r.legacyPath], [extDb, "legacy", null]);
assert.equal(migrateToChoice(cs, r), null);
// Choosing local copies it once; the source stays as a backup.
writeChoice(cs, "local");
r = resolveDbFile(cs);
assert.equal(migrateToChoice(cs, r), extDb);
const moved = new ArgusStore(r.file);
assert.equal(moved.isSetupComplete(), true);
moved.close();
// A second start does not replace the new file.
assert.equal(migrateToChoice(cs, r), null);
rmSync(copyRoot, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log("storage tests passed");
