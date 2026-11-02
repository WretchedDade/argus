import assert from "node:assert/strict";
import {
    fetchAdoImage,
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

console.log("images self-check OK");
