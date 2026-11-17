import {
    Accordion,
    Alert,
    Anchor,
    Badge,
    CloseButton,
    Code,
    Container,
    Group,
    List,
    Loader,
    NativeSelect,
    Paper,
    Stack,
    Text,
    TextInput,
    Timeline,
    Title,
} from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { runQuery, type ActivityEntry, type RunEvent } from "../lib/api";
import { clockTime, durationMs } from "../lib/format";
import { runStatusMeta } from "../lib/runStatus";
import {
    activityLevelColor,
    filterTraceEntries,
    runChangeLabel,
    runChangeSummary,
    type TraceLevel,
} from "../lib/activity";
import { warmQuery } from "../lib/query-defaults";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";

export const Route = createFileRoute("/activity/$runId")({
    loader: ({ context, params }) =>
        warmQuery(context.queryClient, runQuery(Number(params.runId))),
    component: RunDetail,
});

function StructuredData({ value }: { value: Record<string, unknown> }) {
    return (
        <Code
            block
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
            {JSON.stringify(value, null, 2)}
        </Code>
    );
}

function TraceData({ entry }: { entry: ActivityEntry }) {
    if (!entry.data) return null;
    return (
        <Accordion
            variant="default"
            chevronSize={14}
            defaultValue={
                activityLevelColor(entry.level) === "gray" ? null : "data"
            }
            keepMounted
        >
            <Accordion.Item value="data">
                <Accordion.Control px={0} py={4}>
                    <Text size="sm">Structured data</Text>
                </Accordion.Control>
                <Accordion.Panel>
                    <StructuredData value={entry.data} />
                </Accordion.Panel>
            </Accordion.Item>
        </Accordion>
    );
}

function PrChanges({ changes }: { changes: RunEvent[] }) {
    return (
        <Accordion variant="separated" keepMounted>
            <Accordion.Item value="changes">
                <Accordion.Control>
                    PR changes ({changes.length})
                </Accordion.Control>
                <Accordion.Panel>
                    <List listStyleType="none" spacing="md">
                        {changes.map((change) => (
                            <List.Item key={change.id}>
                                <Stack gap="xs">
                                    <Anchor
                                        href={change.canonical}
                                        target="_blank"
                                        rel="noreferrer"
                                        size="sm"
                                        c="text"
                                        fw={500}
                                        style={{ overflowWrap: "anywhere" }}
                                    >
                                        {change.title}
                                    </Anchor>
                                    <Text size="sm">
                                        {change.repo} #{change.number}
                                        {" · "}
                                        {runChangeLabel(change)}
                                    </Text>
                                    <Text
                                        size="sm"
                                        component="time"
                                        dateTime={change.ts}
                                        title={change.ts}
                                        c="dimmed"
                                    >
                                        {clockTime(change.ts)}
                                    </Text>
                                    {change.payload && (
                                        <StructuredData
                                            value={change.payload}
                                        />
                                    )}
                                </Stack>
                            </List.Item>
                        ))}
                    </List>
                </Accordion.Panel>
            </Accordion.Item>
        </Accordion>
    );
}

function RunDetail() {
    const { runId } = Route.useParams();
    const query = useQuery(runQuery(Number(runId)));
    const [search, setSearch] = useState("");
    const [level, setLevel] = useState<TraceLevel>("all");
    const run = query.data?.run;
    const entries = query.data?.entries ?? [];
    const changes = query.data?.changes ?? [];
    const visible = filterTraceEntries(entries, level, search);
    const running = !!run && !run.finishedAt;
    const status = run ? runStatusMeta(run) : null;

    return (
        <Container size="md" px={0}>
            <Stack gap="lg">
                <Group>
                    <Anchor
                        size="sm"
                        renderRoot={(props) => (
                            <Link to="/activity" {...props} />
                        )}
                    >
                        <Group component="span" gap={4}>
                            <ArrowLeft size={14} /> All runs
                        </Group>
                    </Anchor>
                </Group>
                {query.isError && query.data && (
                    <ErrorBanner
                        title="Couldn't refresh this run"
                        error={query.error}
                        onRetry={() => void query.refetch()}
                    />
                )}
                {query.isPending ? (
                    <PendingPage />
                ) : query.isError && !query.data ? (
                    <LoadErrorPage
                        what="this poll run"
                        error={query.error}
                        onRetry={() => void query.refetch()}
                        showActivityLink={false}
                    />
                ) : run && status ? (
                    <>
                        <Paper withBorder p="md">
                            <Stack gap="sm">
                                <Group justify="space-between">
                                    <Title order={1} size="h3">
                                        Run #{run.id}
                                    </Title>
                                    <Badge
                                        color={status.color}
                                        variant="filled"
                                    >
                                        {status.label}
                                    </Badge>
                                </Group>
                                <Text
                                    size="sm"
                                    component="time"
                                    dateTime={run.startedAt}
                                    title={run.startedAt}
                                >
                                    Started{" "}
                                    {new Date(run.startedAt).toLocaleString(
                                        undefined,
                                        { timeZoneName: "short" },
                                    )}
                                    {run.finishedAt &&
                                        ` · ${durationMs(run.startedAt, run.finishedAt)}`}
                                </Text>
                                {run.error && (
                                    <Alert color="red" title="Poll failed">
                                        <Text
                                            size="sm"
                                            style={{
                                                whiteSpace: "pre-wrap",
                                                overflowWrap: "anywhere",
                                            }}
                                        >
                                            {run.error}
                                        </Text>
                                    </Alert>
                                )}
                                {!run.ok && run.finishedAt && !run.error && (
                                    <Alert color="red" title="Poll failed">
                                        No error message was recorded. Check the
                                        trace below.
                                    </Alert>
                                )}
                                {run.finishedAt && (
                                    <>
                                        <Text size="sm">
                                            Matched:{" "}
                                            {run.mine ?? "not recorded"} ·
                                            Tracked:{" "}
                                            {run.tracked ?? "not recorded"}
                                        </Text>
                                        <Text size="sm">
                                            {runChangeSummary(run)}
                                        </Text>
                                    </>
                                )}
                                {running && (
                                    <Group gap="xs" role="status">
                                        <Loader size="xs" />
                                        <Text size="sm">
                                            Run in progress. This page updates
                                            automatically.
                                        </Text>
                                    </Group>
                                )}
                            </Stack>
                        </Paper>
                        <Stack gap="md">
                            <Group justify="space-between">
                                <Title order={2} size="h4">
                                    Trace
                                </Title>
                                <Text size="sm" c="dimmed" role="status">
                                    {visible.length} of {entries.length} entries
                                </Text>
                            </Group>
                            <Group gap="sm" align="flex-end">
                                <TextInput
                                    flex={1}
                                    miw={180}
                                    aria-label="Search trace"
                                    placeholder="Search messages or structured data"
                                    leftSection={<Search size={16} />}
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.currentTarget.value)
                                    }
                                    rightSectionPointerEvents="all"
                                    rightSection={
                                        search ? (
                                            <CloseButton
                                                size="sm"
                                                aria-label="Clear trace search"
                                                onClick={() => setSearch("")}
                                            />
                                        ) : null
                                    }
                                />
                                <NativeSelect
                                    size="sm"
                                    aria-label="Filter trace by level"
                                    value={level}
                                    onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        if (
                                            value === "all" ||
                                            value === "issues" ||
                                            value === "errors"
                                        )
                                            setLevel(value);
                                    }}
                                    data={[
                                        { value: "all", label: "All levels" },
                                        {
                                            value: "issues",
                                            label: "Warnings and errors",
                                        },
                                        {
                                            value: "errors",
                                            label: "Errors only",
                                        },
                                    ]}
                                />
                            </Group>
                            {visible.length > 0 ? (
                                <Timeline
                                    active={visible.length - 1}
                                    bulletSize={16}
                                    lineWidth={1}
                                >
                                    {visible.map((entry) => (
                                        <Timeline.Item
                                            key={entry.id}
                                            color={activityLevelColor(
                                                entry.level,
                                            )}
                                            title={
                                                <Group gap="xs">
                                                    <Badge
                                                        variant={
                                                            activityLevelColor(
                                                                entry.level,
                                                            ) === "gray"
                                                                ? "outline"
                                                                : "filled"
                                                        }
                                                        color={activityLevelColor(
                                                            entry.level,
                                                        )}
                                                        size="sm"
                                                    >
                                                        {entry.level}
                                                    </Badge>
                                                    <Text
                                                        size="sm"
                                                        component="time"
                                                        dateTime={entry.ts}
                                                        title={entry.ts}
                                                        c="dimmed"
                                                    >
                                                        {clockTime(entry.ts)}
                                                    </Text>
                                                </Group>
                                            }
                                        >
                                            <Stack gap="xs" mt={4}>
                                                <Text
                                                    size="sm"
                                                    style={{
                                                        whiteSpace: "pre-wrap",
                                                        overflowWrap:
                                                            "anywhere",
                                                    }}
                                                >
                                                    {entry.msg}
                                                </Text>
                                                <TraceData entry={entry} />
                                            </Stack>
                                        </Timeline.Item>
                                    ))}
                                </Timeline>
                            ) : (
                                <Text size="sm" c="dimmed">
                                    {entries.length > 0
                                        ? "No trace entries match these filters."
                                        : running
                                          ? "Waiting for trace entries..."
                                          : "No trace entries were recorded."}
                                </Text>
                            )}
                        </Stack>
                        {changes.length > 0 ? (
                            <PrChanges changes={changes} />
                        ) : (
                            <Text size="sm" c="dimmed">
                                {running
                                    ? "No PR changes recorded yet."
                                    : "No PR changes were recorded."}
                            </Text>
                        )}
                    </>
                ) : (
                    <Alert title="Run not found" color="gray">
                        No stored run has this ID.
                    </Alert>
                )}
            </Stack>
        </Container>
    );
}
