import assert from "node:assert/strict";
import test from "node:test";
import { AdoRestClient, isAllowedAdoHost } from "./rest.ts";
import type { AdoAuth } from "./auth.ts";

test("allows only Azure DevOps hosts", () => {
    assert.equal(isAllowedAdoHost("https://dev.azure.com/org/project"), true);
    assert.equal(
        isAllowedAdoHost("https://org.visualstudio.com/project"),
        true,
    );
    assert.equal(isAllowedAdoHost("https://example.com/steal"), false);
    assert.equal(isAllowedAdoHost("http://dev.azure.com/org/project"), false);
});

test("adds a bearer token to authenticated requests", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer test-token");
        return new Response(JSON.stringify({ value: [1] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const auth = { getAccessToken: async () => "test-token" } as AdoAuth;
    const client = new AdoRestClient(auth);
    assert.deepEqual(
        await client.json("https://dev.azure.com/org/_apis/test"),
        { value: [1] },
    );
});

test("refuses to send tokens to non-ADO hosts", async () => {
    const auth = { getAccessToken: async () => "test-token" } as AdoAuth;
    const client = new AdoRestClient(auth);
    await assert.rejects(
        () => client.json("https://example.com/test"),
        /Refusing to send/,
    );
});
