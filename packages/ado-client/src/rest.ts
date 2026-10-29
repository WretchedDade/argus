import type { AdoAuth } from "./auth.ts";
import { AuthInteractionRequiredError } from "./auth.ts";

export class AdoHttpError extends Error {
    readonly status: number;
    readonly body: string;

    constructor(message: string, status: number, body: string) {
        super(message);
        this.name = "AdoHttpError";
        this.status = status;
        this.body = body;
    }
}

export function isAllowedAdoHost(rawUrl: string): boolean {
    try {
        const host = new URL(rawUrl).hostname.toLowerCase();
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

    constructor(auth: AdoAuth) {
        this.auth = auth;
    }

    async request(url: string, init: RequestInit = {}): Promise<Response> {
        if (!isAllowedAdoHost(url))
            throw new Error(`Refusing to send an Azure DevOps token to ${url}`);
        const token = await this.auth.getAccessToken();
        const headers = new Headers(init.headers);
        headers.set("authorization", `Bearer ${token}`);
        if (!headers.has("accept")) headers.set("accept", "application/json");
        const response = await fetch(url, {
            ...init,
            headers,
            redirect: init.redirect ?? "manual",
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
