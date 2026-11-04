import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ArgusStore } from "../db.ts";
import { migrations, runMigrations, type Migration } from "./migrations.ts";

const version = (db: DatabaseSync): number =>
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version;

const columns = (db: DatabaseSync, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
    );

function withDir(run: (dir: string) => void | Promise<void>) {
    return async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "argus-migrations-"));
        try {
            await run(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

test(
    "a new database ends at the latest version",
    withDir((dir) => {
        const file = path.join(dir, "new.db");
        new ArgusStore(file).close();
        const db = new DatabaseSync(file);
        assert.equal(version(db), migrations.length);
        assert.ok(columns(db, "prs").includes("changed_files_sha"));
        db.close();
    }),
);

test(
    "a database from before versioning keeps its rows and gets a version",
    withDir((dir) => {
        const file = path.join(dir, "old.db");
        new ArgusStore(file).close();
        const old = new DatabaseSync(file);
        old.exec(`
            INSERT INTO prs (canonical, title, added_at, updated_at)
            VALUES ('pr-1', 'Old PR', '2025-01-01', '2025-01-01');
            PRAGMA user_version = 0;
        `);
        old.close();

        new ArgusStore(file).close();

        const db = new DatabaseSync(file);
        assert.equal(version(db), migrations.length);
        const titles = (
            db.prepare("SELECT title FROM prs").all() as { title: string }[]
        ).map((r) => r.title);
        assert.deepEqual(titles, ["Old PR"]);
        db.close();
    }),
);

test(
    "reopening a current database runs no migration",
    withDir((dir) => {
        const db = new DatabaseSync(path.join(dir, "current.db"));
        let runs = 0;
        const list: Migration[] = [{ up: () => void runs++ }];
        runMigrations(db, list);
        runMigrations(db, list);
        assert.equal(runs, 1);
        assert.equal(version(db), 1);
        db.close();
    }),
);

test(
    "a failed migration rolls back the whole batch",
    withDir((dir) => {
        const db = new DatabaseSync(path.join(dir, "fail.db"));
        const list: Migration[] = [
            { up: (d) => d.exec("CREATE TABLE a (x INTEGER)") },
            {
                up: () => {
                    throw new Error("boom");
                },
            },
        ];
        assert.throws(() => runMigrations(db, list), /boom/);
        assert.equal(version(db), 0);
        assert.equal(db.prepare("PRAGMA table_info(a)").all().length, 0);
        db.close();
    }),
);

test(
    "upsertPr fills the reviewed sha date once the cached head catches up",
    withDir((dir) => {
        const file = path.join(dir, "catchup.db");
        const store = new ArgusStore(file);
        const authoredAt = (): string | null => {
            const raw = new DatabaseSync(file);
            const row = raw
                .prepare("SELECT reviewed_sha_authored_at AS a FROM prs")
                .get() as { a: string | null };
            raw.close();
            return row.a;
        };
        const pr = (sha: string, at: string) => ({
            canonical: "pr-1",
            org: "o",
            project: "p",
            repo: "r",
            number: 1,
            title: "t",
            description: "",
            author: "a",
            isVendor: false,
            role: "reviewer" as const,
            teams: [],
            isDraft: false,
            lastCommitSha: sha,
            lastCommitAt: at,
            prCreatedAt: null,
            sourceBranch: "f",
            targetBranch: "main",
        });
        store.upsertPr(pr("sha-1", "2025-01-01T00:00:00Z"));
        store.recordReview("pr-1", { sha: "sha-2" });
        assert.equal(authoredAt(), null);

        store.upsertPr(pr("sha-2", "2025-01-02T00:00:00Z"));
        assert.equal(authoredAt(), "2025-01-02T00:00:00Z");
        store.close();
    }),
);

test(
    "three processes opening the same new file at once all succeed",
    withDir(async (dir) => {
        const file = path.join(dir, "race.db");
        const dbModule = pathToFileURL(
            path.resolve(import.meta.dirname, "../db.ts"),
        ).href;
        // Each worker imports first, then spins until a shared start time, so the opens collide.
        const startAt = Date.now() + 1500;
        const script = `const { ArgusStore } = await import(${JSON.stringify(dbModule)}); while (Date.now() < ${startAt}) {} new ArgusStore(${JSON.stringify(file)}).close();`;
        const open = () =>
            new Promise<{ code: number | null; stderr: string }>((resolve) => {
                const child = spawn(
                    process.execPath,
                    ["--input-type=module", "-e", script],
                    { stdio: ["ignore", "ignore", "pipe"] },
                );
                let stderr = "";
                child.stderr.on("data", (d) => (stderr += d));
                child.on("close", (code) => resolve({ code, stderr }));
            });
        const results = await Promise.all([open(), open(), open()]);
        for (const r of results) assert.equal(r.code, 0, r.stderr);
        const db = new DatabaseSync(file);
        assert.equal(version(db), migrations.length);
        db.close();
    }),
);
