// Short, user-facing text for an unknown thrown value.
export function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string" && err) return err;
    return "Something went wrong.";
}

// The setup form copies the config into state once, so it must mount after the config loads.
export function setupFormReady(query: { isSuccess: boolean }): boolean {
    return query.isSuccess;
}

// A failed Argus API call. `serverMessage` is the `error` text from the JSON body, if any.
export class ApiError extends Error {
    readonly status: number;
    readonly path: string;
    readonly serverMessage: string | null;

    constructor(path: string, status: number, serverMessage: string | null) {
        super(serverMessage ?? `${path} -> ${status}`);
        this.name = "ApiError";
        this.path = path;
        this.status = status;
        this.serverMessage = serverMessage;
    }
}

export interface LoadFailure {
    headline: string;
    reason: string;
    steps: string[];
    technical: string;
}

// Explain a failed load for a developer: what failed, why, and what to try.
export function describeLoadFailure(err: unknown, what: string): LoadFailure {
    const technical = errorMessage(err);
    const headline = `Couldn't load ${what}`;

    if (err instanceof ApiError) {
        const where = `The Argus server answered ${err.path} with HTTP ${err.status}`;
        const detail = err.serverMessage ? `: ${err.serverMessage}` : ".";
        if (err.status === 401 || err.status === 403) {
            return {
                headline,
                reason: `${where}. The server refused the request.`,
                steps: [
                    "Reload the page. The browser may hold a stale session.",
                    "Open Argus from its own address, not through a proxy or another host name.",
                ],
                technical,
            };
        }
        if (err.status >= 500) {
            return {
                headline,
                reason: `${where}. The server failed while it handled the request${detail}`,
                steps: [
                    "Press Retry. A short database or poller problem often clears by itself.",
                    "Read the server log: the Activity page, or the terminal that runs Argus.",
                    "If it keeps happening, check that the database file is not locked or corrupt.",
                ],
                technical,
            };
        }
        return {
            headline,
            reason: `${where}. The server did not accept the request${detail}`,
            steps: [
                "Reload the page. The page and the server may be on different versions.",
                "If you just updated Argus, restart it.",
            ],
            technical,
        };
    }

    if (
        err instanceof TypeError &&
        /fetch|network|load failed/i.test(err.message)
    ) {
        return {
            headline,
            reason: "The page could not reach the Argus server. The server is probably stopped or restarting.",
            steps: [
                "Check that the terminal or app that runs Argus is still running.",
                "Start Argus again, then press Retry.",
            ],
            technical,
        };
    }

    return {
        headline,
        reason: `The server answered, but the page could not use the answer (${technical}). The data may be in an unexpected shape.`,
        steps: [
            "Reload the page. The page and the server may be on different versions.",
            "If you just updated Argus, restart it so the server and page match.",
        ],
        technical,
    };
}
