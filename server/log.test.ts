import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createLogger, setSession } from "./log.ts";

test("startup diagnostics reach stderr without a Copilot session", () => {
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
            import { logger } from "./server/log.ts";
            logger.info("Startup complete");
        `,
        ],
        { encoding: "utf8", env: { ...process.env, ARGUS_LOG_LEVEL: "info" } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        (JSON.parse(result.stderr.trim()) as { msg: string }).msg,
        "Startup complete",
    );
});

test("levels filter records and child loggers keep context", () => {
    const lines: string[] = [];
    const logger = createLogger("warn", { write: (line) => lines.push(line) });
    const child = logger.child({ component: "poller", runId: 7 });
    child.info("Not emitted");
    child.warn({ failed: 2 }, "Enrichment incomplete");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
        level: 40,
        time: (JSON.parse(lines[0]) as { time: number }).time,
        pid: process.pid,
        name: "argus",
        component: "poller",
        runId: 7,
        failed: 2,
        msg: "Enrichment incomplete",
    });
});

test("invalid log levels report the problem and use info", () => {
    const lines: string[] = [];
    const logger = createLogger("not-a-level", {
        write: (line) => lines.push(line),
    });
    logger.info("Ready");
    assert.equal(logger.level, "info");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Invalid ARGUS_LOG_LEVEL/);
    assert.doesNotMatch(lines[0], /not-a-level/);
});

test("error records omit upstream text and redact sensitive fields", () => {
    const lines: string[] = [];
    const logger = createLogger("debug", { write: (line) => lines.push(line) });
    const err = Object.assign(new Error("private-upstream-text"), {
        code: "ETIMEDOUT",
        status: 503,
        token: "private-token",
        response: { body: "private-body" },
    });
    logger.error(
        {
            err,
            token: "private-token",
            title: "private-title",
            description: "private-description",
        },
        "Request failed",
    );
    const record = JSON.parse(lines[0]) as {
        err: { type: string; code: string; status: number; stack: string };
    };
    assert.equal(record.err.type, "Error");
    assert.equal(record.err.code, "ETIMEDOUT");
    assert.equal(record.err.status, 503);
    assert.match(record.err.stack, /log.test.ts/);
    assert.doesNotMatch(lines[0], /private-/);
});

test("multiline error messages cannot appear as stack frames", () => {
    const lines: string[] = [];
    const logger = createLogger("error", {
        write: (line) => lines.push(line),
    });
    const err = new Error(
        "Upstream failure\n    at private-upstream-text\n    at private-token",
    );
    logger.error({ err }, "Request failed");
    const record = JSON.parse(lines[0]) as { err: { stack: string } };
    assert.match(record.err.stack, /log.test.ts/);
    assert.doesNotMatch(lines[0], /private-/);
});

test("session output uses the same filtered and redacted records", async () => {
    const lines: string[] = [];
    const messages: string[] = [];
    setSession({
        log: async (message) => {
            messages.push(message);
        },
    });

    try {
        const logger = createLogger("warn", {
            write: (line) => lines.push(line),
        });
        logger.info("Hidden");
        logger.error({ token: "private-token" }, "Request failed");
        await Promise.resolve();
        assert.equal(messages.length, 1);
        assert.deepEqual(JSON.parse(messages[0]), JSON.parse(lines[0]));
        assert.doesNotMatch(messages[0], /private-token/);
    } finally {
        setSession(null);
    }
});

test("session delivery failure keeps stderr available and warns once", async () => {
    const lines: string[] = [];
    setSession({
        log: async () => {
            throw new Error("private-delivery-error");
        },
    });
    try {
        const logger = createLogger("info", {
            write: (line) => lines.push(line),
        });
        logger.info("First");
        await Promise.resolve();
        logger.info("Second");
        await Promise.resolve();
        assert.equal(lines.length, 3);
        assert.match(lines[1], /diagnostics remain on stderr/);
        assert.match(lines[2], /Second/);
        assert.doesNotMatch(lines.join(""), /private-/);
    } finally {
        setSession(null);
    }
});
