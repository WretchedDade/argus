import { Check, Loader2, Minus, X } from "lucide-react";
import type { DeployEnv, PrDeploy } from "../lib/api";

type Tone = "shipped" | "deploying" | "failed" | "pending" | "none";

const SUCCESS = new Set([
    "succeeded",
    "succeededwithissues",
    "partiallysucceeded",
]);
const FAILED = new Set(["failed", "canceled", "cancelled"]);

function toneOf(env: DeployEnv | null): Tone {
    if (!env) return "none";
    const result = (env.result ?? "").toLowerCase();
    if (SUCCESS.has(result)) return "shipped";
    if (FAILED.has(result)) return "failed";
    if (env.state === "inProgress") return "deploying";
    return "pending";
}

// Prod is "live" when its deploy stage actually succeeded (not skipped/pending).
export function isProdLive(deploy: PrDeploy): boolean {
    return (
        !!deploy.prod && SUCCESS.has((deploy.prod.result ?? "").toLowerCase())
    );
}

// Redundant coding: each state has a distinct ICON (shape) as well as color, so
// it reads without relying on hue. The icon is the primary cue.
const TONE_META: Record<
    Tone,
    { anchor: string; text: string; Icon: typeof Check; spin?: boolean }
> = {
    shipped: { anchor: "--color-green-500", text: "live", Icon: Check },
    deploying: {
        anchor: "--color-amber-500",
        text: "deploying",
        Icon: Loader2,
        spin: true,
    },
    failed: { anchor: "--color-rose-500", text: "failed", Icon: X },
    pending: { anchor: "--color-muted", text: "not yet", Icon: Minus },
    none: { anchor: "--color-muted", text: "n/a", Icon: Minus },
};

const ENVS: { key: "dev" | "ppe" | "prod"; label: string }[] = [
    { key: "dev", label: "Dev" },
    { key: "ppe", label: "PPE" },
    { key: "prod", label: "Prod" },
];

function Chip({ label, env }: { label: string; env: DeployEnv | null }) {
    const tone = toneOf(env);
    const { anchor, text, Icon, spin } = TONE_META[tone];
    const muted = tone === "none" || tone === "pending";
    return (
        <span
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
            style={{
                borderColor: `color-mix(in srgb, var(${anchor}) ${muted ? 32 : 48}%, var(--color-line))`,
                background: muted
                    ? "transparent"
                    : `color-mix(in srgb, var(${anchor}) 15%, transparent)`,
                color: muted
                    ? "var(--color-muted)"
                    : `color-mix(in srgb, var(${anchor}) 64%, var(--color-fg))`,
            }}
            title={`${label}: ${text}`}
        >
            <Icon
                size={11}
                className={`shrink-0${spin ? " animate-spin" : ""}`}
                strokeWidth={2.75}
            />
            {label}
        </span>
    );
}

// The dev/ppe/prod deploy state for a merged PR. Renders a muted hint when Argus
// couldn't map the PR to a build (no configured pipeline, or not resolved yet).
export function DeployChips({ deploy }: { deploy: PrDeploy }) {
    if (!deploy.found) {
        const label =
            deploy.reason === "no-pipeline"
                ? "no pipeline"
                : deploy.reason === "no-build"
                  ? "no build found"
                  : "resolving…";
        return <span className="text-muted text-[11px]">{label}</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            {ENVS.map((e) => (
                <Chip key={e.key} label={e.label} env={deploy[e.key]} />
            ))}
        </div>
    );
}
