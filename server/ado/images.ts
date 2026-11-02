import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { adoAccessToken } from "./client.ts";

export interface FetchedImage {
    status: number;
    contentType: string;
    body: Buffer;
}

export const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class ImageProxyError extends Error {
    readonly status: number;
    constructor(message: string, status = 502) {
        super(message);
        this.status = status;
    }
}

const ALLOWED_HOSTS = ["dev.azure.com", "visualstudio.com"];

// Match the host exactly or on a dot boundary, so `evilvisualstudio.com` fails.
export function isAllowedImageHost(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== "https:") return false;
        const host = u.hostname.toLowerCase();
        return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
        return false;
    }
}

export function isPrivateAddress(address: string): boolean {
    const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224
        );
    }
    if (net.isIPv6(ip)) {
        const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateAddress(mapped[1]);
        return (
            ip === "::" ||
            ip === "::1" ||
            /^f[cd]/.test(ip) ||
            /^fe[89ab]/.test(ip) ||
            ip.startsWith("::ffff:")
        );
    }
    return true;
}

// Checks the resolved address at connect time, so DNS rebinding can't reach internal hosts.
const safeLookup: typeof dns.lookup = ((
    hostname: string,
    options: dns.LookupOptions,
    callback: (...args: unknown[]) => void,
) => {
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) return callback(err);
        const list = Array.isArray(address) ? address : [{ address, family }];
        const bad = list.find((a) => isPrivateAddress(a.address));
        if (bad) return callback(new ImageProxyError("blocked address", 403));
        callback(null, address, family);
    });
}) as typeof dns.lookup;

interface Upstream {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}

interface GetOptions {
    maxBytes: number;
    timeoutMs: number;
    request: typeof https.get;
    lookup: typeof dns.lookup;
}

const defaultGetOptions: GetOptions = {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: IMAGE_TIMEOUT_MS,
    request: https.get,
    lookup: safeLookup,
};

export function getOnce(
    url: string,
    token: string,
    options: Partial<GetOptions> = {},
): Promise<Upstream> {
    const { maxBytes, timeoutMs, request, lookup } = {
        ...defaultGetOptions,
        ...options,
    };
    const headers: Record<string, string> = { Accept: "image/*" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return new Promise((resolve, reject) => {
        const req = request(url, { headers, lookup }, (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (c: Buffer) => {
                size += c.length;
                if (size > maxBytes) {
                    req.destroy(new ImageProxyError("image too large"));
                    return;
                }
                chunks.push(c);
            });
            res.on("end", () =>
                resolve({
                    status: res.statusCode ?? 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }),
            );
            res.on("error", reject);
        });
        // Wall-clock deadline for the whole request, not just socket idle time.
        const deadline = setTimeout(
            () => req.destroy(new ImageProxyError("upstream timeout", 504)),
            timeoutMs,
        );
        req.on("close", () => clearTimeout(deadline));
        req.on("error", reject);
    });
}
export type ImageGetter = (url: string, token: string) => Promise<Upstream>;

// Fetch an ADO attachment with the user's bearer token. Redirects are followed
// by hand (up to 3) and every target is re-validated before credentials are
// attached; a target outside the allowlist is refused.
export async function fetchAdoImage(
    url: string,
    getter: ImageGetter = getOnce,
    getToken: () => Promise<string> = adoAccessToken,
): Promise<FetchedImage> {
    if (!isAllowedImageHost(url)) throw new ImageProxyError("bad url", 400);
    const token = await getToken();
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const r = await getter(current, token);
        const loc = r.headers.location;
        if (r.status >= 300 && r.status < 400 && typeof loc === "string") {
            const next = new URL(loc, current).toString();
            if (!isAllowedImageHost(next))
                throw new ImageProxyError("redirect not allowed", 403);
            current = next;
            continue;
        }
        const contentType = String(r.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
        if (r.status >= 200 && r.status < 300) {
            if (!ALLOWED_IMAGE_TYPES.includes(contentType))
                throw new ImageProxyError("unsupported content type", 415);
            if (r.body.length > MAX_IMAGE_BYTES)
                throw new ImageProxyError("image too large");
        }
        return { status: r.status, contentType, body: r.body };
    }
    throw new ImageProxyError("too many redirects");
}
