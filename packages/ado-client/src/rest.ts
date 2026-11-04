import type { AdoAuth } from "./auth.ts";
import { AuthInteractionRequiredError } from "./auth.ts";
import {
    isTransientError,
    parseRetryAfter,
    withRetry,
    withTimeout,
} from "./retry.ts";

const REQUEST_TIMEOUT_MS = 30_000;

export class AdoHttpError extends Error {
    readonly status: number;
    readonly body: string;
    readonly retryAfterMs?: number;

    constructor(
        message: string,
        status: number,
        body: string,
        retryAfterMs?: number,
    ) {
        super(message);
        this.name = "AdoHttpError";
        this.status = status;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }
}

export function isAllowedAdoHost(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        return (
            host === "dev.azure.com" ||
            host.endsWith(".dev.azure.com") ||
            host.endsWith(".visualstudio.com")
        );
    } catch {
        return false;
    }
}

async function errorText(response: Response): Promise<string> {
    const text = await response.text();
    if (!text) return response.statusText;
    try {
        const parsed = JSON.parse(text) as { message?: string };
        return parsed.message || text;
    } catch {
        return text;
    }
}

export class AdoRestClient {
    private readonly auth: AdoAuth;
    private readonly options: { timeoutMs: number; baseDelayMs?: number };

    constructor(
        auth: AdoAuth,
        options: { timeoutMs?: number; baseDelayMs?: number } = {},
    ) {
        this.auth = auth;
        this.options = {
            timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
            baseDelayMs: options.baseDelayMs,
        };
    }

    async request(url: string, init: RequestInit = {}): Promise<Response> {
        if (!isAllowedAdoHost(url))
            throw new Error(`Refusing to send an Azure DevOps token to ${url}`);
        const method = (init.method ?? "GET").toUpperCase();
        const idempotent = method === "GET" || method === "HEAD";
        // A write may have reached ADO before a 5xx or a network error, so retry it only on 429.
        return withRetry(() => this.requestOnce(url, init), {
            shouldRetry: (err) =>
                idempotent
                    ? isTransientError(err)
                    : (err as { status?: unknown }).status === 429,
            signal: init.signal ?? undefined,
            baseDelayMs: this.options.baseDelayMs,
        });
    }

    private async requestOnce(
        url: string,
        init: RequestInit,
    ): Promise<Response> {
        const token = await withTimeout(
            this.auth.getAccessToken(),
            this.options.timeoutMs,
        );
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${token}`);
        if (!headers.has("accept")) headers.set("accept", "application/json");
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const response = await fetch(url, {
            ...init,
            headers,
            redirect: init.redirect ?? "manual",
            signal: init.signal
                ? AbortSignal.any([init.signal, timeout])
                : timeout,
        });
        if (response.status === 401) {
            this.auth.requireInteraction(
                "Azure DevOps rejected the current session. Sign in again.",
            );
            throw new AuthInteractionRequiredError(
                "Azure DevOps rejected the current session. Sign in again.",
            );
        }
        if (!response.ok) {
            const body = await errorText(response);
            throw new AdoHttpError(
                `Azure DevOps request failed (${response.status}): ${body}`,
                response.status,
                body,
                parseRetryAfter(response.headers.get("retry-after")),
            );
        }
        return response;
    }

    async json<T>(url: string, init?: RequestInit): Promise<T> {
        const response = await this.request(url, init);
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
    }

    async buffer(
        url: string,
        init?: RequestInit,
    ): Promise<{
        status: number;
        contentType: string;
        body: Buffer;
        location: string | null;
    }> {
        const response = await this.request(url, init);
        return {
            status: response.status,
            contentType:
                response.headers.get("content-type") ||
                "application/octet-stream",
            body: Buffer.from(await response.arrayBuffer()),
            location: response.headers.get("location"),
        };
    }
}

export interface AdoCollection<T> {
    count?: number;
    value?: T[];
}

export function collectionValues<T>(
    collection: AdoCollection<T> | T[] | null | undefined,
): T[] {
    return Array.isArray(collection) ? collection : (collection?.value ?? []);
}
