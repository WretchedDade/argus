import { useState } from "react";
import { ActionIcon, Badge, Button, Card, Menu, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import {
    AlarmClock,
    AlarmClockOff,
    Ban,
    Bot,
    Building2,
    Check,
    ChevronDown,
    Clock,
    ExternalLink,
    GitPullRequest,
    ListChecks,
    Loader2,
    MessageSquareText,
    RefreshCw,
    RotateCcw,
    X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Pr, type ReviewActionMode } from "../lib/api";
import { resolveTeamLabel, shortAge, timeUntil } from "../lib/format";
import { teamAnchor } from "../lib/teamColor";
import { isSnoozed, REVIEW_STATE_META } from "../lib/triage";
import { pushToast } from "../lib/toast";
import { usePending } from "../lib/usePending";
import { MarkdownPreview } from "./MarkdownPreview";

// Unreviewed PRs use the selected accent.
function accentVar(pr: Pr): string {
    return pr.reviewState
        ? REVIEW_STATE_META[pr.reviewState].anchor
        : "--mantine-primary-color-filled";
}

function StatePill({ pr, small = false }: { pr: Pr; small?: boolean }) {
    if (!pr.reviewState) return null;
    const meta = REVIEW_STATE_META[pr.reviewState];
    return (
        <Badge
            className="shrink-0"
            size={small ? "xs" : "sm"}
            variant="light"
            color={`var(${meta.anchor})`}
        >
            {meta.label}
        </Badge>
    );
}

// PR size from files changed, as a t-shirt bucket + count. Color goes green→red
// with size, so a big review is obvious at a glance.
const SIZE_BUCKETS: { max: number; label: string; anchor: string }[] = [
    { max: 2, label: "XS", anchor: "--color-green-500" },
    { max: 6, label: "S", anchor: "--color-teal-500" },
    { max: 15, label: "M", anchor: "--color-amber-500" },
    { max: 40, label: "L", anchor: "--color-orange-500" },
    { max: Infinity, label: "XL", anchor: "--color-rose-500" },
];

function SizeChip({ files }: { files: number | null }) {
    if (files == null) return null;
    const b = SIZE_BUCKETS.find((x) => files <= x.max)!;
    return (
        <Badge
            component="span"
            className="ml-1 shrink-0"
            size="xs"
            radius="sm"
            variant="light"
            color={`var(${b.anchor})`}
            title={`${files} file${files === 1 ? "" : "s"} changed`}
        >
            {b.label} · {files}f
        </Badge>
    );
}

function TeamDots({
    teams,
    labels,
}: {
    teams: string[];
    labels: Record<string, string>;
}) {
    return (
        <>
            {teams.map((t) => (
                <Badge
                    component="span"
                    key={t}
                    className="shrink-0"
                    size="xs"
                    radius="sm"
                    variant="light"
                    color={teamAnchor(t)}
                >
                    {resolveTeamLabel(t, labels)}
                </Badge>
            ))}
        </>
    );
}

// Keep action clicks separate from PR navigation.
const swallow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
};

function Tip({
    label,
    children,
    wide = false,
}: {
    label: string;
    children: React.ReactElement;
    wide?: boolean;
}) {
    return (
        <Tooltip
            label={label}
            withArrow
            openDelay={250}
            events={{ hover: true, focus: true, touch: false }}
            multiline={wide}
            w={wide ? 288 : undefined}
            maw="calc(100vw - 2rem)"
        >
            {children}
        </Tooltip>
    );
}

function ActionBtn({
    icon: Icon,
    label,
    onClick,
    spinning = false,
}: {
    icon: typeof Ban;
    label: string;
    onClick?: () => void;
    spinning?: boolean;
}) {
    return (
        <Tip label={label}>
            <ActionIcon
                variant="subtle"
                color="gray"
                type="button"
                aria-label={label}
                disabled={spinning}
                onClick={(e) => {
                    swallow(e);
                    onClick?.();
                }}
            >
                <Icon
                    size={14}
                    className={spinning ? "animate-spin" : undefined}
                />
            </ActionIcon>
        </Tip>
    );
}

function snoozeUntil(kind: "1h" | "4h" | "tomorrow" | "week"): string {
    const d = new Date();
    if (kind === "1h") d.setHours(d.getHours() + 1);
    else if (kind === "4h") d.setHours(d.getHours() + 4);
    else if (kind === "tomorrow") {
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
    } else d.setDate(d.getDate() + 7);
    return d.toISOString();
}

const SNOOZE_OPTIONS: [Parameters<typeof snoozeUntil>[0], string][] = [
    ["1h", "In 1 hour"],
    ["4h", "In 4 hours"],
    ["tomorrow", "Until tomorrow"],
    ["week", "Next week"],
];

function SnoozeMenu({ pr }: { pr: Pr }) {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const wake = usePending();

    const snooze = async (kind: Parameters<typeof snoozeUntil>[0]) => {
        setOpen(false);
        try {
            await api.setSnooze(pr.canonical, snoozeUntil(kind), "time");
            pushToast("Snoozed");
            void qc.invalidateQueries({ queryKey: ["prs"] });
            void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
        } catch {
            pushToast("Couldn't snooze", "error");
        }
    };

    const snoozeFte = async () => {
        setOpen(false);
        try {
            await api.setSnooze(pr.canonical, null, "fte");
            pushToast("Snoozed until an FTE approves");
            void qc.invalidateQueries({ queryKey: ["prs"] });
            void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
        } catch {
            pushToast("Couldn't snooze", "error");
        }
    };

    const clearSnooze = () =>
        wake.run(async () => {
            try {
                await api.setSnooze(pr.canonical, null, null);
                pushToast("Snooze cleared");
                void qc.invalidateQueries({ queryKey: ["prs"] });
                void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
            } catch {
                pushToast("Couldn't clear snooze", "error");
            }
        });

    // Already snoozed: the snooze action is meaningless, so offer a wake instead.
    if (isSnoozed(pr)) {
        return (
            <Tip label="Wake now">
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    type="button"
                    aria-label="Wake now"
                    disabled={wake.pending}
                    onClick={(e) => {
                        swallow(e);
                        clearSnooze();
                    }}
                >
                    {wake.pending ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <AlarmClockOff size={14} />
                    )}
                </ActionIcon>
            </Tip>
        );
    }

    return (
        <Menu
            opened={open}
            onChange={setOpen}
            position="top-end"
            withinPortal
            shadow="md"
        >
            <Menu.Target>
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Snooze"
                    onClick={(event) => event.stopPropagation()}
                >
                    <AlarmClock size={14} />
                    <ChevronDown size={11} />
                </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                {SNOOZE_OPTIONS.map(([kind, label]) => (
                    <Menu.Item key={kind} onClick={() => void snooze(kind)}>
                        {label}
                    </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item onClick={() => void snoozeFte()}>
                    Until an FTE approves
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}

export function ActionBar({ pr }: { pr: Pr }) {
    const qc = useQueryClient();
    const [refreshing, setRefreshing] = useState(false);
    const scope = usePending();
    const reviewReq = useMutation({
        mutationFn: (mode: ReviewActionMode) => api.review(pr.canonical, mode),
        onSuccess: (_data, mode) => {
            pushToast(
                mode === "delegate" ? "Delegate requested" : "Review requested",
            );
            void qc.invalidateQueries({ queryKey: ["prs"] });
            void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
        },
        onError: () => pushToast("Couldn't start review", "error"),
    });

    const markOutOfScope = () =>
        scope.run(async () => {
            try {
                await api.setScope(pr.canonical, true);
                pushToast("Marked out of scope");
                void qc.invalidateQueries({ queryKey: ["prs"] });
                void qc.invalidateQueries({ queryKey: ["pr", pr.canonical] });
            } catch {
                pushToast("Couldn't update scope", "error");
            }
        });

    const refresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        try {
            await api.refreshPr(pr.canonical);
            pushToast("Refreshed");
            void qc.invalidateQueries({ queryKey: ["prs"] });
        } catch {
            pushToast("Refresh failed", "error");
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div className="relative z-20 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
            <Tip
                label="Copilot reviews first. You add findings and approve comments and the vote."
                wide
            >
                <Button
                    size="xs"
                    className="shrink-0"
                    variant="filled"
                    type="button"
                    disabled={reviewReq.isPending}
                    onClick={(e) => {
                        swallow(e);
                        reviewReq.mutate("for-me");
                    }}
                >
                    {reviewReq.isPending && (
                        <Loader2 size={12} className="animate-spin" />
                    )}
                    Review for me
                </Button>
            </Tip>

            <Tip
                label="You lead step by step. Copilot fills the gaps. You approve comments and the vote."
                wide
            >
                <Button
                    size="xs"
                    className="shrink-0"
                    variant="default"
                    type="button"
                    disabled={reviewReq.isPending}
                    onClick={(e) => {
                        swallow(e);
                        reviewReq.mutate("with-me");
                    }}
                >
                    Review with me
                </Button>
            </Tip>
            <Tip
                label="Copilot can approve without asking, but only with zero findings. It posts no comments."
                wide
            >
                <Button
                    size="xs"
                    className="shrink-0"
                    variant="default"
                    leftSection={<Bot size={12} />}
                    type="button"
                    disabled={reviewReq.isPending}
                    onClick={(e) => {
                        swallow(e);
                        reviewReq.mutate("delegate");
                    }}
                >
                    Delegate
                </Button>
            </Tip>

            <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <SnoozeMenu pr={pr} />
                <ActionBtn
                    icon={RefreshCw}
                    label="Refresh"
                    onClick={refresh}
                    spinning={refreshing}
                />
                <Tip label="Open in Azure DevOps">
                    <ActionIcon
                        component="a"
                        variant="subtle"
                        color="gray"
                        href={pr.canonical}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Open in Azure DevOps"
                    >
                        <ExternalLink size={14} />
                    </ActionIcon>
                </Tip>
                <ActionBtn
                    icon={Ban}
                    label="Out of scope"
                    onClick={markOutOfScope}
                    spinning={scope.pending}
                />
            </div>
        </div>
    );
}

// Other reviewers' votes, grouped by kind and shown as tinted chips (concerns
// first). Gives visibility into who's already weighed in even when it's still
// your turn — handy when an FTE-snooze wakes.
const VOTE_META: Record<
    number,
    { label: string; anchor: string; Icon: typeof Check }
> = {
    10: { label: "Approved by", anchor: "--color-green-500", Icon: Check },
    5: {
        label: "Suggestions from",
        anchor: "--color-emerald-500",
        Icon: MessageSquareText,
    },
    [-5]: {
        label: "Waiting on author:",
        anchor: "--color-orange-500",
        Icon: Clock,
    },
    [-10]: { label: "Rejected by", anchor: "--color-rose-500", Icon: X },
};
const VOTE_ORDER = [-10, -5, 5, 10];

export function VoteChips({
    votes,
}: {
    votes: { name: string; vote: number }[];
}) {
    if (votes.length === 0) return null;
    const groups = VOTE_ORDER.map((v) => ({
        v,
        names: votes.filter((x) => x.vote === v).map((x) => x.name),
    })).filter((g) => g.names.length > 0);
    if (groups.length === 0) return null;
    return (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
            {groups.map(({ v, names }) => {
                const m = VOTE_META[v];
                return (
                    <Badge
                        component="span"
                        key={v}
                        variant="light"
                        color={`var(${m.anchor})`}
                        radius="sm"
                        size="sm"
                        h="auto"
                        py={4}
                        styles={{ label: { whiteSpace: "normal" } }}
                        leftSection={<m.Icon size={12} />}
                    >
                        {m.label} {names.join(", ")}
                    </Badge>
                );
            })}
        </div>
    );
}

// Roomy card for action buckets; compact one-liner for parked/reviewed buckets.
export function PrCard({
    pr,
    labels,
    variant = "full",
    onRestore,
}: {
    pr: Pr;
    labels: Record<string, string>;
    variant?: "full" | "compact";
    onRestore?: () => void | Promise<void>;
}) {
    const accent = accentVar(pr);
    const restore = usePending();
    const snoozed = isSnoozed(pr);

    if (variant === "compact") {
        return (
            <Link
                to="/pr"
                search={{ c: pr.canonical }}
                className="pr-card group relative flex flex-wrap items-center gap-2 overflow-hidden rounded-md border py-1.5 pl-3 pr-2 text-xs transition sm:flex-nowrap"
                style={{
                    borderColor: `color-mix(in srgb, var(${accent}) 42%, var(--color-line))`,
                    background: `color-mix(in srgb, var(${accent}) 13%, var(--card-bg))`,
                }}
            >
                <span
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: `var(${accent})` }}
                />
                {pr.isDraft && (
                    <span className="border-line text-muted shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide">
                        draft
                    </span>
                )}
                {pr.isVendor && (
                    <span className="border-line text-muted shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide">
                        vendor
                    </span>
                )}
                <span className="text-fg min-w-0 flex-1 basis-36 truncate sm:basis-auto">
                    {pr.title}
                </span>
                <span className="text-muted shrink-0">
                    {pr.repo} #{pr.number}
                </span>
                <SizeChip files={pr.changedFiles} />
                <StatePill pr={pr} small />
                {pr.reviewState === "covered" && (
                    <span
                        className="text-muted max-w-[14rem] shrink-0 truncate"
                        title="Approvals on this PR, and when it became covered"
                    >
                        approved by{" "}
                        {pr.otherVotes
                            .filter((v) => v.vote >= 5)
                            .map((v) => v.name)
                            .join(", ") || "a teammate"}
                        {pr.coveredAt ? ` · ${shortAge(pr.coveredAt)}` : ""}
                    </span>
                )}
                <span
                    className="text-muted inline-flex shrink-0 items-center gap-1"
                    title="Completed reviews by me"
                >
                    <ListChecks size={11} />
                    {pr.reviewCount}
                </span>
                {snoozed && pr.snoozeMode === "fte" ? (
                    <span className="text-muted inline-flex shrink-0 items-center gap-1">
                        <AlarmClock size={11} /> until FTE
                    </span>
                ) : snoozed && pr.snoozedUntil ? (
                    <span className="text-muted inline-flex shrink-0 items-center gap-1">
                        <AlarmClock size={11} /> {timeUntil(pr.snoozedUntil)}
                    </span>
                ) : (
                    <span className="text-muted shrink-0 tabular-nums">
                        {shortAge(pr.updatedAt)}
                    </span>
                )}
                {onRestore && (
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        type="button"
                        aria-label="Back to review"
                        disabled={restore.pending}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            restore.run(async () => {
                                await onRestore();
                            });
                        }}
                        className="relative z-20 shrink-0"
                    >
                        <RotateCcw
                            size={13}
                            className={
                                restore.pending ? "animate-spin" : undefined
                            }
                        />
                    </ActionIcon>
                )}
            </Link>
        );
    }

    return (
        <Card
            withBorder
            padding="md"
            shadow="xs"
            className="relative flex min-h-[150px] flex-col justify-between"
        >
            <Card.Section
                renderRoot={(props) => (
                    <Link to="/pr" search={{ c: pr.canonical }} {...props} />
                )}
                aria-label={pr.title}
                p="md"
                pb="sm"
                className="pr-card-body flex flex-col gap-1.5"
            >
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-muted flex min-w-0 items-center gap-1.5 text-xs">
                        <GitPullRequest size={12} className="shrink-0" />
                        <span className="text-fg truncate font-semibold">
                            {pr.repo}
                        </span>
                        <span className="shrink-0">#{pr.number}</span>
                        {pr.isDraft && (
                            <span className="border-line text-muted ml-1 shrink-0 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
                                draft
                            </span>
                        )}
                        {pr.isVendor && (
                            <span className="border-line text-muted ml-1 inline-flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
                                <Building2 size={9} />
                                vendor
                            </span>
                        )}
                        <SizeChip files={pr.changedFiles} />
                    </div>
                    <StatePill pr={pr} />
                </div>

                <h3 className="text-fg line-clamp-2 text-[15px] font-semibold leading-tight">
                    {pr.title}
                </h3>

                {pr.description && <MarkdownPreview text={pr.description} />}

                <VoteChips votes={pr.otherVotes} />
            </Card.Section>

            <Card.Section p="md" pt={0} className="flex flex-col gap-2.5">
                <div className="text-muted flex items-center gap-2.5 text-[11px]">
                    {pr.author && (
                        <span className="truncate">by {pr.author}</span>
                    )}
                    <span className="inline-flex shrink-0 items-center gap-1">
                        <Clock size={11} />
                        {shortAge(pr.updatedAt)}
                    </span>
                    <span
                        className="inline-flex shrink-0 items-center gap-1"
                        title="Completed reviews by me"
                    >
                        <ListChecks size={11} />
                        My reviews: {pr.reviewCount}
                    </span>
                    {pr.teams.length > 0 && (
                        <div className="ml-auto flex items-center gap-1">
                            <TeamDots teams={pr.teams} labels={labels} />
                        </div>
                    )}
                </div>
                <ActionBar pr={pr} />
            </Card.Section>
        </Card>
    );
}
