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

export function defaultConfig(): ArgusConfig {
  const [startHour, endHour] = parseRange(process.env.ARGUS_WORK_HOURS, 9, 17);
  const [dayStart, dayEnd] = parseRange(process.env.ARGUS_WORK_DAYS, 1, 5);
  return {
    me: process.env.ARGUS_ME ?? null,
    orgUrl: process.env.ARGUS_ORG_URL ?? "https://dev.azure.com/worldwidelearning",
    orgSlug: process.env.ARGUS_ORG_SLUG ?? "worldwidelearning",
    project: process.env.ARGUS_PROJECT ?? "LPE",
    teamPatterns: splitList(process.env.ARGUS_TEAM_PATTERNS ?? "*Content Lifecycle Engg*,*ASN UI stewards*"),
    teamLabels: {
      "[TEAM FOUNDATION]\\ASN UI stewards": "stewards",
      "[TEAM FOUNDATION]\\MCAPS E&O WWL LPT - Content Lifecycle Engg": "content FTE",
    },
    periods: [],
    reviewSkillName: process.env.ARGUS_REVIEW_SKILL ?? "pr-review",
    deployWindowDays: Number(process.env.ARGUS_DEPLOY_WINDOW_DAYS ?? 14),
    // Seeded repo -> Official build-pipeline definition id, for deploy tracking.
    // Update when a tracked repo gains or loses a deploy pipeline. LPE-specific.
    repoPipelines: {
      "LPE.UI": 4573,
      "LPE.Starfleet.ContentService": 4686,
      "LPE.AdminConsole": 4553,
      "LPE.AdminService": 4544,
      "LPE.Starfleet.ContentRecommendations": 4652,
      "LPE.FeatureFlags": 4594,
    },
    recencyDays: Number(process.env.ARGUS_RECENCY_DAYS ?? 7),
    retentionDays: Number(process.env.ARGUS_LOG_RETENTION_DAYS ?? 2),
    workStartHour: startHour,
    workEndHour: endHour,
    workDays: inclusiveRange(dayStart, dayEnd),
  };
}

// Merge saved overrides onto the defaults, ignoring undefined fields.
export function mergeConfig(base: ArgusConfig, overrides: ConfigOverrides): ArgusConfig {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides) as [keyof ArgusConfig, unknown][]) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function parseRange(value: string | undefined, defA: number, defB: number): [number, number] {
  const m = value?.match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [defA, defB];
}

function inclusiveRange(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
