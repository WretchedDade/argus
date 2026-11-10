import { createServer, type Server } from "node:http";
import type { ApiContext } from "./api.ts";
import { createHonoHandler } from "./app.ts";
import { parseFaults } from "./faults.ts";
import { logger } from "./log.ts";

const log = logger.child({ component: "http" });

const STABLE_PORT_BASE = 48200;
const STABLE_PORT_SPAN = 1000;

export interface Instance {
    instanceId: string;
    server: Server | null;
    url: string | null;
}

export interface ServerContext extends ApiContext {
    distDir: string;
}

// Derive a stable loopback port from the instance id so the canvas URL survives
// process restarts. Base is clear of pr-tracker's range (47100-48099).
function stablePort(instanceId: string): number {
    let hash = 0;
    for (const ch of instanceId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return STABLE_PORT_BASE + (Math.abs(hash) % STABLE_PORT_SPAN);
}

export async function startServer(
    instance: Instance,
    ctx: ServerContext,
): Promise<void> {
    const faults = parseFaults(process.env.ARGUS_FAKE_FAULT);
    const server = createServer(
        createHonoHandler(ctx, { distDir: ctx.distDir, faults }),
    );

    // Prefer the stable port; fall back to an ephemeral one if it's taken.
    const port = stablePort(instance.instanceId);
    await new Promise<void>((resolve) => {
        server.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE")
                log.debug(
                    { port },
                    "Canvas port occupied; using an ephemeral port",
                );
            else
                log.warn(
                    { err, port },
                    "Canvas listener failed; trying an ephemeral port",
                );
            server.listen(0, "127.0.0.1", resolve);
        });
        server.listen(port, "127.0.0.1", resolve);
    });
    const address = server.address();
    const boundPort =
        typeof address === "object" && address ? address.port : port;
    instance.server = server;
    instance.url = `http://127.0.0.1:${boundPort}/`;
}

export async function stopInstance(instance: Instance): Promise<void> {
    if (!instance.server) return;
    await new Promise<void>((resolve) =>
        instance.server!.close(() => resolve()),
    );
    instance.server = null;
}

// Headless ingest server on a fixed, well-known port, started once at module
// load — independent of any open canvas. Lets a review session record its
// verdict (and Clio read PR activity) with plain HTTP (no canvas, no per-session
// extension host).
//
// Argus is a user-scoped extension, so MANY hosts (one per session) run this at
// once. Exactly one must own the port. Rule: the first host to bind wins and
// holds it; every other host does NOT steal it (stealing caused port flapping
// where hosts ping-ponged ownership and left gaps). Instead each non-owner keeps
// a low-frequency watch and only binds if the port becomes FREE (the owner
// exited) — self-healing without a reload, but never disrupting a live owner.
// All hosts share the same DB, so a POST to whoever owns it always lands. This
// stays independent of any open canvas on purpose: a review session records its
// verdict headlessly with no canvas open anywhere. (The poller is separate — it
// runs in the canvas-open host; see extension.ts.)
export interface IngestHandle {
    close: () => void;
}

export function startIngestServer(
    ctx: ServerContext,
    port: number,
): IngestHandle {
    const server = createServer(createHonoHandler(ctx));

    let bound = false;
    let bindErrorCode: string | null = null;
    let watch: ReturnType<typeof setInterval> | null = null;

    const attempt = () =>
        new Promise<boolean>((resolve) => {
            const onError = (err: NodeJS.ErrnoException) => {
                const code = err.code ?? "UNKNOWN";
                if (code !== "EADDRINUSE" && code !== bindErrorCode)
                    log.warn(
                        { err, port },
                        "Ingest listener could not bind; will retry",
                    );
                bindErrorCode = code;
                resolve(false);
            };
            server.once("error", onError);
            server.listen(port, "127.0.0.1", () => {
                server.removeListener("error", onError);
                resolve(true);
            });
        });

    const tryBind = async () => {
        if (bound) return;
        if (await attempt()) {
            bound = true;
            bindErrorCode = null;
            if (watch) {
                clearInterval(watch);
                watch = null;
            }
            log.debug({ port }, "Ingest server listening");
        }
    };

    void tryBind().then(() => {
        if (!bound) {
            log.debug(
                { port },
                "Ingest port owned by another host; watching for availability",
            );
            watch = setInterval(() => void tryBind(), 5000);
        }
    });

    return {
        close: () => {
            if (watch) {
                clearInterval(watch);
                watch = null;
            }
            if (bound) server.close();
        },
    };
}
