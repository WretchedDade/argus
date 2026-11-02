export const DEFAULT_INGEST_PORT = 48100;

let port = DEFAULT_INGEST_PORT;

// Each entry point calls this once with the port it binds.
export function setIngestPort(value: number): void {
    port = value;
}

export function ingestUrl(): string {
    return `http://127.0.0.1:${port}/api/pr/record-review`;
}
