import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

// A named date range (e.g. "Hackathon", "Team week") shown as a shaded band on
// the Load & capacity chart, for context on why load dipped/spiked that period.
export interface Period {
    label: string;
    start: string; // YYYY-MM-DD (inclusive)
    end: string; // YYYY-MM-DD (inclusive)
}

// Poller configuration. Defaults come from env; a user can override any field
// from the Settings screen (persisted in the store). `me` overrides the az
// identity when set. `defaultConfig() + saved overrides` = the effective config.
export interface ArgusConfig {
    me: string | null; // identity override; null = use the signed-in account
    adoAuth: "az" | "broker"; // how Argus authenticates to Azure DevOps
    avatarUrl: string; // optional custom avatar image for your own PRs (else initials)
    orgUrl: string;
    orgSlug: string;
    project: string;
    teamPatterns: string[];
    teamLabels: Record<string, string>; // seen team display name -> friendly label
    periods: Period[]; // named context bands for the load chart
    reviewSkillName: string; // the skill the Review buttons tell the agent to run
    recencyDays: number;
    retentionDays: number;
    workStartHour: number;
    workEndHour: number;
    workDays: number[];
    checkForUpdates: boolean; // ask GitHub for new Argus releases
    vendorPattern: string; // regex for vendor display names; "" turns the rule off
}

// Default: a "(Company)" parenthetical in the display name marks a vendor.
export const DEFAULT_VENDOR_PATTERN = "\\(.+\\)";

export type ConfigOverrides = Partial<ArgusConfig>;

// Read the optional local config file (argus.config.json). It is gitignored and
// holds org-specific values. Invalid files are logged and give no overrides.
// Precedence: env/defaults < local file < Settings overrides in the store.
export function loadLocalConfig(file: string): ConfigOverrides {
    if (!existsSync(file)) return {};
    try {
        return parseConfigOverrides(JSON.parse(readFileSync(file, "utf-8")));
    } catch (err) {
        console.error(`argus: cannot read ${file}: ${(err as Error).message}`);
        return {};
    }
}

// Values that reach the Azure CLI or an ADO URL may only use these characters.
// No shell metacharacters, quotes, or path separators.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROJECT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
const ORG_URL =
    /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*\/?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const optional = (schema: z.ZodString, pattern: RegExp, message: string) =>
    schema.max(200).refine((value) => value === "" || pattern.test(value), {
        message,
    });

export const ConfigSchema = z.object({
    me: z.string().max(320).nullable(),
    adoAuth: z.enum(["az", "broker"]),
    avatarUrl: z.string().max(2048),
    orgUrl: optional(z.string(), ORG_URL, "must be an http(s) URL"),
    orgSlug: optional(z.string(), SLUG, "contains unsafe characters"),
    project: optional(z.string(), PROJECT_NAME, "contains unsafe characters"),
    teamPatterns: z.array(z.string().max(200)).max(200),
    teamLabels: z.record(z.string().max(200), z.string().max(200)),
    periods: z
        .array(
            z.object({
                label: z.string().max(200),
                start: z.string().regex(DAY),
                end: z.string().regex(DAY),
            }),
        )
        .max(200),
    reviewSkillName: z.string().max(200),
    recencyDays: z.number().int().min(1).max(365),
    retentionDays: z.number().int().min(1).max(365),
    workStartHour: z.number().int().min(0).max(23),
    workEndHour: z.number().int().min(1).max(24),
    workDays: z.array(z.number().int().min(0).max(6)).max(7),
    checkForUpdates: z.boolean(),
    vendorPattern: z
        .string()
        .max(200)
        .refine(
            (value) => {
                try {
                    new RegExp(value);
                    return true;
                } catch {
                    return false;
                }
            },
            { message: "must be a valid regular expression" },
        ),
}) satisfies z.ZodType<ArgusConfig>;

const ConfigOverridesSchema = ConfigSchema.partial();

// Validate untrusted config input (file, saved settings, HTTP body). Unknown
// keys are dropped. Throws a ConfigError that names every invalid field.
export function parseConfigOverrides(input: unknown): ConfigOverrides {
    const result = ConfigOverridesSchema.safeParse(input);
    if (result.success) return result.data;
    throw new ConfigError(
        result.error.issues
            .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
            .join("; "),
    );
}

export class ConfigError extends Error {}

// Keep the valid fields of stored settings and log the invalid ones, so one bad
// saved value does not discard every setting.
export function salvageConfigOverrides(input: unknown): ConfigOverrides {
    if (input === null || typeof input !== "object" || Array.isArray(input))
        return {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(
        ConfigSchema.shape,
    ) as (keyof ArgusConfig)[]) {
        if (!Object.hasOwn(input, key)) continue;
        const value = (input as Record<string, unknown>)[key];
        const result = ConfigSchema.shape[key].safeParse(value);
        if (result.success) out[key] = result.data;
        else console.error(`argus: ignoring invalid saved setting: ${key}`);
    }
    return out;
}

const isString = (value: unknown): value is string => typeof value === "string";

export function hasRequiredSetup(config: ArgusConfig): boolean {
    if (
        ![config.orgUrl, config.orgSlug, config.project].every(
            (value) => isString(value) && value.trim().length > 0,
        )
    )
        return false;
    try {
        const url = new URL(config.orgUrl);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

const SAFE_DEFAULTS: ArgusConfig = {
    me: null,
    adoAuth: "az",
    avatarUrl: "",
    orgUrl: "",
    orgSlug: "",
    project: "",
    teamPatterns: [],
    teamLabels: {},
    periods: [],
    reviewSkillName: "pr-review",
    recencyDays: 7,
    retentionDays: 2,
    workStartHour: 9,
    workEndHour: 17,
    workDays: [1, 2, 3, 4, 5],
    checkForUpdates: true,
    vendorPattern: DEFAULT_VENDOR_PATTERN,
};

// Environment values go through the same schema. An invalid value is logged and
// replaced by its safe default so a bad variable cannot reach the Azure CLI.
export function defaultConfig(): ArgusConfig {
    const raw = envConfig() as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...raw };
    for (const key of Object.keys(
        ConfigSchema.shape,
    ) as (keyof ArgusConfig)[]) {
        const result = ConfigSchema.shape[key].safeParse(raw[key]);
        if (result.success) continue;
        console.error(
            `argus: ignoring invalid environment value for ${key}: ${result.error.issues[0]?.message}`,
        );
        out[key] = SAFE_DEFAULTS[key];
    }
    return out as unknown as ArgusConfig;
}

function envConfig(): ArgusConfig {
    const [startHour, endHour] = parseRange(
        process.env.ARGUS_WORK_HOURS,
        9,
        17,
    );
    const [dayStart, dayEnd] = parseRange(process.env.ARGUS_WORK_DAYS, 1, 5);
    const orgSlug = process.env.ARGUS_ORG_SLUG ?? "";
    return {
        me: process.env.ARGUS_ME ?? null,
        adoAuth: process.env.ARGUS_ADO_AUTH === "broker" ? "broker" : "az",
        avatarUrl: process.env.ARGUS_AVATAR_URL ?? "",
        orgUrl:
            process.env.ARGUS_ORG_URL ??
            (orgSlug ? `https://dev.azure.com/${orgSlug}` : ""),
        orgSlug,
        project: process.env.ARGUS_PROJECT ?? "",
        teamPatterns: splitList(process.env.ARGUS_TEAM_PATTERNS ?? ""),
        teamLabels: {},
        periods: [],
        reviewSkillName: process.env.ARGUS_REVIEW_SKILL ?? "pr-review",
        recencyDays: Number(process.env.ARGUS_RECENCY_DAYS ?? 7),
        retentionDays: Number(process.env.ARGUS_LOG_RETENTION_DAYS ?? 2),
        workStartHour: startHour,
        workEndHour: endHour,
        workDays: inclusiveRange(dayStart, dayEnd),
        checkForUpdates: process.env.ARGUS_CHECK_UPDATES !== "0",
        vendorPattern:
            process.env.ARGUS_VENDOR_PATTERN ?? DEFAULT_VENDOR_PATTERN,
    };
}

// Merge saved overrides onto the defaults, ignoring undefined fields.
export function mergeConfig(
    base: ArgusConfig,
    overrides: ConfigOverrides,
): ArgusConfig {
    const out = { ...base };
    for (const [k, v] of Object.entries(overrides) as [
        keyof ArgusConfig,
        unknown,
    ][]) {
        if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
    return out;
}

function parseRange(
    value: string | undefined,
    defA: number,
    defB: number,
): [number, number] {
    const m = value?.match(/^(\d+)\s*-\s*(\d+)$/);
    return m ? [Number(m[1]), Number(m[2])] : [defA, defB];
}

function inclusiveRange(a: number, b: number): number[] {
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
}

function splitList(value: string): string[] {
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
