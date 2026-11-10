import type { Session } from "@github/copilot-sdk/extension";
import pino, { type DestinationStream } from "pino";

let session: Pick<Session, "log"> | null = null;
let sessionFailed = false;

export function setSession(s: Pick<Session, "log"> | null): void {
    session = s;
    sessionFailed = false;
}

// Upstream errors can include credentials, CLI output, or PR text.
export function diagnosticError(error: unknown): {
    type: string;
    code?: string;
    status?: number;
    stack?: string;
} {
    if (!(error instanceof Error)) return { type: "UnknownError" };
    const code = "code" in error ? error.code : undefined;
    const status = "status" in error ? error.status : undefined;
    const type = error.constructor.name;
    const stack = error.stack;
    const header = Error.prototype.toString.call(error);
    const frames = stack?.startsWith(header)
        ? stack.slice(header.length)
        : undefined;
    return {
        type: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(type) ? type : "Error",
        ...(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
            ? { code }
            : {}),
        ...(typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
            ? { status }
            : {}),
        stack: frames
            ?.split("\n")
            .filter((line) => /^\s+at /.test(line))
            .join("\n"),
    };
}

export function createLogger(
    level = process.env.ARGUS_LOG_LEVEL ?? "info",
    destination: DestinationStream = process.stderr,
) {
    const valid =
        Object.hasOwn(pino.levels.values, level) || level === "silent";
    const output: DestinationStream = {
        write(line) {
            destination.write(line);
            if (!session || sessionFailed) return;
            const target = session;
            const record = JSON.parse(line) as { level: number };
            const hostLevel =
                record.level >= 50
                    ? "error"
                    : record.level >= 40
                      ? "warn"
                      : record.level <= 20
                        ? "debug"
                        : "info";
            void target.log(line.trimEnd(), { level: hostLevel }).catch(() => {
                if (session !== target || sessionFailed) return;
                sessionFailed = true;
                result.warn(
                    "Copilot log delivery failed; diagnostics remain on stderr",
                );
            });
        },
    };
    const result = pino(
        {
            name: "argus",
            base: { pid: process.pid },
            level: valid ? level : "info",
            serializers: { err: diagnosticError },
            redact: {
                paths: [
                    "token",
                    "accessToken",
                    "authorization",
                    "title",
                    "description",
                    "body",
                    "headers",
                    "*.token",
                    "*.accessToken",
                    "*.authorization",
                    "*.title",
                    "*.description",
                    "*.body",
                    "*.headers",
                ],
                remove: true,
            },
        },
        output,
    );
    if (!valid) result.warn("Invalid ARGUS_LOG_LEVEL; using info");
    return result;
}

export const logger = createLogger();
