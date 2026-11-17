import {
    Accordion,
    ActionIcon,
    Anchor,
    Badge,
    Button,
    CloseButton,
    Container,
    Group,
    List,
    Pagination,
    ScrollArea,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Title,
    Tooltip,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";
import { warmQuery } from "../lib/query-defaults";
import { api, allPrsQuery, configQuery, stalePreviewQuery } from "../lib/api";
import { shortRepo } from "../lib/format";
import {
    filterTrackedPrs,
    isArchivedPr,
    trackedPrDate,
    trackedPrStatus,
    type TrackedView,
} from "../lib/tracked-prs";

export const Route = createFileRoute("/tracked")({
    loader: ({ context }) =>
        Promise.all([
            warmQuery(context.queryClient, allPrsQuery),
            context.queryClient.ensureQueryData(configQuery),
        ]),
    component: TrackedPage,
});

function StaleSweepBanner() {
    const queryClient = useQueryClient();
    const previewQuery = useQuery(stalePreviewQuery);
    const preview = previewQuery.data;
    const sweep = useMutation({
        mutationFn: (canonicals: string[]) => api.sweepStale(canonicals),
        onSuccess: () => queryClient.invalidateQueries(),
    });
    if (previewQuery.isError)
        return (
            <ErrorBanner
                title="Couldn't check auto-archive eligibility"
                error={previewQuery.error}
                onRetry={() => void previewQuery.refetch()}
            />
        );
    if (!preview || preview.approved || preview.candidates.length === 0)
        return null;
    return (
        <Accordion variant="separated">
            <Accordion.Item value="auto-archive">
                <Accordion.Control>
                    {preview.candidates.length} idle PR
                    {preview.candidates.length === 1 ? "" : "s"} can be archived
                </Accordion.Control>
                <Accordion.Panel>
                    <Stack gap="sm">
                        <Text size="sm" c="dimmed">
                            These PRs have been idle for {preview.days}+ days.
                            Archived PRs keep their history and come back when
                            they change. After you approve, Argus archives stale
                            PRs on its own.
                        </Text>
                        <ScrollArea.Autosize mah={160}>
                            <List size="sm" spacing="xs">
                                {preview.candidates.map((pr) => (
                                    <List.Item key={pr.canonical}>
                                        {shortRepo(pr.repo)} #{pr.number}
                                        {" · "}
                                        {pr.title} · {pr.idleDays}d idle
                                    </List.Item>
                                ))}
                            </List>
                        </ScrollArea.Autosize>
                        {sweep.isError && (
                            <ErrorBanner
                                title="Couldn't approve auto-archive"
                                error={sweep.error}
                            />
                        )}
                        <Group>
                            <Button
                                variant="default"
                                loading={sweep.isPending}
                                onClick={() =>
                                    sweep.mutate(
                                        preview.candidates.map(
                                            (pr) => pr.canonical,
                                        ),
                                    )
                                }
                            >
                                Archive these and approve auto-archive
                            </Button>
                        </Group>
                    </Stack>
                </Accordion.Panel>
            </Accordion.Item>
        </Accordion>
    );
}

const PAGE_SIZE = 25;

function TrackedPage() {
    const queryClient = useQueryClient();
    const prsQuery = useQuery(allPrsQuery);
    const config = useQuery(configQuery);
    const [view, setView] = useState<TrackedView>("archived");
    const [search, setSearch] = useState("");
    const [currentPage, setPage] = useState(1);
    const restore = useMutation({
        mutationFn: async (canonical: string) => {
            const result = await api.restorePr(canonical);
            if (!result.restored)
                throw new Error(
                    "This PR is no longer available to restore. Refresh the list and try again.",
                );
        },
        onSuccess: () => queryClient.invalidateQueries(),
    });
    const filtered = useMemo(
        () =>
            filterTrackedPrs(
                prsQuery.data ?? [],
                view,
                search,
                config.data?.teamLabels ?? {},
            ),
        [prsQuery.data, view, search, config.data?.teamLabels],
    );
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.min(currentPage, pages);
    const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    if (prsQuery.isPending) return <PendingPage />;
    if (prsQuery.isError && !prsQuery.data)
        return (
            <LoadErrorPage
                what="tracked pull requests"
                error={prsQuery.error}
                onRetry={() => void prsQuery.refetch()}
            />
        );

    return (
        <Container size="lg" px={0}>
            <Stack gap="md">
                <Stack gap={4}>
                    <Title order={1} size="h3">
                        Tracked PRs
                    </Title>
                    <Text size="sm" c="dimmed">
                        Find a PR or restore it from the archive.
                    </Text>
                </Stack>
                <Tabs
                    value={view}
                    onChange={(value) => {
                        if (
                            value === "archived" ||
                            value === "active" ||
                            value === "all"
                        ) {
                            setView(value);
                            setPage(1);
                        }
                    }}
                >
                    <Tabs.List aria-label="PR view">
                        <Tabs.Tab value="archived">Archived</Tabs.Tab>
                        <Tabs.Tab value="active">Active</Tabs.Tab>
                        <Tabs.Tab value="all">All</Tabs.Tab>
                    </Tabs.List>
                    <Tabs.Panel value={view} pt="md">
                        <Stack gap="md">
                            <TextInput
                                aria-label="Search tracked pull requests"
                                placeholder="Search title, number, repository, or author"
                                leftSection={<Search size={16} />}
                                rightSectionPointerEvents="all"
                                rightSection={
                                    search ? (
                                        <CloseButton
                                            size="sm"
                                            aria-label="Clear search"
                                            onClick={() => {
                                                setSearch("");
                                                setPage(1);
                                            }}
                                        />
                                    ) : null
                                }
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.currentTarget.value);
                                    setPage(1);
                                }}
                            />
                            {prsQuery.isError && (
                                <ErrorBanner
                                    title="Couldn't refresh tracked PRs"
                                    error={prsQuery.error}
                                    onRetry={() => void prsQuery.refetch()}
                                />
                            )}
                            {config.isError && (
                                <ErrorBanner
                                    title="Couldn't load team labels"
                                    error={config.error}
                                    onRetry={() => void config.refetch()}
                                />
                            )}
                            {restore.isError && (
                                <ErrorBanner
                                    title="Couldn't restore PR"
                                    error={restore.error}
                                />
                            )}
                            <Table.ScrollContainer minWidth={0}>
                                <Table
                                    highlightOnHover
                                    verticalSpacing="sm"
                                    aria-label="Tracked pull requests"
                                >
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Pull request</Table.Th>
                                            <Table.Th w={1}>Actions</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {shown.map((pr) => (
                                            <Table.Tr key={pr.canonical}>
                                                <Table.Td>
                                                    <Anchor
                                                        size="md"
                                                        fw={500}
                                                        c="text"
                                                        renderRoot={(props) => (
                                                            <Link
                                                                to="/pr"
                                                                search={{
                                                                    c: pr.canonical,
                                                                }}
                                                                {...props}
                                                            />
                                                        )}
                                                        style={{
                                                            overflowWrap:
                                                                "anywhere",
                                                        }}
                                                    >
                                                        {pr.title}
                                                    </Anchor>
                                                    <Text size="sm">
                                                        {shortRepo(pr.repo)} #
                                                        {pr.number}
                                                        {" · "}
                                                        {pr.author ??
                                                            "Unknown author"}
                                                    </Text>
                                                    <Group gap="xs" mt={4}>
                                                        <Badge
                                                            color={
                                                                trackedPrStatus(
                                                                    pr,
                                                                ) === "Active"
                                                                    ? "blue"
                                                                    : "gray"
                                                            }
                                                            variant="filled"
                                                        >
                                                            {trackedPrStatus(
                                                                pr,
                                                            )}
                                                        </Badge>
                                                        {isArchivedPr(pr) && (
                                                            <Text size="sm">
                                                                {pr.state ===
                                                                    "closed" &&
                                                                    "Closed · "}
                                                                {pr.dismissedReason ===
                                                                "stale"
                                                                    ? "Stale"
                                                                    : "Out of scope"}
                                                            </Text>
                                                        )}
                                                        <Text
                                                            size="sm"
                                                            component="time"
                                                            dateTime={trackedPrDate(
                                                                pr,
                                                            )}
                                                            title={new Date(
                                                                trackedPrDate(
                                                                    pr,
                                                                ),
                                                            ).toLocaleString()}
                                                            textWrap="nowrap"
                                                        >
                                                            {!pr.dismissedAt &&
                                                                "Updated "}
                                                            {new Date(
                                                                trackedPrDate(
                                                                    pr,
                                                                ),
                                                            ).toLocaleDateString()}
                                                        </Text>
                                                    </Group>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group
                                                        gap="xs"
                                                        wrap="nowrap"
                                                    >
                                                        {isArchivedPr(pr) &&
                                                            pr.state !==
                                                                "closed" && (
                                                                <Button
                                                                    size="xs"
                                                                    variant="default"
                                                                    aria-label={`Restore ${pr.title}`}
                                                                    loading={
                                                                        restore.isPending &&
                                                                        restore.variables ===
                                                                            pr.canonical
                                                                    }
                                                                    disabled={
                                                                        restore.isPending
                                                                    }
                                                                    onClick={() =>
                                                                        restore.mutate(
                                                                            pr.canonical,
                                                                        )
                                                                    }
                                                                >
                                                                    Restore
                                                                </Button>
                                                            )}
                                                        <Tooltip label="Open in Azure DevOps">
                                                            <ActionIcon
                                                                component="a"
                                                                href={
                                                                    pr.canonical
                                                                }
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                variant="subtle"
                                                                color="gray"
                                                                aria-label={`Open ${pr.title} in Azure DevOps`}
                                                            >
                                                                <ExternalLink
                                                                    size={16}
                                                                />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                        {shown.length === 0 && (
                                            <Table.Tr>
                                                <Table.Td colSpan={2}>
                                                    <Text
                                                        ta="center"
                                                        c="dimmed"
                                                        size="sm"
                                                        py="xl"
                                                    >
                                                        {search.trim()
                                                            ? "No PRs match your search in this view."
                                                            : view ===
                                                                "archived"
                                                              ? "No archived PRs."
                                                              : view ===
                                                                  "active"
                                                                ? "No active PRs."
                                                                : "No tracked PRs."}
                                                    </Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        )}
                                    </Table.Tbody>
                                </Table>
                            </Table.ScrollContainer>
                            <Group justify="space-between">
                                <Text size="sm" c="dimmed" role="status">
                                    {filtered.length} PR
                                    {filtered.length === 1 ? "" : "s"}
                                </Text>
                                {pages > 1 && (
                                    <Pagination
                                        total={pages}
                                        value={page}
                                        onChange={setPage}
                                        size="sm"
                                    />
                                )}
                            </Group>
                        </Stack>
                    </Tabs.Panel>
                </Tabs>
                <StaleSweepBanner />
            </Stack>
        </Container>
    );
}
