import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function checkShutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
    const dir = mkdtempSync(path.join(tmpdir(), "argus-standalone-test-"));
    const entry = new URL("./standalone.ts", import.meta.url).href;
    const child = spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
                import childProcess from "node:child_process";
                import { syncBuiltinESMExports } from "node:module";
                childProcess.execFile = () => {
                    process.send("az-pending");
                    return {};
                };
                syncBuiltinESMExports();
                process.on("message", signal => process.emit(signal));
                await import(${JSON.stringify(entry)});
            `,
        ],
        {
            env: {
                ...process.env,
                ARGUS_DB_FILE: path.join(dir, "standalone.db"),
                ARGUS_CONFIG_FILE: path.join(dir, "config.json"),
                ARGUS_INGEST_PORT: "0",
                ARGUS_STANDALONE_ID: path.basename(dir),
                ARGUS_ME: "reviewer@example.test",
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
    );
    const { stdout, stderr } = child;
    assert.ok(stdout && stderr);
    const exited = once(child, "exit");
    let output = "";
    stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () =>
                reject(new Error(`Standalone ${signal} timed out: ${output}`)),
            8000,
        );
    });
    try {
        const ready = new Promise<string>((resolve) => {
            stdout.on("data", (chunk: Buffer) => {
                output += chunk.toString();
                const match =
                    /Argus standalone: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(
                        output,
                    );
                if (match) resolve(match[1]);
            });
        });
        const url = await Promise.race([ready, deadline]);
        const pending = once(child, "message");
        const refresh = fetch(`${url}api/refresh`, {
            method: "POST",
            signal: controller.signal,
        }).then(
            () => "completed",
            () => "disconnected",
        );
        assert.deepEqual(await Promise.race([pending, deadline]), [
            "az-pending",
            undefined,
        ]);
        assert.equal(
            (await (await fetch(`${url}api/health`)).json()).poller.running,
            true,
        );
        const started = Date.now();
        child.send(signal);
        const [code, exitSignal] = await Promise.race([exited, deadline]);
        assert.equal(code, 0, output);
        assert.equal(exitSignal, null, output);
        assert.ok(Date.now() - started < 3000, "Shutdown must be bounded");
        assert.equal(await refresh, "disconnected");
    } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await exited;
        }
        rmSync(dir, { recursive: true, force: true });
    }
}

await checkShutdown("SIGINT");
await checkShutdown("SIGTERM");
console.log("standalone shutdown self-check OK");
