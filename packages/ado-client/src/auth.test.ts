import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    AuthenticationRequiredError,
    type AuthenticationRecord,
} from "@azure/identity";
import {
    AdoAuth,
    AuthInteractionRequiredError,
    type BrokerCredential,
    type BrokerCredentialOptions,
    type SilentCredential,
    encodeWindowHandle,
} from "./auth.ts";

const account: AuthenticationRecord = {
    authority: "https://login.microsoftonline.com/tenant",
    homeAccountId: "home-account",
    clientId: "client",
    tenantId: "tenant",
    username: "user@microsoft.com",
};

function mockCredential(
    overrides: Partial<BrokerCredential> = {},
): BrokerCredential {
    return {
        authenticate: async () => account,
        getToken: async () => ({ token: "access-token" }),
        ...overrides,
    };
}

function testAuth(
    credential = mockCredential(),
    silentCredential: SilentCredential = {
        getToken: async () => {
            throw new AuthenticationRequiredError({ scopes: [] });
        },
    },
): { auth: AdoAuth; dir: string; requested: BrokerCredentialOptions[] } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devstart-ado-auth-"));
    const requested: BrokerCredentialOptions[] = [];
    return {
        auth: new AdoAuth({
            clientId: "client",
            tenantId: "tenant",
            platform: "win32",
            accountStorePath: path.join(dir, "account.json"),
            parentWindowHandle: encodeWindowHandle(17_832_816n),
            silentCredential,
            credentialFactory: (options) => {
                requested.push(options);
                return credential;
            },
        }),
        dir,
        requested,
    };
}

test("stays signed out after sign-out even if developer credentials work", async () => {
    const { auth, dir } = testAuth(mockCredential(), {
        getToken: async () => ({ token: "access-token" }),
    });
    await auth.signOut();
    await assert.rejects(auth.getAccessToken(), AuthInteractionRequiredError);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("uses the selected broker account instead of developer credentials", async () => {
    const { auth, dir } = testAuth(
        mockCredential({ getToken: async () => ({ token: "broker-token" }) }),
        { getToken: async () => ({ token: "cli-token" }) },
    );
    await auth.signIn(true);
    assert.equal(await auth.getAccessToken(), "broker-token");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects a silent credential that is not a user account", async (t) => {
    const { auth, dir } = testAuth(mockCredential(), {
        getToken: async () => ({ token: "service-principal-token" }),
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await assert.rejects(auth.getAccessToken(), AuthInteractionRequiredError);
    const status = await auth.signIn();
    assert.equal(status.account?.homeAccountId, account.homeAccountId);
});

test("drops a token request that finishes after sign-out", async (t) => {
    const payload = Buffer.from(
        JSON.stringify({ oid: "o", tid: "tenant", upn: "user@microsoft.com" }),
    ).toString("base64url");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { auth, dir } = testAuth(mockCredential(), {
        getToken: async () => {
            await gate;
            return { token: `header.${payload}.signature` };
        },
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const pending = assert.rejects(
        auth.getAccessToken(),
        AuthInteractionRequiredError,
    );
    await auth.signOut();
    release();
    await pending;
    assert.equal(fs.existsSync(path.join(dir, "account.json")), false);
});

test("ignores a stored account from a different app registration", async (t) => {
    const first = testAuth();
    t.after(() => fs.rmSync(first.dir, { recursive: true, force: true }));
    await first.auth.signIn();
    const other = new AdoAuth({
        clientId: "other-client",
        tenantId: "tenant",
        platform: "win32",
        accountStorePath: path.join(first.dir, "account.json"),
        credentialFactory: () => mockCredential(),
    });
    assert.equal((await other.status()).account, null);
});

test("picks up a sign-out done by another host", async (t) => {
    const { auth, dir } = testAuth();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await auth.signIn();
    fs.rmSync(path.join(dir, "account.json"));
    assert.equal((await auth.status()).account, null);
    await assert.rejects(auth.getAccessToken(), AuthInteractionRequiredError);
});

test("reports missing app registration configuration", async () => {
    const auth = new AdoAuth({
        platform: "win32",
        clientId: "",
        tenantId: "",
        configPath: path.join(os.tmpdir(), "missing-devstart-ado-config.json"),
    });
    const status = await auth.status();
    assert.equal(status.state, "not-configured");
    assert.equal(status.configured, false);
});

test("reads app registration configuration from the local config file", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devstart-ado-config-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, "config.json");
    const accountStorePath = path.join(dir, "account.json");
    fs.writeFileSync(
        configPath,
        JSON.stringify({ clientId: "client", tenantId: "tenant" }),
    );
    fs.writeFileSync(accountStorePath, JSON.stringify(account));
    const auth = new AdoAuth({
        platform: "win32",
        configPath,
        accountStorePath,
        silentCredential: { getToken: async () => ({ token: "access-token" }) },
        credentialFactory: () => mockCredential(),
    });

    assert.equal(await auth.getAccessToken(), "access-token");
});

test("uses an existing developer sign-in without interactive authentication", async (t) => {
    const payload = Buffer.from(
        JSON.stringify({
            name: "User Name",
            oid: "object-id",
            tid: "tenant",
            upn: "user@microsoft.com",
        }),
    ).toString("base64url");
    const { auth, dir, requested } = testAuth(mockCredential(), {
        getToken: async () => ({ token: `header.${payload}.signature` }),
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.match(await auth.getAccessToken(), /^header\./);
    assert.equal((await auth.status()).account?.username, "user@microsoft.com");
    assert.equal(requested.length, 0);
});

test("explicit sign-in uses the default Windows broker account", async (t) => {
    const { auth, dir, requested } = testAuth();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const status = await auth.signIn();
    assert.equal(status.account?.homeAccountId, account.homeAccountId);
    assert.equal(requested[0]?.selectAccount, false);
    const parentWindowHandle = Buffer.from(requested[0]!.parentWindowHandle);
    assert.equal(
        process.arch === "ia32"
            ? BigInt(parentWindowHandle.readUInt32LE())
            : parentWindowHandle.readBigUInt64LE(),
        17_832_816n,
    );
    const stored = fs.readFileSync(path.join(dir, "account.json"), "utf8");
    assert.match(stored, /home-account/);
    assert.doesNotMatch(stored, /access-token/);
});

test("account switching requests the broker account picker", async (t) => {
    const { auth, dir, requested } = testAuth();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await auth.signIn(true);
    assert.equal(requested[0]?.selectAccount, true);
    assert.equal(requested[0]?.authenticationRecord, undefined);
});

test("uses persisted broker account metadata after restart", async (t) => {
    const first = testAuth();
    t.after(() => fs.rmSync(first.dir, { recursive: true, force: true }));
    await first.auth.signIn();

    const requested: BrokerCredentialOptions[] = [];
    const restarted = new AdoAuth({
        clientId: "client",
        tenantId: "tenant",
        platform: "win32",
        accountStorePath: path.join(first.dir, "account.json"),
        silentCredential: {
            getToken: async () => {
                throw new AuthenticationRequiredError({ scopes: [] });
            },
        },
        credentialFactory: (options) => {
            requested.push(options);
            return mockCredential({
                getToken: async () => ({ token: "restart-token" }),
            });
        },
    });

    assert.equal(await restarted.getAccessToken(), "restart-token");
    assert.equal(
        requested[0]?.authenticationRecord?.homeAccountId,
        account.homeAccountId,
    );
});

test("maps broker interaction-required failures to an actionable state", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devstart-ado-auth-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const accountStorePath = path.join(dir, "account.json");
    fs.writeFileSync(accountStorePath, JSON.stringify(account));
    const auth = new AdoAuth({
        clientId: "client",
        tenantId: "tenant",
        platform: "win32",
        accountStorePath,
        silentCredential: {
            getToken: async () => {
                throw new AuthenticationRequiredError({ scopes: [] });
            },
        },
        credentialFactory: () =>
            mockCredential({
                getToken: async () => {
                    throw new AuthenticationRequiredError({ scopes: [] });
                },
            }),
    });

    await assert.rejects(
        () => auth.getAccessToken(),
        AuthInteractionRequiredError,
    );
    const status = await auth.status();
    assert.equal(status.interactionRequired, true);
    assert.equal(status.state, "error");
});

test("encodes a 64-bit Windows parent handle for the broker", () => {
    const encoded = Buffer.from(encodeWindowHandle(17_832_816n));
    assert.equal(encoded.length, process.arch === "ia32" ? 4 : 8);
    assert.equal(
        process.arch === "ia32"
            ? BigInt(encoded.readUInt32LE())
            : encoded.readBigUInt64LE(),
        17_832_816n,
    );
});
