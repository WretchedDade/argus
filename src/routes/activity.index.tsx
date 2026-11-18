import {
    Anchor,
    Badge,
    Container,
    Group,
    NativeSelect,
    Stack,
    Table,
    Text,
    Title,
} from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { runsQuery } from "../lib/api";
import { durationMs } from "../lib/format";
import { runStatusMeta } from "../lib/runStatus";
import { runChangeSummary } from "../lib/activity";
import { warmQuery } from "../lib/query-defaults";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";

export const Route = createFileRoute("/activity/")({
    loader: ({ context }) => warmQuery(context.queryClient, runsQuery),
    component: RunsList,
});

function RunsList() {
    const runs = useQuery(runsQuery);
    const [status, setStatus] = useState("all");
    const active = runs.data?.find((run) => !run.finishedAt);
    const visible = (runs.data ?? []).filter(
        (run) => status === "all" || runStatusMeta(run).label === status,
    );

    if (runs.isPending) return <PendingPage />;
    if (!runs.data)
        return (
            <LoadErrorPage
                what="poll runs"
                error={runs.error}
                onRetry={() => void runs.refetch()}
                showActivityLink={false}
            />
        );

    return (
        <Container size="md" px={0}>
            <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                        <Title order={1} size="h3">
                            Activity
                        </Title>
                        <Text size="sm" c="dimmed">
                            Recent poll runs and diagnostic traces. Updates
                            every 5 seconds.
                        </Text>
                    </Stack>
                    {active && (
                        <Anchor
                            size="sm"
                            renderRoot={(props) => (
                                <Link
                                    to="/activity/$runId"
                                    params={{ runId: String(active.id) }}
                                    {...props}
                                />
                            )}
                        >
                            View running poll #{active.id}
                        </Anchor>
                    )}
                </Group>
                {runs.isError && (
                    <ErrorBanner
                        title="Couldn't refresh poll runs"
                        error={runs.error}
                        onRetry={() => void runs.refetch()}
                    />
                )}
                <Group justify="space-between">
                    <Text size="sm">
                        {runs.data.length} recent run
                        {runs.data.length === 1 ? "" : "s"}
                    </Text>
                    <NativeSelect
                        size="sm"
                        aria-label="Filter runs by status"
                        value={status}
                        onChange={(event) =>
                            setStatus(event.currentTarget.value)
                        }
                        data={[
                            { value: "all", label: "All runs" },
                            { value: "Failed", label: "Failed" },
                            { value: "Running", label: "Running" },
                            { value: "Completed", label: "Completed" },
                        ]}
                    />
                </Group>
                <Table.ScrollContainer minWidth={0}>
                    <Table verticalSpacing="sm" highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Run</Table.Th>
                                <Table.Th>Result</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {visible.map((run) => {
                                const meta = runStatusMeta(run);
                                return (
                                    <Table.Tr key={run.id}>
                                        <Table.Td>
                                            <Anchor
                                                size="sm"
                                                c="text"
                                                fw={500}
                                                renderRoot={(props) => (
                                                    <Link
                                                        to="/activity/$runId"
                                                        params={{
                                                            runId: String(
                                                                run.id,
                                                            ),
                                                        }}
                                                        {...props}
                                                    />
                                                )}
                                            >
                                                Run #{run.id}
                                            </Anchor>
                                            <Text
                                                size="sm"
                                                component="time"
                                                dateTime={run.startedAt}
                                                title={run.startedAt}
                                            >
                                                {new Date(
                                                    run.startedAt,
                                                ).toLocaleString(undefined, {
                                                    timeZoneName: "short",
                                                })}
                                            </Text>
                                            {run.finishedAt && (
                                                <Text size="sm" c="dimmed">
                                                    {durationMs(
                                                        run.startedAt,
                                                        run.finishedAt,
                                                    )}
                                                </Text>
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            <Stack gap={4}>
                                                <Group>
                                                    <Badge
                                                        variant="filled"
                                                        color={meta.color}
                                                    >
                                                        {meta.label}
                                                    </Badge>
                                                </Group>
                                                <Text size="sm">
                                                    {run.finishedAt
                                                        ? runChangeSummary(run)
                                                        : "Polling Azure DevOps..."}
                                                </Text>
                                                {run.error && (
                                                    <Text
                                                        size="sm"
                                                        c="red"
                                                        style={{
                                                            overflowWrap:
                                                                "anywhere",
                                                            whiteSpace:
                                                                "pre-wrap",
                                                        }}
                                                    >
                                                        {run.error}
                                                    </Text>
                                                )}
                                                {!run.ok &&
                                                    run.finishedAt &&
                                                    !run.error && (
                                                        <Text size="sm">
                                                            No error message
                                                            recorded. Open the
                                                            trace for details.
                                                        </Text>
                                                    )}
                                            </Stack>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                            {visible.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={2}>
                                        <Text
                                            size="sm"
                                            c="dimmed"
                                            ta="center"
                                            py="xl"
                                        >
                                            {runs.data.length === 0
                                                ? "No runs yet. Use Refresh in the header to start a poll."
                                                : "No recent runs match this status."}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Stack>
        </Container>
    );
}
