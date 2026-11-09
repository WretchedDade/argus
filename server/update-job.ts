import { logger } from "./log.ts";

const log = logger.child({ component: "update" });

export type UpdatePhase =
    | "idle"
    | "downloading"
    | "verifying"
    | "extracting"
    | "installing"
    | "done"
    | "error";

export interface UpdateStatus {
    phase: UpdatePhase;
    error: string | null;
}

// Runs one update at a time in the background. The status survives the UI
// closing, because the server holds it, not the client.
export class UpdateJob {
    #status: UpdateStatus = { phase: "idle", error: null };

    status(): UpdateStatus {
        return { ...this.#status };
    }

    get running(): boolean {
        return !["idle", "done", "error"].includes(this.#status.phase);
    }

    // Returns false when an update is already running.
    start(run: (setPhase: (p: UpdatePhase) => void) => Promise<void>): boolean {
        if (this.running) return false;
        const started = performance.now();
        log.debug("App update started");
        this.#status = { phase: "downloading", error: null };
        void run((phase) => {
            this.#status = { phase, error: null };
            log.debug({ phase }, "App update progress");
        }).then(
            () => {
                this.#status = { phase: "done", error: null };
                log.info(
                    { durationMs: Math.round(performance.now() - started) },
                    "App update completed; reload extensions",
                );
            },
            (err: unknown) => {
                log.error(
                    {
                        err,
                        phase: this.#status.phase,
                        durationMs: Math.round(performance.now() - started),
                    },
                    "App update failed",
                );
                this.#status = {
                    phase: "error",
                    error: err instanceof Error ? err.message : String(err),
                };
            },
        );
        return true;
    }
}
