import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { configQuery, prsQuery, type Pr, type PrReviewState } from "../lib/api";
import { SegToggle } from "../components/SegToggle";
import { REVIEW_STATE_META } from "../lib/triage";
import { resolveTeamLabel, shortAge, shortRepo } from "../lib/format";

export const Route = createFileRoute("/tracked")({
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureQueryData(prsQuery),
            context.queryClient.ensureQueryData(configQuery),
        ]),
    component: TrackedPage,
});

type GroupBy = "repo" | "author" | "state" | "none";

const STATE_ORDER = [
    "needs",
    "covered",
    "suggestions",
    "waiting",
    "approved",
    "rejected",
];

function stateLabel(pr: Pr): string {
    if (pr.role === "author") return "Authored by me";
    if (pr.isDraft) return "Draft";
    return pr.reviewState
        ? REVIEW_STATE_META[pr.reviewState].label
        : "No standing";
}

function groupKey(pr: Pr, by: Exclude<GroupBy, "none">): string {
    if (by === "repo") return shortRepo(pr.repo);
    if (by === "author") return pr.author ?? "Unknown author";
    return stateLabel(pr);
}

function orderGroups(entries: [string, Pr[]][], by: GroupBy): [string, Pr[]][] {
    if (by === "state") {
        const rank = (label: string) => {
            const i = STATE_ORDER.findIndex(
                (s) => REVIEW_STATE_META[s as PrReviewState]?.label === label,
            );
            return i === -1 ? STATE_ORDER.length + 1 : i;
        };
        return [...entries].sort(
            (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
        );
    }
    return [...entries].sort(
        (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
}

function groupList(prs: Pr[], by: GroupBy): [string, Pr[]][] {
    if (by === "none") return [["", prs]];
    const map = new Map<string, Pr[]>();
    for (const p of prs) {
        const k = groupKey(p, by);
        (map.get(k) ?? map.set(k, []).get(k)!).push(p);
    }
    return orderGroups([...map.entries()], by);
}

const byRecent = (a: Pr, b: Pr) =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

// One scannable line: a small state dot, the title, then muted meta. No pills.
function TrackedRow({ pr }: { pr: Pr }) {
    const anchor = pr.reviewState
        ? REVIEW_STATE_META[pr.reviewState].anchor
        : "--color-muted";
    const meta = [
        `${shortRepo(pr.repo)} #${pr.number}`,
        pr.author,
        `${shortAge(pr.updatedAt)} idle`,
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <a
            href={pr.canonical}
            target="_blank"
            rel="noreferrer"
            className="hover:bg-surface flex items-center gap-3 px-4 py-2"
        >
            <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(${anchor})` }}
                title={stateLabel(pr)}
            />
            <div className="min-w-0 flex-1">
                <div className="text-fg truncate text-sm">
                    {pr.isDraft && (
                        <span className="text-muted mr-1.5 text-xs">draft</span>
                    )}
                    {pr.title}
                </div>
                <div className="text-muted truncate text-xs">{meta}</div>
            </div>
        </a>
    );
}

function TrackedGroup({
    name,
    prs,
    secondary,
}: {
    name: string;
    prs: Pr[];
    secondary: GroupBy;
}) {
    const [open, setOpen] = useState(true);
    const subgroups = secondary === "none" ? null : groupList(prs, secondary);
    return (
        <section
            className="border-line overflow-hidden rounded-xl border"
            style={{ background: "var(--card-bg)" }}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="hover:bg-surface flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
                {open ? (
                    <ChevronDown size={15} className="text-muted shrink-0" />
                ) : (
                    <ChevronRight size={15} className="text-muted shrink-0" />
                )}
                <span className="text-fg text-sm font-semibold">{name}</span>
                <span className="text-muted text-xs">{prs.length}</span>
            </button>
            {open &&
                (subgroups ? (
                    <div className="border-line flex flex-col border-t">
                        {subgroups.map(([subName, subPrs]) => (
                            <div
                                key={subName}
                                className="border-line border-t first:border-t-0"
                            >
                                <div className="text-muted flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide">
                                    {subName}
                                    <span className="opacity-70">
                                        {subPrs.length}
                                    </span>
                                </div>
                                {[...subPrs].sort(byRecent).map((pr) => (
                                    <TrackedRow key={pr.canonical} pr={pr} />
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="border-line flex flex-col border-t">
                        {[...prs].sort(byRecent).map((pr) => (
                            <TrackedRow key={pr.canonical} pr={pr} />
                        ))}
                    </div>
                ))}
        </section>
    );
}

function TrackedPage() {
    const prs = useQuery(prsQuery).data ?? [];
    const labels = useQuery(configQuery).data?.teamLabels ?? {};
    const [primary, setPrimary] = useState<GroupBy>("repo");
    const [secondary, setSecondary] = useState<GroupBy>("none");
    const [q, setQ] = useState("");

    const groups = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const filtered = needle
            ? prs.filter((p) => {
                  const teamText = p.teams
                      .map((t) => resolveTeamLabel(t, labels))
                      .join(" ");
                  return `${p.title} ${p.repo} #${p.number} ${p.author ?? ""} ${teamText}`
                      .toLowerCase()
                      .includes(needle);
              })
            : prs;
        return groupList(filtered, primary);
    }, [prs, labels, primary, q]);

    const shown = groups.reduce((n, [, list]) => n + list.length, 0);
    const secondaryOptions = (
        [
            { v: "none", label: "None" },
            { v: "repo", label: "Repo" },
            { v: "author", label: "Author" },
            { v: "state", label: "State" },
        ] as { v: GroupBy; label: string }[]
    ).filter((o) => o.v !== primary);

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-fg text-lg font-semibold">
                        Tracked PRs
                    </h1>
                    <p className="text-muted text-xs">
                        {shown} PR{shown === 1 ? "" : "s"} Argus is watching
                        {q.trim() ? " (filtered)" : ""}
                    </p>
                </div>
                <div className="border-line flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                    <Search size={14} className="text-muted" />
                    <input
                        className="w-44 bg-transparent text-sm outline-none"
                        placeholder="Filter by title, repo, author…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center gap-2">
                    <span className="text-muted">Group by</span>
                    <SegToggle
                        value={primary}
                        onChange={(v) => {
                            setPrimary(v);
                            if (v === secondary) setSecondary("none");
                        }}
                        options={[
                            { v: "repo", label: "Repo" },
                            { v: "author", label: "Author" },
                            { v: "state", label: "State" },
                        ]}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-muted">then</span>
                    <SegToggle
                        value={secondary}
                        onChange={setSecondary}
                        options={secondaryOptions}
                    />
                </div>
            </div>

            {groups.length === 0 ? (
                <p className="text-muted py-10 text-center text-sm">
                    {prs.length === 0
                        ? "Nothing tracked yet."
                        : "No PRs match that filter."}
                </p>
            ) : primary === "none" ? (
                <section
                    className="border-line overflow-hidden rounded-xl border"
                    style={{ background: "var(--card-bg)" }}
                >
                    <div className="flex flex-col">
                        {[...groups[0][1]].sort(byRecent).map((pr) => (
                            <TrackedRow key={pr.canonical} pr={pr} />
                        ))}
                    </div>
                </section>
            ) : (
                <div className="flex flex-col gap-3">
                    {groups.map(([name, list]) => (
                        <TrackedGroup
                            key={name}
                            name={name}
                            prs={list}
                            secondary={secondary}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
