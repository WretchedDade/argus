import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("lease recovery requires ownership and keeps failures deduplicated", async (t) => {
    const { ArgusStore } = await import("../db.ts");
    const { defaultConfig } = await import("../config.ts");
    const { logger } = await import("../log.ts");
    const { startPoller, stopPoller } = await import("./poller.ts");
    const store = new ArgusStore(":memory:");
    const lines: string[] = [];
    let outcome: "error" | "other-owner" | "acquired" = "error";
    t.mock.method(store, "acquirePollLease", () => {
        if (outcome === "error") throw new Error("private-lease-error");
        return outcome === "acquired";
    });
    t.mock.method(process.stderr, "write", (line: string) => {
        lines.push(line);
        return true;
    });
    t.mock.timers.enable({ apis: ["setInterval"] });
    const previousLevel = logger.level;
    logger.level = "info";
    try {
        startPoller({ store, getConfig: defaultConfig });
        assert.equal(lines.length, 1);
        assert.match(lines[0], /Poll lease renewal failed/);

        outcome = "other-owner";
        t.mock.timers.tick(30_000);
        assert.equal(lines.length, 1);

        outcome = "error";
        t.mock.timers.tick(30_000);
        assert.equal(lines.length, 1);

        outcome = "acquired";
        t.mock.timers.tick(30_000);
        assert.equal(lines.length, 2);
        assert.match(lines[1], /Poll lease renewal recovered/);
        t.mock.timers.tick(30_000);
        assert.equal(lines.length, 2);

        outcome = "error";
        t.mock.timers.tick(30_000);
        assert.equal(lines.length, 3);
        assert.match(lines[2], /Poll lease renewal failed/);
        assert.doesNotMatch(lines.join(""), /private-/);
    } finally {
        stopPoller();
        logger.level = previousLevel;
        store.close();
    }
});

for (const mode of [
    "success",
    "partial",
    "failure",
    "cleanup-failure",
    "silent",
    "debug",
]) {
    test(`poll diagnostics: ${mode}`, () => {
        const result = spawnSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
            import childProcess from "node:child_process";
            import fs from "node:fs";
            import { syncBuiltinESMExports } from "node:module";
            const mode = process.env.ARGUS_TEST_MODE;
            const partial = mode === "partial";
            const pr = {
                pullRequestId: 7, title: "private-title", description: "private-description",
                status: "active", isDraft: false, creationDate: new Date().toISOString(),
                createdBy: { uniqueName: "reviewer@example.test", displayName: "Example" },
                repository: { name: "example", id: "repo-id", project: { id: "project-id" } },
                lastMergeSourceCommit: { commitId: "example-sha" },
                sourceRefName: "refs/heads/example", targetRefName: "refs/heads/main",
            };
            const exists = fs.existsSync;
            fs.existsSync = file =>
                typeof file === "string" && /[\\\\/](az.cmd|python.exe)$/.test(file)
                    ? true : exists(file);
            childProcess.execFile = (_file, args, _options, callback) => {
                const list = args.includes("list") && !args.includes("policy");
                const fail = (mode === "failure" && list) ||
                    (partial && !list && !args.includes("get-access-token"));
                const value = list ? [pr] : args.includes("get-access-token")
                    ? { accessToken: "private-token" } : args.includes("commits")
                    ? { committer: { date: new Date().toISOString() } }
                    : args.includes("policy") ? [] : { value: [] };
                queueMicrotask(() => callback(
                    fail ? new Error("private-upstream-text") : null,
                    { stdout: Buffer.from(JSON.stringify(value)), stderr: Buffer.alloc(0) },
                ));
                return {};
            };
            syncBuiltinESMExports();
            globalThis.fetch = async () => partial ? new Response(null, { status: 400 })
                : Response.json({ changes: [], allChangesIncluded: true });
            const { ArgusStore } = await import(${JSON.stringify(new URL("../db.ts", import.meta.url).href)});
            const { defaultConfig } = await import(${JSON.stringify(new URL("../config.ts", import.meta.url).href)});
            const { reconcileOnce, stopPoller } = await import(${JSON.stringify(new URL("./poller.ts", import.meta.url).href)});
            const store = new ArgusStore(":memory:");
            if (mode === "cleanup-failure")
                store.pruneLogs = () => { throw new Error("private-upstream-text"); };
            try {
                const summary = await reconcileOnce({ store, getConfig: () => ({
                    ...defaultConfig(), adoAuth: "az", me: "reviewer@example.test",
                    orgUrl: "https://dev.azure.com/example", orgSlug: "example", project: "Project",
                }) });
                process.stdout.write(JSON.stringify({
                    summary,
                    activity: store.listActivity().length,
                    runs: store.listPollRuns(),
                }));
            } finally { stopPoller(); store.close(); }
        `,
            ],
            {
                encoding: "utf8",
                timeout: 10_000,
                env: {
                    ...process.env,
                    PATH: "C:\\argus-test\\wbin",
                    NODE_NO_WARNINGS: "1",
                    ARGUS_TEST_MODE: mode,
                    ARGUS_LOG_LEVEL:
                        mode === "silent"
                            ? "silent"
                            : mode === "debug"
                              ? "debug"
                              : "info",
                },
            },
        );
        assert.equal(result.status, 0, result.stderr);
        const records = result.stderr
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(
                (line) =>
                    JSON.parse(line) as {
                        level: number;
                        msg: string;
                        runId: number;
                        durationMs?: number;
                        failures?: Record<string, number>;
                    },
            );
        const saved = JSON.parse(result.stdout) as {
            summary: unknown;
            activity: number;
            runs: { ok: boolean }[];
        };
        assert.ok(
            saved.activity > (mode === "failure" ? 0 : 5),
            "Detailed UI activity is kept at every log level",
        );
        assert.equal(saved.runs.length, 1);
        const failed = mode === "failure" || mode === "cleanup-failure";
        assert.equal(saved.runs[0].ok, !failed);
        assert.doesNotMatch(result.stderr, /private-/);
        if (mode === "silent") {
            assert.equal(records.length, 0);
        } else if (failed) {
            assert.equal(saved.summary, null);
            assert.equal(records.length, 1);
            assert.equal(records[0].level, 50);
            assert.equal(records[0].msg, "Poll failed");
        } else {
            const summaries = records.filter((r) => r.msg === "Poll completed");
            assert.equal(summaries.length, 1);
            assert.ok(summaries[0].durationMs! >= 0);
            assert.ok(records.every((r) => r.runId === 1));
            if (mode === "partial") {
                assert.equal(records.length, 2);
                assert.equal(records[0].level, 40);
                assert.deepEqual(records[0].failures, {
                    commitTime: 1,
                    policies: 1,
                    authorComments: 1,
                    reviewComments: 0,
                    changedFiles: 1,
                });
            } else if (mode === "debug") {
                assert.ok(records.some((r) => r.level === 20));
            } else {
                assert.equal(records.length, 1);
            }
        }
    });
}
