import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
    AuthenticationRequiredError,
    AzureCliCredential,
    ChainedTokenCredential,
    DefaultAzureCredential,
    InteractiveBrowserCredential,
    useIdentityPlugin,
    type AuthenticationRecord,
} from "@azure/identity";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

export const ADO_RESOURCE_ID = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_SCOPES = [`${ADO_RESOURCE_ID}/.default`];
const INTERACTIVE_AUTH_TIMEOUT_MS = 15_000;

export interface AuthAccount {
    homeAccountId: string;
    username: string;
    name: string | null;
}

export interface AuthStatus {
    configured: boolean;
    supported: boolean;
    state: "not-configured" | "signed-out" | "ready" | "error";
    interactionRequired: boolean;
    account: AuthAccount | null;
    error: string | null;
}

export interface BrokerCredential {
    authenticate(
        scopes: string | string[],
    ): Promise<AuthenticationRecord | undefined>;
    getToken(scopes: string | string[]): Promise<{ token: string }>;
}

export interface SilentCredential {
    getToken(scopes: string | string[]): Promise<{ token: string }>;
}

export interface BrokerCredentialOptions {
    tenantId: string;
    clientId: string;
    authenticationRecord?: AuthenticationRecord;
    parentWindowHandle: Uint8Array;
    selectAccount: boolean;
}

export interface AdoAuthOptions {
    clientId?: string;
    tenantId?: string;
    configPath?: string;
    accountStorePath?: string;
    platform?: NodeJS.Platform;
    credentialFactory?: (options: BrokerCredentialOptions) => BrokerCredential;
    parentWindowHandle?: Uint8Array;
    silentCredential?: SilentCredential;
}

interface RegistrationConfig {
    clientId: string;
    tenantId: string;
}

interface StoredAuth {
    account: AuthAccount;
    brokerRecord?: AuthenticationRecord;
}

export class AuthConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthConfigurationError";
    }
}

export class AuthInteractionRequiredError extends Error {
    constructor(message = "Sign in to Azure DevOps to continue.") {
        super(message);
        this.name = "AuthInteractionRequiredError";
    }
}

let brokerRegistered = false;

function ensureBrokerRegistered(): void {
    if (brokerRegistered) return;
    // Lazy load: the broker pulls in native libs (keytar) that fail on Linux without libsecret.
    const { nativeBrokerPlugin } = nodeRequire("@azure/identity-broker");
    useIdentityPlugin(nativeBrokerPlugin);
    brokerRegistered = true;
}

function accountView(record: AuthenticationRecord): AuthAccount {
    return {
        homeAccountId: record.homeAccountId,
        username: record.username,
        name: null,
    };
}

function defaultStorePath(): string {
    const root =
        process.env.LOCALAPPDATA || path.join(os.homedir(), ".devstart");
    return path.join(root, "devstart", "ado-auth.json");
}

function defaultConfigPath(): string {
    const root =
        process.env.LOCALAPPDATA || path.join(os.homedir(), ".devstart");
    return path.join(root, "devstart", "ado-auth-config.json");
}

function readRegistrationConfig(
    configPath: string,
): Partial<RegistrationConfig> {
    try {
        const parsed = JSON.parse(
            fs.readFileSync(configPath, "utf8"),
        ) as Partial<RegistrationConfig>;
        return {
            clientId:
                typeof parsed.clientId === "string"
                    ? parsed.clientId
                    : undefined,
            tenantId:
                typeof parsed.tenantId === "string"
                    ? parsed.tenantId
                    : undefined,
        };
    } catch {
        return {};
    }
}

function createBrokerCredential(
    options: BrokerCredentialOptions,
): BrokerCredential {
    ensureBrokerRegistered();
    return new InteractiveBrowserCredential({
        tenantId: options.tenantId,
        clientId: options.clientId,
        authenticationRecord: options.selectAccount
            ? undefined
            : options.authenticationRecord,
        disableAutomaticAuthentication: true,
        brokerOptions: {
            enabled: true,
            useDefaultBrokerAccount: !options.selectAccount,
            parentWindowHandle: options.parentWindowHandle,
        },
    });
}

function createSilentCredential(tenantId: string): SilentCredential {
    ensureBrokerRegistered();
    return new ChainedTokenCredential(
        new AzureCliCredential({ tenantId, processTimeoutInMs: 10_000 }),
        new DefaultAzureCredential({ tenantId, processTimeoutInMs: 10_000 }),
    );
}

export function encodeWindowHandle(hwnd: bigint): Uint8Array {
    const bytes = Buffer.alloc(process.arch === "ia32" ? 4 : 8);
    if (bytes.length === 4) bytes.writeUInt32LE(Number(hwnd));
    else bytes.writeBigUInt64LE(hwnd);
    return new Uint8Array(bytes);
}

function resolveParentWindowHandle(): Uint8Array {
    const override = process.env.DEVSTART_PARENT_WINDOW_HANDLE?.trim();
    try {
        const value =
            override ||
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'GitHub Copilot' } | Select-Object -First 1; if ($p) { $p.MainWindowHandle }",
                ],
                { encoding: "utf8", timeout: 3_000, windowsHide: true },
            ).trim();
        return value ? encodeWindowHandle(BigInt(value)) : new Uint8Array(0);
    } catch {
        return new Uint8Array(0);
    }
}

function accountFromAccessToken(token: string): AuthAccount | null {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        ) as {
            name?: string;
            oid?: string;
            preferred_username?: string;
            tid?: string;
            unique_name?: string;
            upn?: string;
        };
        const username =
            payload.preferred_username ?? payload.upn ?? payload.unique_name;
        if (!username) return null;
        return {
            homeAccountId:
                payload.oid && payload.tid
                    ? `${payload.oid}.${payload.tid}`
                    : username.toLowerCase(),
            username,
            name: payload.name ?? null,
        };
    } catch {
        return null;
    }
}

function isInteractionRequired(error: unknown): boolean {
    return (
        error instanceof AuthenticationRequiredError ||
        (error instanceof Error &&
            (error.name === "AuthenticationRequiredError" ||
                /interaction_required|login_required|consent_required|authentication required/i.test(
                    error.message,
                )))
    );
}

async function withInteractiveTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(
                    () =>
                        reject(
                            new AuthInteractionRequiredError(
                                "Windows sign-in did not open. Retry from the desktop app; if it persists, use the fallback sign-in flow.",
                            ),
                        ),
                    INTERACTIVE_AUTH_TIMEOUT_MS,
                );
            }),
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

export class AdoAuth {
    private readonly clientId: string;
    private readonly tenantId: string;
    private readonly accountStorePath: string;
    private readonly platform: NodeJS.Platform;
    private readonly credentialFactory: (
        options: BrokerCredentialOptions,
    ) => BrokerCredential;
    private readonly parentWindowHandle: Uint8Array;
    private readonly silentCredential: SilentCredential;
    private lastError: string | null = null;
    private needsInteraction = false;
    private currentAccount: AuthAccount | null = null;
    private brokerRecord: AuthenticationRecord | null = null;

    constructor(options: AdoAuthOptions = {}) {
        const configPath =
            options.configPath ??
            process.env.DEVSTART_ADO_CONFIG_PATH ??
            defaultConfigPath();
        const registration = readRegistrationConfig(configPath);
        this.clientId =
            options.clientId ??
            process.env.DEVSTART_ADO_CLIENT_ID ??
            registration.clientId ??
            "";
        this.tenantId =
            options.tenantId ??
            process.env.DEVSTART_ADO_TENANT_ID ??
            registration.tenantId ??
            "";
        this.accountStorePath =
            options.accountStorePath ??
            process.env.DEVSTART_ADO_ACCOUNT_STORE ??
            defaultStorePath();
        this.platform = options.platform ?? process.platform;
        this.credentialFactory =
            options.credentialFactory ?? createBrokerCredential;
        this.parentWindowHandle =
            options.parentWindowHandle ??
            (options.credentialFactory
                ? new Uint8Array(0)
                : resolveParentWindowHandle());
        this.silentCredential =
            options.silentCredential ?? createSilentCredential(this.tenantId);
        const stored = this.readStoredAuth();
        this.currentAccount = stored?.account ?? null;
        this.brokerRecord = stored?.brokerRecord ?? null;
    }

    private get configured(): boolean {
        return !!(this.clientId && this.tenantId);
    }

    private readStoredAuth(): StoredAuth | null {
        try {
            const raw = JSON.parse(
                fs.readFileSync(this.accountStorePath, "utf8"),
            ) as Partial<StoredAuth> | Partial<AuthenticationRecord>;
            if (
                "account" in raw &&
                raw.account?.homeAccountId &&
                raw.account.username
            ) {
                return {
                    account: {
                        homeAccountId: raw.account.homeAccountId,
                        username: raw.account.username,
                        name: raw.account.name ?? null,
                    },
                    brokerRecord: raw.brokerRecord,
                };
            }
            if (
                !("authority" in raw) ||
                !raw.authority ||
                !raw.homeAccountId ||
                !raw.clientId ||
                !raw.tenantId ||
                !raw.username
            ) {
                return null;
            }
            if (this.clientId && raw.clientId !== this.clientId) return null;
            if (this.tenantId && raw.tenantId !== this.tenantId) return null;
            const brokerRecord: AuthenticationRecord = {
                authority: raw.authority,
                homeAccountId: raw.homeAccountId,
                clientId: raw.clientId,
                tenantId: raw.tenantId,
                username: raw.username,
            };
            return { account: accountView(brokerRecord), brokerRecord };
        } catch {
            return null;
        }
    }

    private writeStoredAuth(stored: StoredAuth): void {
        fs.mkdirSync(path.dirname(this.accountStorePath), { recursive: true });
        const tmp = `${this.accountStorePath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
        fs.renameSync(tmp, this.accountStorePath);
    }

    private credential(selectAccount: boolean): BrokerCredential {
        return this.credentialFactory({
            clientId: this.clientId,
            tenantId: this.tenantId,
            authenticationRecord: selectAccount
                ? undefined
                : (this.brokerRecord ?? undefined),
            parentWindowHandle: this.parentWindowHandle,
            selectAccount,
        });
    }

    private rememberAccessToken(token: string): void {
        const account = accountFromAccessToken(token);
        if (!account) return;
        if (
            this.currentAccount?.homeAccountId === account.homeAccountId &&
            this.currentAccount.username === account.username &&
            this.currentAccount.name === account.name
        ) {
            return;
        }
        this.currentAccount = account;
        this.writeStoredAuth({
            account,
            ...(this.brokerRecord ? { brokerRecord: this.brokerRecord } : {}),
        });
    }

    async status(): Promise<AuthStatus> {
        if (!this.configured) {
            return {
                configured: false,
                supported: this.platform === "win32",
                state: "not-configured",
                interactionRequired: false,
                account: null,
                error: "Set DEVSTART_ADO_CLIENT_ID and DEVSTART_ADO_TENANT_ID.",
            };
        }
        if (this.platform !== "win32") {
            return {
                configured: true,
                supported: false,
                state: "error",
                interactionRequired: false,
                account: null,
                error: "Windows Web Account Manager is required for Azure DevOps authentication.",
            };
        }
        return {
            configured: true,
            supported: true,
            state: this.currentAccount
                ? this.lastError
                    ? "error"
                    : "ready"
                : "signed-out",
            interactionRequired: !this.currentAccount || this.needsInteraction,
            account: this.currentAccount,
            error: this.lastError,
        };
    }

    async getAccessToken(): Promise<string> {
        if (!this.configured) {
            throw new AuthConfigurationError(
                "Set DEVSTART_ADO_CLIENT_ID and DEVSTART_ADO_TENANT_ID.",
            );
        }
        if (this.platform !== "win32") {
            throw new AuthConfigurationError(
                "Windows Web Account Manager is not available.",
            );
        }
        try {
            const result = await this.silentCredential.getToken(ADO_SCOPES);
            if (!result?.token) throw new AuthInteractionRequiredError();
            this.rememberAccessToken(result.token);
            this.lastError = null;
            this.needsInteraction = false;
            return result.token;
        } catch (silentError) {
            if (this.brokerRecord) {
                try {
                    const result =
                        await this.credential(false).getToken(ADO_SCOPES);
                    if (!result?.token)
                        throw new AuthInteractionRequiredError();
                    this.lastError = null;
                    this.needsInteraction = false;
                    return result.token;
                } catch (brokerError) {
                    if (!isInteractionRequired(brokerError)) throw brokerError;
                }
            }
            this.lastError = isInteractionRequired(silentError)
                ? "Your Azure DevOps session needs attention."
                : silentError instanceof Error
                  ? silentError.message
                  : "Azure DevOps authentication failed.";
            this.needsInteraction = true;
            throw new AuthInteractionRequiredError(this.lastError);
        }
    }

    // Forget the stored account. The Windows account itself is not touched.
    async signOut(): Promise<AuthStatus> {
        fs.rmSync(this.accountStorePath, { force: true });
        this.currentAccount = null;
        this.brokerRecord = null;
        this.lastError = null;
        this.needsInteraction = false;
        return this.status();
    }

    async signIn(selectAccount = false): Promise<AuthStatus> {
        if (!this.configured) {
            throw new AuthConfigurationError(
                "Set DEVSTART_ADO_CLIENT_ID and DEVSTART_ADO_TENANT_ID.",
            );
        }
        if (this.platform !== "win32") {
            throw new AuthConfigurationError(
                "Windows Web Account Manager is not available.",
            );
        }
        if (!selectAccount) {
            try {
                await this.getAccessToken();
                return this.status();
            } catch (error) {
                if (!(error instanceof AuthInteractionRequiredError))
                    throw error;
            }
        }
        const credential = this.credential(selectAccount);
        const record = await withInteractiveTimeout(
            credential.authenticate(ADO_SCOPES),
        );
        if (!record) {
            throw new AuthInteractionRequiredError(
                "Azure DevOps sign-in did not complete.",
            );
        }
        const token = await credential.getToken(ADO_SCOPES);
        if (!token?.token) {
            throw new AuthInteractionRequiredError(
                "Azure DevOps sign-in did not return a token.",
            );
        }
        this.brokerRecord = record;
        this.currentAccount = accountView(record);
        this.writeStoredAuth({
            account: this.currentAccount,
            brokerRecord: record,
        });
        this.lastError = null;
        this.needsInteraction = false;
        return this.status();
    }

    requireInteraction(message: string): void {
        this.lastError = message;
        this.needsInteraction = true;
    }
}

export function createAdoAuth(options?: AdoAuthOptions): AdoAuth {
    return new AdoAuth(options);
}
