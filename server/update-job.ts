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
        this.#status = { phase: "downloading", error: null };
        void run((phase) => {
            this.#status = { phase, error: null };
        }).then(
            () => {
                this.#status = { phase: "done", error: null };
            },
            (err: unknown) => {
                this.#status = {
                    phase: "error",
                    error: err instanceof Error ? err.message : String(err),
                };
            },
        );
        return true;
    }
}
