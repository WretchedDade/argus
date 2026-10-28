import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import {
    insightsQuery,
    weeklyReviewFactsQuery,
    type WeeklyReviewEffort,
    type WeeklyReviewFacts,
    type WeeklyReviewPr,
} from "../lib/api";
import { shortRepo } from "../lib/format";
import { pushToast } from "../lib/toast";

function weekRange(offset: number): {
    start: number;
    end: number;
    startKey: string;
    label: string;
} {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7;
    const monday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - dow + offset * 7,
    );
    const end = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 7,
    );
    const friday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 4,
    );
    const fmt = (date: Date) =>
        date.toLocaleDateString([], { month: "short", day: "numeric" });
    const startKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    return {
        start: monday.getTime(),
        end: end.getTime(),
        startKey,
        label: `${fmt(monday)} – ${fmt(friday)}`,
    };
}

export const Route = createFileRoute("/recap")({
    loader: ({ context }) => {
        const week = weekRange(0);
        return Promise.all([
            context.queryClient.ensureQueryData(insightsQuery),
            context.queryClient.ensureQueryData(
                weeklyReviewFactsQuery(week.startKey),
            ),
        ]);
    },
    component: RecapPage,
});

type RhythmItem = {
    at: string;
    repo: string;
    team: string | null;
    number: number;
    title: string;
    verdict: string | null;
};
type BalanceDay = {
    key: string;
    inflow: number;
    throughput: number;
    level: number;
};
type EffortKey = Exclude<keyof WeeklyReviewEffort, "score">;

const SITTING_GAP_MIN = 45;
const EFFORT_META: {
    key: EffortKey;
    label: string;
    desc: string;
    color: string;
}[] = [
    {
        key: "size",
        label: "Change size",
        desc: "Files changed",
        color: "var(--peacock-blue)",
    },
    {
        key: "updates",
        label: "Update churn",
        desc: "PR revisions",
        color: "var(--peacock-indigo)",
    },
    {
        key: "depth",
        label: "Review depth",
        desc: "Lane and your comments",
        color: "var(--peacock-teal)",
    },
    {
        key: "discussion",
        label: "Discussion",
        desc: "Comments from others",
        color: "var(--peacock-emerald)",
    },
    {
        key: "revisits",
        label: "Revisits",
        desc: "Additional review actions",
        color: "var(--peacock-gold)",
    },
];
const SCORE_BANDS = [
    { label: "Light", min: 1, max: 3, color: "var(--peacock-blue)" },
    { label: "Moderate", min: 4, max: 6, color: "var(--peacock-teal)" },
    { label: "Heavy", min: 7, max: 9, color: "var(--peacock-gold)" },
    { label: "Intense", min: 10, max: 14, color: "#c75b5b" },
];

function dayKey(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function computeRhythm(
    items: RhythmItem[],
    days: BalanceDay[],
    heavyLine: number,
    win: { start: number; end: number },
) {
    const inWindow = items.filter((item) => {
        const time = Date.parse(item.at);
        return time >= win.start && time < win.end;
    });
    const byDay = new Map<string, number[]>();
    for (const item of inWindow) {
        const date = new Date(item.at);
        const key = dayKey(date.getTime());
        (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(
            date.getHours() * 60 + date.getMinutes(),
        );
    }
    let sittings = 0;
    let busiest: { key: string; count: number } | null = null;
    for (const [key, minutes] of byDay) {
        const sorted = minutes.slice().sort((a, b) => a - b);
        let count = sorted.length ? 1 : 0;
        for (let i = 1; i < sorted.length; i++)
            if (sorted[i] - sorted[i - 1] > SITTING_GAP_MIN) count++;
        sittings += count;
        if (!busiest || sorted.length > busiest.count)
            busiest = { key, count: sorted.length };
    }
    const windowDays = days.filter((day) => {
        const time = Date.parse(day.key);
        return time >= win.start && time < win.end;
    });
    const activeDays = windowDays.filter(
        (day) => day.inflow > 0 || day.throughput > 0 || day.level > 0,
    );
    return {
        sittings,
        busiest,
        activeDays: activeDays.length,
        behind: activeDays.filter((day) => day.inflow > day.throughput).length,
        overload: windowDays.filter((day) => day.level >= heavyLine).length,
    };
}

function aggregateContext(prs: WeeklyReviewPr[], key: "repo" | "authorType") {
    const groups = new Map<string, { prs: number; effort: number }>();
    for (const pr of prs) {
        const label = pr[key];
        const group = groups.get(label) ?? { prs: 0, effort: 0 };
        group.prs++;
        group.effort += pr.effort?.score ?? 0;
        groups.set(label, group);
    }
    return [...groups.entries()]
        .map(([label, values]) => ({ label, ...values }))
        .sort(
            (a, b) =>
                b.effort - a.effort ||
                b.prs - a.prs ||
                a.label.localeCompare(b.label),
        );
}

function SummaryMetric({
    value,
    label,
    detail,
}: {
    value: string;
    label: string;
    detail?: string;
}) {
    return (
        <div className="min-w-0">
            <div className="text-fg text-2xl font-semibold leading-none tabular-nums">
                {value}
            </div>
            <div className="text-muted mt-1 text-xs font-medium">{label}</div>
            {detail && (
                <div className="text-muted/80 mt-0.5 text-[11px]">{detail}</div>
            )}
        </div>
    );
}

function ScorePill({ score }: { score: number }) {
    const band =
        SCORE_BANDS.find((item) => score >= item.min && score <= item.max) ??
        SCORE_BANDS[0];
    return (
        <span
            className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-semibold tabular-nums"
            style={{
                color: `color-mix(in srgb, ${band.color} 72%, var(--color-fg))`,
                background: `color-mix(in srgb, ${band.color} 15%, transparent)`,
            }}
            aria-label={`Effort score ${score} of 14`}
        >
            {score}
        </span>
    );
}

function ComponentChips({ effort }: { effort: WeeklyReviewEffort }) {
    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {EFFORT_META.filter((item) => effort[item.key] > 0).map((item) => (
                <span
                    key={item.key}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                    style={{
                        color: `color-mix(in srgb, ${item.color} 65%, var(--color-fg))`,
                        background: `color-mix(in srgb, ${item.color} 12%, transparent)`,
                    }}
                >
                    {item.label} {effort[item.key]}
                </span>
            ))}
        </div>
    );
}

function RankedReview({ pr }: { pr: WeeklyReviewPr }) {
    if (!pr.effort) return null;
    return (
        <a
            href={pr.canonical}
            target="_blank"
            rel="noreferrer"
            className="border-line group flex items-start gap-3 border-t px-4 py-3 transition-colors first:border-t-0 hover:bg-[color-mix(in_srgb,var(--peacock-teal)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--peacock-teal)]"
        >
            <ScorePill score={pr.effort.score} />
            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                    <span className="text-fg min-w-0 flex-1 text-sm font-medium leading-snug">
                        {pr.title}
                    </span>
                    <ExternalLink
                        size={13}
                        className="text-muted mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                </div>
                <div className="text-muted mt-0.5 text-xs">
                    {shortRepo(pr.repo)} #{pr.number} · {pr.authorType} ·{" "}
                    {pr.reviewActions} action{pr.reviewActions === 1 ? "" : "s"}
                </div>
                <ComponentChips effort={pr.effort} />
            </div>
        </a>
    );
}

function ContextList({
    title,
    items,
    compact = false,
}: {
    title: string;
    items: { label: string; prs: number; effort: number }[];
    compact?: boolean;
}) {
    const maxEffort = Math.max(1, ...items.map((item) => item.effort));
    return (
        <div>
            <h3 className="text-fg text-xs font-semibold">{title}</h3>
            <div className="mt-2 flex flex-col gap-2.5">
                {items.slice(0, compact ? 3 : 6).map((item) => (
                    <div key={item.label}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                            <span className="text-muted truncate">
                                {compact ? item.label : shortRepo(item.label)}
                            </span>
                            <span className="text-fg shrink-0 font-medium tabular-nums">
                                {item.effort} · {item.prs} PR
                                {item.prs === 1 ? "" : "s"}
                            </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]">
                            <div
                                className="h-full rounded-full bg-[var(--peacock-teal)]"
                                style={{
                                    width: `${Math.max(3, (item.effort / maxEffort) * 100)}%`,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function markdownFor(
    facts: WeeklyReviewFacts,
    label: string,
    rhythm: ReturnType<typeof computeRhythm>,
): string {
    const scored = facts.prs.filter(
        (pr): pr is WeeklyReviewPr & { effort: WeeklyReviewEffort } =>
            pr.effort !== null,
    );
    const componentTotals = Object.fromEntries(
        EFFORT_META.map((item) => [
            item.key,
            scored.reduce((total, pr) => total + pr.effort[item.key], 0),
        ]),
    ) as Record<EffortKey, number>;
    const top = scored
        .slice()
        .sort((a, b) => b.effort.score - a.effort.score)
        .slice(0, 5);
    return [
        `## Weekly review effort — ${label}`,
        "",
        `**${facts.uniquePrCount} PRs reviewed through ${facts.actionCount} review actions.**`,
        `**${facts.effort.total} effort units**, averaging ${facts.effort.average?.toFixed(1) ?? "—"} per PR.`,
        "",
        `**Effort mix:** change size ${componentTotals.size}, update churn ${componentTotals.updates}, review depth ${componentTotals.depth}, discussion ${componentTotals.discussion}, revisits ${componentTotals.revisits}.`,
        "",
        "**Highest-effort reviews:**",
        ...top.map(
            (pr) =>
                `- ${shortRepo(pr.repo)} #${pr.number}: ${pr.title} (${pr.effort.score}/14)`,
        ),
        "",
        `**Rhythm:** ${rhythm.sittings} sitting${rhythm.sittings === 1 ? "" : "s"}; ${rhythm.behind} of ${rhythm.activeDays} active days fell behind; ${rhythm.overload} overload day${rhythm.overload === 1 ? "" : "s"}.`,
    ].join("\n");
}

function RecapPage() {
    const [offset, setOffset] = useState(0);
    const week = weekRange(offset);
    const insights = useQuery(insightsQuery).data;
    const factsQuery = useQuery(weeklyReviewFactsQuery(week.startKey));
    const facts = factsQuery.data;

    const rhythm = useMemo(
        () =>
            insights
                ? computeRhythm(
                      insights.reviewRhythm.items,
                      insights.balance.days,
                      insights.balance.heavyLine,
                      week,
                  )
                : null,
        [insights, week.start, week.end],
    );
    const scored = useMemo(
        () =>
            facts?.prs.filter(
                (pr): pr is WeeklyReviewPr & { effort: WeeklyReviewEffort } =>
                    pr.effort !== null,
            ) ?? [],
        [facts],
    );
    const ranked = useMemo(
        () =>
            scored
                .slice()
                .sort(
                    (a, b) =>
                        b.effort.score - a.effort.score ||
                        b.changedFiles! - a.changedFiles!,
                ),
        [scored],
    );
    const componentTotals = useMemo(
        () =>
            Object.fromEntries(
                EFFORT_META.map((item) => [
                    item.key,
                    scored.reduce(
                        (total, pr) => total + pr.effort[item.key],
                        0,
                    ),
                ]),
            ) as Record<EffortKey, number>,
        [scored],
    );
    const maxComponent = Math.max(1, ...Object.values(componentTotals));
    const repos = useMemo(
        () => (facts ? aggregateContext(facts.prs, "repo") : []),
        [facts],
    );
    const authors = useMemo(
        () => (facts ? aggregateContext(facts.prs, "authorType") : []),
        [facts],
    );

    const copy = () => {
        if (!facts || !rhythm) return;
        navigator.clipboard
            .writeText(markdownFor(facts, week.label, rhythm))
            .then(() => pushToast("Weekly review copied"))
            .catch(() => pushToast("Couldn't copy", "error"));
    };

    return (
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-fg text-lg font-semibold">
                        Weekly review effort
                    </h1>
                    <p className="text-muted text-xs">
                        {week.label} · scores use observed review facts, not
                        author or repo
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="border-line inline-flex overflow-hidden rounded-md border text-xs">
                        {[
                            { value: 0, label: "This week" },
                            { value: -1, label: "Last week" },
                        ].map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setOffset(option.value)}
                                className={`px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--peacock-teal)] ${offset === option.value ? "text-fg" : "text-muted hover:text-fg"}`}
                                style={
                                    offset === option.value
                                        ? {
                                              background:
                                                  "color-mix(in srgb, var(--color-fg) 10%, transparent)",
                                          }
                                        : undefined
                                }
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={copy}
                        disabled={!facts || !rhythm}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--peacock-teal)] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: "var(--peacock-teal)" }}
                    >
                        <Copy size={14} /> Copy
                    </button>
                </div>
            </div>

            {factsQuery.isPending || !insights || !rhythm ? (
                <div
                    className="border-line rounded-xl border p-8 text-center text-sm text-muted"
                    style={{ background: "var(--card-bg)" }}
                >
                    Loading weekly review effort…
                </div>
            ) : factsQuery.isError ? (
                <div className="rounded-xl border border-red-500/35 bg-red-500/10 p-5 text-sm text-fg">
                    Weekly review facts could not load. Reload Argus and try
                    again.
                </div>
            ) : !facts || facts.uniquePrCount === 0 ? (
                <div
                    className="border-line rounded-xl border p-8 text-center"
                    style={{ background: "var(--card-bg)" }}
                >
                    <p className="text-fg text-sm font-medium">
                        No reviews recorded for this week.
                    </p>
                    <p className="text-muted mt-1 text-xs">
                        The report fills in after Argus records a review
                        verdict.
                    </p>
                </div>
            ) : (
                <>
                    <section
                        className="border-line rounded-xl border p-5 shadow-sm"
                        style={{ background: "var(--card-bg)" }}
                    >
                        <p className="text-fg max-w-3xl text-base leading-relaxed">
                            You reviewed{" "}
                            <strong>{facts.uniquePrCount} PRs</strong> through{" "}
                            <strong>{facts.actionCount} review actions</strong>.
                            The observed work adds up to{" "}
                            <strong>{facts.effort.total} effort units</strong>.
                        </p>
                        <div className="border-line mt-5 grid grid-cols-2 gap-5 border-t pt-5 sm:grid-cols-4">
                            <SummaryMetric
                                value={String(facts.uniquePrCount)}
                                label="PRs reviewed"
                            />
                            <SummaryMetric
                                value={String(facts.actionCount)}
                                label="Review actions"
                                detail={`${facts.actionCount - facts.uniquePrCount} revisits beyond first review`}
                            />
                            <SummaryMetric
                                value={String(facts.effort.total)}
                                label="Effort units"
                                detail="Sum of per-PR scores"
                            />
                            <SummaryMetric
                                value={facts.effort.average?.toFixed(1) ?? "—"}
                                label="Average effort"
                                detail="Out of 14 per PR"
                            />
                        </div>
                        {facts.coverage.scoreKnown < facts.uniquePrCount && (
                            <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">
                                {facts.uniquePrCount -
                                    facts.coverage.scoreKnown}{" "}
                                PR
                                {facts.uniquePrCount -
                                    facts.coverage.scoreKnown ===
                                1
                                    ? " is"
                                    : "s are"}{" "}
                                waiting for complete size or comment data.
                            </p>
                        )}
                    </section>

                    <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                        <section
                            className="border-line rounded-xl border p-5 shadow-sm"
                            style={{ background: "var(--card-bg)" }}
                        >
                            <div className="mb-4">
                                <h2 className="text-fg text-sm font-semibold">
                                    What drove the effort
                                </h2>
                                <p className="text-muted mt-0.5 text-xs">
                                    Component totals across scored PRs. Author
                                    and repo never alter these values.
                                </p>
                            </div>
                            <div className="flex flex-col gap-4">
                                {EFFORT_META.map((item) => (
                                    <div key={item.key}>
                                        <div className="flex items-baseline justify-between gap-3">
                                            <div>
                                                <span className="text-fg text-xs font-medium">
                                                    {item.label}
                                                </span>
                                                <span className="text-muted ml-1.5 text-[11px]">
                                                    {item.desc}
                                                </span>
                                            </div>
                                            <span className="text-fg text-xs font-semibold tabular-nums">
                                                {componentTotals[item.key]}
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)]">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${(componentTotals[item.key] / maxComponent) * 100}%`,
                                                    background: item.color,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section
                            className="border-line rounded-xl border p-5 shadow-sm"
                            style={{ background: "var(--card-bg)" }}
                        >
                            <div className="mb-4">
                                <h2 className="text-fg text-sm font-semibold">
                                    Effort distribution
                                </h2>
                                <p className="text-muted mt-0.5 text-xs">
                                    PR count by score band.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                                {SCORE_BANDS.map((band) => {
                                    const count = scored.filter(
                                        (pr) =>
                                            pr.effort.score >= band.min &&
                                            pr.effort.score <= band.max,
                                    ).length;
                                    return (
                                        <div key={band.label}>
                                            <div className="text-fg text-xl font-semibold tabular-nums">
                                                {count}
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                                                <span
                                                    className="h-2 w-2 rounded-full"
                                                    style={{
                                                        background: band.color,
                                                    }}
                                                />
                                                <span className="text-muted">
                                                    {band.label} · {band.min}–
                                                    {band.max}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="border-line mt-5 border-t pt-4 text-xs">
                                <div className="flex justify-between gap-3">
                                    <span className="text-muted">
                                        Review sittings
                                    </span>
                                    <span className="text-fg font-medium tabular-nums">
                                        {rhythm.sittings}
                                    </span>
                                </div>
                                <div className="mt-2 flex justify-between gap-3">
                                    <span className="text-muted">
                                        Active days behind
                                    </span>
                                    <span className="text-fg font-medium tabular-nums">
                                        {rhythm.behind}/{rhythm.activeDays}
                                    </span>
                                </div>
                                <div className="mt-2 flex justify-between gap-3">
                                    <span className="text-muted">
                                        Overload days
                                    </span>
                                    <span className="text-fg font-medium tabular-nums">
                                        {rhythm.overload}
                                    </span>
                                </div>
                            </div>
                        </section>
                    </div>

                    <section
                        className="border-line overflow-hidden rounded-xl border shadow-sm"
                        style={{ background: "var(--card-bg)" }}
                    >
                        <div className="flex items-baseline justify-between gap-3 px-4 py-4">
                            <div>
                                <h2 className="text-fg text-sm font-semibold">
                                    Highest-effort reviews
                                </h2>
                                <p className="text-muted mt-0.5 text-xs">
                                    The reviews that combined the most change,
                                    depth, discussion, and repeat attention.
                                </p>
                            </div>
                            <span className="text-muted shrink-0 text-xs">
                                Score /14
                            </span>
                        </div>
                        {ranked.slice(0, 10).map((pr) => (
                            <RankedReview key={pr.canonical} pr={pr} />
                        ))}
                    </section>

                    <section
                        className="border-line rounded-xl border p-5 shadow-sm"
                        style={{ background: "var(--card-bg)" }}
                    >
                        <div className="mb-4">
                            <h2 className="text-fg text-sm font-semibold">
                                Where the effort went
                            </h2>
                            <p className="text-muted mt-0.5 text-xs">
                                Context only. These groupings explain the week
                                but do not change a PR score.
                            </p>
                        </div>
                        <div className="grid gap-6 sm:grid-cols-2">
                            <ContextList title="By repository" items={repos} />
                            <ContextList
                                title="By author type"
                                items={authors}
                                compact
                            />
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
