import assert from "node:assert/strict";
import type { ClientRequest } from "node:http";
import { EventEmitter } from "node:events";
import type https from "node:https";
import {
    fetchAdoImage,
    getOnce,
    isAllowedImageHost,
    isPrivateAddress,
    type ImageGetter,
} from "./images.ts";

// Host allowlist: exact or dot boundary, HTTPS only.
assert.equal(isAllowedImageHost("https://dev.azure.com/org/x.png"), true);
assert.equal(isAllowedImageHost("https://org.visualstudio.com/x.png"), true);
assert.equal(isAllowedImageHost("https://visualstudio.com/x.png"), true);
assert.equal(isAllowedImageHost("https://evilvisualstudio.com/x.png"), false);
assert.equal(isAllowedImageHost("https://evildev.azure.com/x.png"), false);
assert.equal(
    isAllowedImageHost("https://dev.azure.com.evil.test/x.png"),
    false,
);
assert.equal(isAllowedImageHost("http://dev.azure.com/x.png"), false);
assert.equal(isAllowedImageHost("not a url"), false);

// Private and loopback addresses.
for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
]) {
    assert.equal(isPrivateAddress(ip), true, ip);
}
assert.equal(isPrivateAddress("8.8.8.8"), false);

const png = Buffer.from([1, 2, 3]);
const getToken = async () => "tok";
const ok =
    (type: string): ImageGetter =>
    async () => ({
        status: 200,
        headers: { "content-type": type },
        body: png,
    });

// Lookalike host is refused before any request or token use.
let called = false;
await assert.rejects(
    fetchAdoImage(
        "https://evilvisualstudio.com/x.png",
        async () => {
            called = true;
            return { status: 200, headers: {}, body: png };
        },
        getToken,
    ),
);
assert.equal(called, false);

// Redirect to a disallowed host is refused; the token is never sent there.
const seen: string[] = [];
await assert.rejects(
    fetchAdoImage(
        "https://dev.azure.com/a.png",
        async (url, token) => {
            seen.push(`${url}|${token}`);
            return {
                status: 302,
                headers: { location: "https://evil.test/steal" },
                body: Buffer.alloc(0),
            };
        },
        getToken,
    ),
    /redirect not allowed/,
);
assert.deepEqual(seen, ["https://dev.azure.com/a.png|tok"]);

// Redirect to http is refused.
await assert.rejects(
    fetchAdoImage(
        "https://dev.azure.com/a.png",
        async () => ({
            status: 301,
            headers: { location: "http://dev.azure.com/a.png" },
            body: Buffer.alloc(0),
        }),
        getToken,
    ),
    /redirect not allowed/,
);

// An allowed redirect is followed.
let hop = 0;
const img = await fetchAdoImage(
    "https://dev.azure.com/a.png",
    async () =>
        hop++ === 0
            ? {
                  status: 302,
                  headers: { location: "/b.png" },
                  body: Buffer.alloc(0),
              }
            : {
                  status: 200,
                  headers: { "content-type": "image/png; charset=x" },
                  body: png,
              },
    getToken,
);
assert.equal(img.contentType, "image/png");

// HTML and other types are refused.
await assert.rejects(
    fetchAdoImage("https://dev.azure.com/a.png", ok("text/html"), getToken),
    /unsupported content type/,
);
await assert.rejects(
    fetchAdoImage("https://dev.azure.com/a.svg", ok("image/svg+xml"), getToken),
    /unsupported content type/,
);

// Oversized bodies are refused.
await assert.rejects(
    fetchAdoImage(
        "https://dev.azure.com/a.png",
        async () => ({
            status: 200,
            headers: { "content-type": "image/png" },
            body: Buffer.alloc(10 * 1024 * 1024 + 1),
        }),
        getToken,
    ),
    /too large/,
);

// Transport: a fake https.get that streams chunks through the real getOnce.
function fakeRequest(
    onStart: (res: EventEmitter, req: ClientRequest) => void,
): typeof https.get {
    return ((_url: unknown, _opts: unknown, cb: (r: unknown) => void) => {
        const req = new EventEmitter() as ClientRequest;
        let destroyed = false;
        (req as unknown as { destroyed: boolean }).destroyed = false;
        req.destroy = ((err?: Error) => {
            if (destroyed) return req;
            destroyed = true;
            (req as unknown as { destroyed: boolean }).destroyed = true;
            setImmediate(() => {
                if (err) req.emit("error", err);
                req.emit("close");
            });
            return req;
        }) as ClientRequest["destroy"];
        const res = Object.assign(new EventEmitter(), {
            statusCode: 200,
            headers: { "content-type": "image/png" },
        });
        setImmediate(() => {
            cb(res);
            onStart(res, req);
        });
        return req;
    }) as unknown as typeof https.get;
}

// The size limit destroys the request on the first oversized chunk.
let sent = 0;
await assert.rejects(
    getOnce("https://dev.azure.com/a.png", "t", {
        maxBytes: 10,
        request: fakeRequest((res, req) => {
            for (let i = 0; i < 100; i++) {
                if (req.destroyed) break;
                sent++;
                res.emit("data", Buffer.alloc(6));
            }
        }),
    }),
    /image too large/,
);
assert.equal(sent, 2);

// The deadline fires even when chunks keep arriving before the idle timeout.
const started = Date.now();
await assert.rejects(
    getOnce("https://dev.azure.com/a.png", "t", {
        timeoutMs: 80,
        request: fakeRequest((res, req) => {
            const timer = setInterval(() => {
                if (req.destroyed) clearInterval(timer);
                else res.emit("data", Buffer.alloc(1));
            }, 10);
        }),
    }),
    /upstream timeout/,
);
assert.ok(Date.now() - started < 1000);

// A synchronous failure while building the request rejects and leaves no timer behind.
await assert.rejects(
    getOnce("https://%FF@dev.azure.com/a.png", "t", { timeoutMs: 50 }),
    /URI|URL/,
);
await new Promise((r) => setTimeout(r, 150));

console.log("images self-check OK");
