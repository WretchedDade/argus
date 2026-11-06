import type { IncomingMessage } from "node:http";

export class UntrustedRequestError extends Error {
    status: 403 | 415;
    constructor(status: 403 | 415, message: string) {
        super(message);
        this.status = status;
    }
}

// Blocks DNS rebinding (Host), cross-site requests (Origin), and simple
// cross-site form posts (JSON content type on mutating methods).
export function assertTrustedRequest(req: IncomingMessage): void {
    const port = req.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!req.headers.host || !hosts.includes(req.headers.host.toLowerCase()))
        throw new UntrustedRequestError(403, "Untrusted host.");

    const origin = req.headers.origin;
    if (
        origin !== undefined &&
        !hosts.some((host) => origin.toLowerCase() === `http://${host}`)
    )
        throw new UntrustedRequestError(403, "Untrusted origin.");

    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) {
        const type = (req.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
        if (type !== "application/json")
            throw new UntrustedRequestError(
                415,
                "Content-Type must be application/json.",
            );
    }
}
