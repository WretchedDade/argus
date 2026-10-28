import { existsSync, readFileSync } from "node:fs";

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
    me: string | null; // identity override; null = use az account
    avatarUrl: string; // optional custom avatar image for your own PRs (else initials)
    orgUrl: string;
    orgSlug: string;
    project: string;
    teamPatterns: string[];
    teamLabels: Record<string, string>; // seen team display name -> friendly label
    periods: Period[]; // named context bands for the load chart
    reviewSkillName: string; // the skill the Review buttons tell the agent to run
    deployWindowDays: number; // how many days of merged PRs the deploy timeline shows
    repoPipelines: Record<string, number>; // repo name -> build definition id (for deploy tracking)
    recencyDays: number;
    retentionDays: number;
    workStartHour: number;
    workEndHour: number;
    workDays: number[];
}

export type ConfigOverrides = Partial<ArgusConfig>;

// Read the optional local config file (argus.config.json). It is gitignored and
// holds org-specific values. Invalid files are logged and give no overrides.
// Precedence: env/defaults < local file < Settings overrides in the store.
export function loadLocalConfig(file: string): ConfigOverrides {
    if (!existsSync(file)) return {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
        if (!isRecord(parsed)) throw new TypeError("expected a config object");
        const entries = Object.entries(localConfigValidators)
            .filter(([key]) => Object.hasOwn(parsed, key))
            .map(([key, validate]) => {
                if (!validate(parsed[key]))
                    throw new TypeError(`invalid config field: ${key}`);
                return [key, parsed[key]];
            });
        return Object.fromEntries(entries) as ConfigOverrides;
    } catch (err) {
        console.error(`argus: cannot read ${file}: ${(err as Error).message}`);
        return {};
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
const localConfigValidators: Record<
    keyof ArgusConfig,
    (value: unknown) => boolean
> = {
    me: (value) => value === null || isString(value),
    avatarUrl: isString,
    orgUrl: isString,
    orgSlug: isString,
    project: isString,
    teamPatterns: (value) => Array.isArray(value) && value.every(isString),
    teamLabels: (value) =>
        isRecord(value) && Object.values(value).every(isString),
    periods: (value) =>
        Array.isArray(value) &&
        value.every(
            (period: unknown) =>
                isRecord(period) &&
                isString(period.label) &&
                isString(period.start) &&
                isString(period.end),
        ),
    reviewSkillName: isString,
    deployWindowDays: isNumber,
    repoPipelines: (value) =>
        isRecord(value) && Object.values(value).every(isNumber),
    recencyDays: isNumber,
    retentionDays: isNumber,
    workStartHour: isNumber,
    workEndHour: isNumber,
    workDays: (value) =>
        Array.isArray(value) &&
        value.every(
            (day: unknown) =>
                isNumber(day) && Number.isInteger(day) && day >= 0 && day <= 6,
        ),
};

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

export function defaultConfig(): ArgusConfig {
    const [startHour, endHour] = parseRange(
        process.env.ARGUS_WORK_HOURS,
        9,
        17,
    );
    const [dayStart, dayEnd] = parseRange(process.env.ARGUS_WORK_DAYS, 1, 5);
    const orgSlug = process.env.ARGUS_ORG_SLUG ?? "";
    return {
        me: process.env.ARGUS_ME ?? null,
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
        deployWindowDays: Number(process.env.ARGUS_DEPLOY_WINDOW_DAYS ?? 14),
        // Repo name -> build pipeline definition id, for deploy tracking. Set it in
        // argus.config.json.
        repoPipelines: {},
        recencyDays: Number(process.env.ARGUS_RECENCY_DAYS ?? 7),
        retentionDays: Number(process.env.ARGUS_LOG_RETENTION_DAYS ?? 2),
        workStartHour: startHour,
        workEndHour: endHour,
        workDays: inclusiveRange(dayStart, dayEnd),
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
