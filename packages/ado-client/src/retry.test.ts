import assert from "node:assert/strict";
import test from "node:test";
import { AdoRestClient } from "./rest.ts";
import { parseRetryAfter, withRetry } from "./retry.ts";
import type { AdoAuth } from "./auth.ts";

const auth = {
    getAccessToken: async () => "test-token",
    requireInteraction: () => {},
} as unknown as AdoAuth;
const URL = "https://dev.azure.com/org/_apis/test";

function stubFetch(
    t: test.TestContext,
    handler: (calls: number, init?: RequestInit) => Promise<Response>,
) {
    const original = globalThis.fetch;
    let calls = 0;
    t.after(() => {
        globalThis.fetch = original;
    });
    globalThis.fetch = async (_input: unknown, init?: RequestInit) =>
        handler(++calls, init);
    return () => calls;
}

test("retries a 429 and honors Retry-After", async (t) => {
    const calls = stubFetch(t, async (n) =>
        n === 1
            ? new Response("slow down", {
                  status: 429,
                  headers: { "retry-after": "0" },
              })
            : new Response("{}", { status: 200 }),
    );
    const client = new AdoRestClient(auth, { baseDelayMs: 1 });
    assert.deepEqual(await client.json(URL), {});
    assert.equal(calls(), 2);
});

test("does not retry a 401", async (t) => {
    const calls = stubFetch(t, async () => new Response("", { status: 401 }));
    const client = new AdoRestClient(auth, { baseDelayMs: 1 });
    await assert.rejects(() => client.json(URL), /Sign in again/);
    assert.equal(calls(), 1);
});

test("aborts a hung request and retries it", async (t) => {
    // AbortSignal.timeout does not keep the event loop alive, so hold it open for the test.
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    const calls = stubFetch(t, (n, init) =>
        n === 1
            ? new Promise<Response>((_resolve, reject) =>
                  init?.signal?.addEventListener("abort", () =>
                      reject(new DOMException("timed out", "TimeoutError")),
                  ),
              )
            : Promise.resolve(new Response("{}", { status: 200 })),
    );
    const client = new AdoRestClient(auth, { timeoutMs: 20, baseDelayMs: 1 });
    assert.deepEqual(await client.json(URL), {});
    assert.equal(calls(), 2);
});

test("retries a failing write only on 429", async (t) => {
    const calls = stubFetch(t, async () => new Response("", { status: 503 }));
    const client = new AdoRestClient(auth, { baseDelayMs: 1 });
    await assert.rejects(() => client.json(URL, { method: "POST" }), /503/);
    assert.equal(calls(), 1);
});

test("gives up after the last attempt", async (t) => {
    const calls = stubFetch(t, async () => new Response("", { status: 503 }));
    const client = new AdoRestClient(auth, { baseDelayMs: 1 });
    await assert.rejects(() => client.json(URL), /503/);
    assert.equal(calls(), 3);
});

test("withRetry does not retry a non-transient error", async () => {
    let calls = 0;
    await assert.rejects(
        withRetry(async () => {
            calls++;
            throw new Error("bad input");
        }),
        /bad input/,
    );
    assert.equal(calls, 1);
});

test("does not retry when Retry-After is longer than the delay cap", async (t) => {
    const calls = stubFetch(
        t,
        async () =>
            new Response("", {
                status: 429,
                headers: { "retry-after": "120" },
            }),
    );
    const client = new AdoRestClient(auth, { baseDelayMs: 1 });
    await assert.rejects(() => client.json(URL), /429/);
    assert.equal(calls(), 1);
});

test("times out a token request that never settles", async (t) => {
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    const calls = stubFetch(t, async () => new Response("{}", { status: 200 }));
    let tokenCalls = 0;
    const hungAuth = {
        getAccessToken: () =>
            ++tokenCalls === 1
                ? new Promise<string>(() => {})
                : Promise.resolve("test-token"),
        requireInteraction: () => {},
    } as unknown as AdoAuth;
    const client = new AdoRestClient(hungAuth, {
        timeoutMs: 20,
        baseDelayMs: 1,
    });
    assert.deepEqual(await client.json(URL), {});
    assert.equal(tokenCalls, 2);
    assert.equal(calls(), 1);
});

test("parses Retry-After seconds and dates", () => {
    assert.equal(parseRetryAfter("3"), 3000);
    assert.equal(
        parseRetryAfter(
            "Wed, 21 Oct 2015 07:28:05 GMT",
            Date.UTC(2015, 9, 21, 7, 28, 0),
        ),
        5000,
    );
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("soon"), undefined);
});
