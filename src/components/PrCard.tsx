import { useId, useState } from "react";
import {
    ActionIcon,
    Anchor,
    Avatar,
    Badge,
    Button,
    Card,
    Center,
    Group,
    HoverCard,
    List,
    Loader,
    Menu,
    OverflowList,
    Popover,
    ScrollArea,
    Spoiler,
    Stack,
    Text,
    Title,
    Tooltip,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import {
    AlarmClock,
    AlarmClockOff,
    Ban,
    Bot,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    ListChecks,
    MessageSquare,
    RefreshCw,
    RotateCcw,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, prDetailQuery, type Pr, type ReviewActionMode } from "../lib/api";
import { resolveTeamLabel, shortAge, timeAgo, timeUntil } from "../lib/format";
import { teamAnchor } from "../lib/teamColor";
import { isSnoozed, REVIEW_STATE_META } from "../lib/triage";
import { pushToast } from "../lib/toast";
import { usePending } from "../lib/usePending";
import { MarkdownPreview } from "./MarkdownPreview";
import { ErrorBanner } from "./ErrorBanner";

function AuthorAvatar({
    author,
    variant = "filled",
}: {
    author: Pr["author"];
    variant?: "filled" | "light";
}) {
    return (
        <Avatar
            name={author || undefined}
            color={author ? "initials" : "gray"}
            size={28}
            variant={variant}
            alt={author || "Unknown author"}
            role="img"
            aria-label={author || "Unknown author"}
        />
    );
}

function PrTitle({
    pr,
    titleId,
    compact = false,
    detail = false,
}: {
    pr: Pr;
    titleId: string;
    compact?: boolean;
    detail?: boolean;
}) {
    return (
        <Stack gap={2} flex={1} miw={0} style={{ overflowWrap: "anywhere" }}>
            <Title
                id={titleId}
                order={detail ? 1 : 3}
                size={compact ? "xs" : "sm"}
                fw={compact ? 400 : 500}
            >
                {detail ? (
                    pr.title
                ) : (
                    <Anchor
                        inherit
                        c="inherit"
                        underline="hover"
                        truncate={compact}
                        title={compact ? pr.title : undefined}
                        style={compact ? { display: "block" } : undefined}
                        renderRoot={(props) => (
                            <Link
                                to="/pr"
                                search={{ c: pr.canonical }}
                                {...props}
                            />
                        )}
                    >
                        {pr.title}
                    </Anchor>
                )}
            </Title>
            <Text size="xs" c="var(--argus-tag-text)">
                {pr.author || "Unknown author"}
            </Text>
        </Stack>
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
            className="shrink-0"
            size="sm"
            radius="sm"
            variant="light"
            color={`var(${b.anchor})`}
            title={`${files} file${files === 1 ? "" : "s"} changed`}
        >
            {b.label} · {files} file{files === 1 ? "" : "s"}
        </Badge>
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
    variant = "subtle",
}: {
    icon: typeof Ban;
    label: string;
    onClick?: () => void;
    spinning?: boolean;
    variant?: "subtle" | "default";
}) {
    return (
        <Tip label={label}>
            <ActionIcon
                variant={variant}
                color="gray"
                type="button"
                aria-label={label}
                disabled={spinning}
                loading={spinning}
                onClick={(e) => {
                    swallow(e);
                    onClick?.();
                }}
            >
                <Icon size={14} />
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
                    variant="default"
                    color="gray"
                    type="button"
                    aria-label="Wake now"
                    disabled={wake.pending}
                    loading={wake.pending}
                    onClick={(e) => {
                        swallow(e);
                        clearSnooze();
                    }}
                >
                    <AlarmClockOff size={14} />
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
                    variant="default"
                    color="gray"
                    aria-label="Snooze"
                    onClick={(event) => event.stopPropagation()}
                >
                    <AlarmClock size={14} />
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

function PrQuickActions({
    pr,
    variant = "subtle",
}: {
    pr: Pr;
    variant?: "subtle" | "default";
}) {
    const qc = useQueryClient();
    const [refreshing, setRefreshing] = useState(false);
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
        <>
            <ActionBtn
                icon={RefreshCw}
                label="Refresh"
                onClick={refresh}
                spinning={refreshing}
                variant={variant}
            />
            <Tip label="Open in Azure DevOps">
                <ActionIcon
                    component="a"
                    variant={variant}
                    color="gray"
                    href={pr.canonical}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Open in Azure DevOps"
                >
                    <ExternalLink size={14} />
                </ActionIcon>
            </Tip>
        </>
    );
}

export function ActionBar({ pr }: { pr: Pr }) {
    const qc = useQueryClient();
    const scope = usePending();
    const reviewMode = pr.lane === "quick" ? "for-me" : "with-me";
    const hasUpdates =
        !!pr.reviewedSha &&
        !!pr.lastCommitSha &&
        pr.reviewedSha !== pr.lastCommitSha;
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

    return (
        <Group gap="xs">
            {pr.reviewSessionId ? (
                <Tip
                    label={`Run ${reviewMode === "for-me" ? "Review for me" : "Review with me"} again in the existing review session.`}
                    wide
                >
                    <Button
                        size="xs"
                        className="shrink-0"
                        variant="filled"
                        leftSection={<RotateCcw size={12} />}
                        type="button"
                        disabled={reviewReq.isPending}
                        loading={reviewReq.isPending}
                        onClick={(e) => {
                            swallow(e);
                            reviewReq.mutate(reviewMode);
                        }}
                    >
                        {hasUpdates ? "Review updates" : "Re-review"}
                    </Button>
                </Tip>
            ) : (
                <>
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
                            loading={
                                reviewReq.isPending &&
                                reviewReq.variables === "for-me"
                            }
                            onClick={(e) => {
                                swallow(e);
                                reviewReq.mutate("for-me");
                            }}
                        >
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
                            loading={
                                reviewReq.isPending &&
                                reviewReq.variables === "with-me"
                            }
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
                            loading={
                                reviewReq.isPending &&
                                reviewReq.variables === "delegate"
                            }
                            onClick={(e) => {
                                swallow(e);
                                reviewReq.mutate("delegate");
                            }}
                        >
                            Delegate
                        </Button>
                    </Tip>
                </>
            )}

            <ActionIcon.Group ml="auto" aria-label="PR actions">
                <SnoozeMenu pr={pr} />
                <PrQuickActions pr={pr} variant="default" />
                <ActionBtn
                    icon={Ban}
                    label="Out of scope"
                    onClick={markOutOfScope}
                    spinning={scope.pending}
                    variant="default"
                />
            </ActionIcon.Group>
        </Group>
    );
}

const VOTE_META: Record<number, { label: string; color: string }> = {
    10: { label: "Approved", color: "green" },
    5: {
        label: "Approved with suggestions",
        color: "green",
    },
    [-5]: {
        label: "Waiting for author",
        color: "yellow",
    },
    [-10]: { label: "Rejected", color: "red" },
};
const VOTE_ORDER = [-10, -5, 5, 10];

export function VoteAvatars({
    votes,
}: {
    votes: { name: string; vote: number }[];
}) {
    const reviewers = VOTE_ORDER.flatMap((v) =>
        votes.filter((reviewer) => reviewer.vote === v),
    );
    if (reviewers.length === 0) return null;
    return (
        <Avatar.Group
            spacing={0}
            ms="auto"
            role="group"
            aria-label="Reviewer votes"
            style={{
                flexWrap: "wrap",
                gap: "var(--mantine-spacing-xs)",
            }}
        >
            {reviewers.map(({ vote, name }, index) => {
                const m = VOTE_META[vote];
                const label = `${name || "Unknown reviewer"}: ${m.label}`;
                return (
                    <Tip key={`${vote}:${name}:${index}`} label={label} wide>
                        <Avatar
                            name={name || undefined}
                            color={m.color}
                            size={28}
                            variant="filled"
                            role="img"
                            aria-label={label}
                            tabIndex={0}
                        />
                    </Tip>
                );
            })}
        </Avatar.Group>
    );
}

function ReviewHistoryContent({ canonical }: { canonical: string }) {
    const history = useQuery(prDetailQuery(canonical));
    const reviews =
        history.data?.events.filter(
            (event) =>
                event.type === "reviewed" ||
                event.type === "review_provisional",
        ) ?? [];
    return (
        <Stack gap="sm" style={{ overflowWrap: "anywhere" }}>
            <Title order={4} size="sm">
                Review history
            </Title>
            {history.isError && (
                <ErrorBanner
                    title="Could not load review history"
                    error={history.error}
                    onRetry={() => void history.refetch()}
                />
            )}
            {history.isPending && (
                <Group gap="xs" role="status" aria-busy="true">
                    <Loader size="xs" />
                    <Text size="xs" c="var(--argus-tag-text)">
                        Loading review history
                    </Text>
                </Group>
            )}
            {reviews.length > 0 ? (
                <List size="xs" spacing="xs">
                    {reviews.map((event) => (
                        <List.Item key={event.id}>
                            <Text size="xs">
                                {event.type === "review_provisional"
                                    ? "Delegate found issues; no vote cast"
                                    : "Reviewed"}
                            </Text>
                            <Text
                                component="time"
                                dateTime={event.ts}
                                title={new Date(event.ts).toLocaleString()}
                                size="xs"
                                c="var(--argus-tag-text)"
                            >
                                {timeAgo(event.ts)}
                            </Text>
                        </List.Item>
                    ))}
                </List>
            ) : history.isSuccess ? (
                <Text size="xs" c="var(--argus-tag-text)">
                    No recorded review events.
                </Text>
            ) : null}
        </Stack>
    );
}

function ReviewHistory({
    pr,
    withState = false,
}: {
    pr: Pr;
    withState?: boolean;
}) {
    const meta = REVIEW_STATE_META[pr.reviewState ?? "needs"];
    const countLabel = `${pr.reviewCount} review${pr.reviewCount === 1 ? "" : "s"}`;
    return (
        <Popover
            position="bottom-start"
            width={360}
            shadow="md"
            trapFocus
            returnFocus
        >
            <Popover.Target>
                <Button
                    type="button"
                    size="xs"
                    variant="subtle"
                    color={withState ? `var(${meta.anchor})` : "gray"}
                    c={withState ? undefined : "var(--argus-tag-text)"}
                    aria-label={`${withState ? `${meta.label}. ` : ""}Review history: ${pr.reviewCount} completed review${pr.reviewCount === 1 ? "" : "s"}`}
                    leftSection={<ListChecks size={14} />}
                    rightSection={<ChevronDown size={12} />}
                >
                    {withState ? (
                        <Group component="span" gap={6} wrap="nowrap">
                            <Text component="span" inherit fw={500}>
                                {meta.label}
                            </Text>
                            <Text
                                component="span"
                                inherit
                                fw={400}
                                c="var(--argus-tag-text)"
                            >
                                · {countLabel}
                            </Text>
                        </Group>
                    ) : (
                        <>My reviews: {pr.reviewCount}</>
                    )}
                </Button>
            </Popover.Target>
            <Popover.Dropdown
                maw="calc(100vw - 2rem)"
                aria-label="Review history"
            >
                <ScrollArea.Autosize
                    mah="50vh"
                    type="auto"
                    offsetScrollbars="y"
                >
                    <ReviewHistoryContent canonical={pr.canonical} />
                </ScrollArea.Autosize>
            </Popover.Dropdown>
        </Popover>
    );
}

interface PrCardProps {
    pr: Pr;
    labels: Record<string, string>;
    onRestore?: () => void | Promise<void>;
}

export function PrCard({
    variant = "full",
    ...props
}: PrCardProps & { variant?: "full" | "compact" }) {
    return variant === "compact" ? (
        <CompactPrCard {...props} />
    ) : (
        <FullPrCard {...props} />
    );
}

function CompactPrCard({ pr, labels, onRestore }: PrCardProps) {
    const titleId = useId();
    const [expanded, setExpanded] = useState(false);
    const [focusExpand, setFocusExpand] = useState(false);
    const restore = usePending();
    const meta = REVIEW_STATE_META[pr.reviewState ?? "needs"];
    const anchor = pr.isDraft ? "--mantine-color-gray-6" : meta.anchor;

    if (expanded) {
        return (
            <FullPrCard
                pr={pr}
                labels={labels}
                onRestore={onRestore}
                onCollapse={() => {
                    setExpanded(false);
                    setFocusExpand(true);
                }}
            />
        );
    }

    return (
        <Card
            component="article"
            className="pr-card-compact"
            aria-labelledby={titleId}
            aria-description={`${pr.isDraft ? "Draft. " : ""}Review status: ${meta.label}`}
            withBorder
            padding="xs"
            bg={`color-mix(in srgb, var(${anchor}) 14%, light-dark(var(--page-base), var(--mantine-color-dark-9)))`}
            style={{
                borderColor: `color-mix(in srgb, var(${anchor}) 30%, var(--mantine-color-default-border))`,
            }}
        >
            <Group component="header" gap="xs" wrap="nowrap">
                <AuthorAvatar author={pr.author} variant="light" />
                <PrTitle pr={pr} titleId={titleId} compact />
                <ActionIcon.Group
                    aria-label="PR actions"
                    style={{ flexShrink: 0 }}
                >
                    <PrQuickActions pr={pr} variant="default" />
                    <Tip label="Expand PR card">
                        <ActionIcon
                            type="button"
                            variant="default"
                            color="gray"
                            aria-label="Expand PR card"
                            aria-expanded={false}
                            autoFocus={focusExpand}
                            disabled={restore.pending}
                            onClick={() => setExpanded(true)}
                        >
                            <ChevronDown size={14} />
                        </ActionIcon>
                    </Tip>
                    {onRestore && (
                        <ActionBtn
                            icon={RotateCcw}
                            label="Back to review"
                            variant="default"
                            spinning={restore.pending}
                            onClick={() =>
                                restore.run(async () => {
                                    await onRestore();
                                })
                            }
                        />
                    )}
                </ActionIcon.Group>
            </Group>
        </Card>
    );
}

export function PrDetailCard(props: PrCardProps) {
    return <FullPrCard {...props} detail />;
}

export function AuthoredPrCard({
    pr,
    labels,
}: Pick<PrCardProps, "pr" | "labels">) {
    const titleId = useId();
    const meta = pr.authorMeta;
    const hasVotes = pr.otherVotes.some(({ vote }) => Boolean(VOTE_META[vote]));
    const createdAt = pr.prCreatedAt ?? pr.updatedAt;
    return (
        <Card
            component="article"
            aria-labelledby={titleId}
            withBorder
            padding="lg"
        >
            <Card.Section component="header" inheritPadding withBorder py="lg">
                <PrCardHeader pr={pr} labels={labels} titleId={titleId} />
            </Card.Section>
            <Card.Section component="footer" inheritPadding withBorder py="lg">
                <Group gap="md">
                    <Text
                        size="xs"
                        c="var(--argus-tag-text)"
                        title={new Date(createdAt).toLocaleString()}
                    >
                        {shortAge(createdAt)} old
                    </Text>
                    {meta &&
                        meta.activeComments + meta.resolvedComments > 0 && (
                            <Group gap={4} role="group" aria-label="Comments">
                                <MessageSquare size={12} aria-hidden />
                                <Text size="xs" c="var(--argus-tag-text)">
                                    {meta.activeComments} active
                                    {meta.resolvedComments > 0
                                        ? ` · ${meta.resolvedComments} resolved`
                                        : ""}
                                </Text>
                            </Group>
                        )}
                    {hasVotes ? (
                        <VoteAvatars votes={pr.otherVotes} />
                    ) : (
                        <Text size="xs" c="var(--argus-tag-text)" ml="auto">
                            No reviewers have voted yet
                        </Text>
                    )}
                    <ActionIcon.Group aria-label="PR actions">
                        <PrQuickActions pr={pr} variant="default" />
                    </ActionIcon.Group>
                </Group>
            </Card.Section>
        </Card>
    );
}

function PrCardHeader({
    pr,
    labels,
    titleId,
    detail = false,
    children,
}: Pick<PrCardProps, "pr" | "labels"> & {
    titleId: string;
    detail?: boolean;
    children?: React.ReactNode;
}) {
    const snoozed = isSnoozed(pr);
    const tags = [
        ...(pr.isDraft
            ? [{ key: "draft", label: "Draft", color: "gray" }]
            : []),
        ...(pr.isVendor
            ? [{ key: "vendor", label: "Vendor", color: "gray" }]
            : []),
        ...(detail && pr.outOfScope
            ? [{ key: "out-of-scope", label: "Out of scope", color: "gray" }]
            : []),
        ...pr.teams.map((team) => ({
            key: `team:${team}`,
            label: resolveTeamLabel(team, labels),
            color: teamAnchor(team),
        })),
    ];
    const snoozeLabel =
        pr.snoozeMode === "fte"
            ? "Snoozed until an FTE approves"
            : pr.snoozedUntil
              ? `Snoozed ${timeUntil(pr.snoozedUntil)}`
              : null;
    return (
        <Stack gap="md">
            <Stack gap="md">
                <Group justify="space-between" align="flex-start" gap="xs">
                    <Group flex="1 1 16rem" miw={0} gap="xs" wrap="nowrap">
                        <AuthorAvatar author={pr.author} />
                        <PrTitle pr={pr} titleId={titleId} detail={detail} />
                    </Group>
                    <SizeChip files={pr.changedFiles} />
                    {children}
                </Group>
                <Group gap="md">
                    <Text
                        size="xs"
                        c="var(--argus-tag-text)"
                        style={{ overflowWrap: "anywhere" }}
                    >
                        {pr.repo} #{pr.number}
                    </Text>
                    <Text
                        size="xs"
                        c="var(--argus-tag-text)"
                        title={new Date(pr.updatedAt).toLocaleString()}
                    >
                        Updated {shortAge(pr.updatedAt)} ago
                    </Text>
                </Group>
            </Stack>
            {tags.length > 0 && (
                <OverflowList
                    data={tags}
                    getItemKey={(tag) => tag.key}
                    gap={4}
                    renderItem={(tag) => (
                        <Badge
                            key={tag.key}
                            component="span"
                            variant="filled"
                            color={tag.color}
                            size="sm"
                            radius="sm"
                            title={tag.label}
                        >
                            {tag.label}
                        </Badge>
                    )}
                    renderOverflow={(items) => (
                        <Center>
                            <HoverCard
                                width={280}
                                position="bottom-end"
                                role="tooltip"
                                events={{ touch: true }}
                            >
                                <HoverCard.Target>
                                    <Badge
                                        component="button"
                                        type="button"
                                        size="sm"
                                        radius="sm"
                                        variant="light"
                                        color="gray"
                                        aria-label={`${items.length} more PR labels`}
                                    >
                                        +{items.length} more
                                    </Badge>
                                </HoverCard.Target>
                                <HoverCard.Dropdown>
                                    <Stack gap="xs">
                                        {items.map((tag) => (
                                            <Text
                                                key={tag.key}
                                                size="xs"
                                                style={{
                                                    overflowWrap: "anywhere",
                                                }}
                                            >
                                                {tag.label}
                                            </Text>
                                        ))}
                                    </Stack>
                                </HoverCard.Dropdown>
                            </HoverCard>
                        </Center>
                    )}
                />
            )}
            {snoozed && snoozeLabel && (
                <Group gap={4}>
                    <AlarmClock size={12} aria-hidden />
                    <Text size="xs" c="var(--argus-tag-text)">
                        {snoozeLabel}
                    </Text>
                </Group>
            )}
        </Stack>
    );
}

function FullPrCard({
    pr,
    labels,
    onRestore,
    onCollapse,
    detail = false,
}: PrCardProps & {
    onCollapse?: () => void;
    detail?: boolean;
}) {
    const id = useId();
    const titleId = `${id}-title`;
    const contentId = `${id}-content`;
    const restore = usePending();
    const padding = onCollapse ? "md" : "lg";
    const description = <MarkdownPreview text={pr.description} clamp={false} />;
    return (
        <Card
            component="article"
            aria-labelledby={titleId}
            withBorder
            padding={padding}
        >
            <Card.Section
                component="header"
                inheritPadding
                withBorder
                py={padding}
            >
                <PrCardHeader
                    pr={pr}
                    labels={labels}
                    titleId={titleId}
                    detail={detail}
                >
                    {onCollapse && (
                        <Group gap={2} wrap="nowrap">
                            <Tip label="Collapse PR card">
                                <ActionIcon
                                    type="button"
                                    variant="subtle"
                                    color="gray"
                                    aria-label="Collapse PR card"
                                    aria-expanded
                                    aria-controls={contentId}
                                    autoFocus
                                    disabled={restore.pending}
                                    onClick={onCollapse}
                                >
                                    <ChevronUp size={14} />
                                </ActionIcon>
                            </Tip>
                            {onRestore && (
                                <Tip label="Back to review">
                                    <ActionIcon
                                        type="button"
                                        variant="subtle"
                                        color="gray"
                                        aria-label="Back to review"
                                        disabled={restore.pending}
                                        loading={restore.pending}
                                        onClick={() =>
                                            restore.run(async () => {
                                                await onRestore();
                                            })
                                        }
                                    >
                                        <RotateCcw size={14} />
                                    </ActionIcon>
                                </Tip>
                            )}
                        </Group>
                    )}
                </PrCardHeader>
            </Card.Section>
            <Card.Section
                component="section"
                aria-label="PR details"
                id={contentId}
                inheritPadding
                withBorder
                py="md"
                bg="var(--mantine-color-default-hover)"
            >
                <Stack gap="md">
                    {pr.description && (
                        <Text
                            component="div"
                            lineClamp={detail ? undefined : 4}
                            aria-label="PR description"
                            style={{ overflowWrap: "anywhere" }}
                        >
                            {detail ? (
                                <Spoiler
                                    maxHeight={160}
                                    showLabel="Show more"
                                    hideLabel="Show less"
                                    showAriaLabel="Show full description"
                                    hideAriaLabel="Collapse description"
                                >
                                    {description}
                                </Spoiler>
                            ) : (
                                description
                            )}
                        </Text>
                    )}
                    {pr.reviewState === "covered" && (
                        <Text size="xs" c="var(--argus-tag-text)">
                            Covered{" "}
                            {pr.coveredAt
                                ? timeAgo(pr.coveredAt)
                                : "by a teammate"}
                        </Text>
                    )}
                    <Group justify="space-between" gap="md">
                        <ReviewHistory pr={pr} withState />
                        <VoteAvatars votes={pr.otherVotes} />
                    </Group>
                </Stack>
            </Card.Section>
            <Card.Section
                component="footer"
                inheritPadding
                withBorder
                py={padding}
            >
                <Stack gap="md">
                    {onRestore && !onCollapse && (
                        <Group justify="flex-end">
                            <Button
                                type="button"
                                size="xs"
                                variant="default"
                                aria-label="Back to review"
                                leftSection={<RotateCcw size={13} />}
                                disabled={restore.pending}
                                loading={restore.pending}
                                onClick={() =>
                                    restore.run(async () => {
                                        await onRestore();
                                    })
                                }
                            >
                                Back to review
                            </Button>
                        </Group>
                    )}
                    {onCollapse ? (
                        <Group justify="flex-end" gap={2}>
                            <PrQuickActions pr={pr} />
                        </Group>
                    ) : (
                        <ActionBar pr={pr} />
                    )}
                </Stack>
            </Card.Section>
        </Card>
    );
}
