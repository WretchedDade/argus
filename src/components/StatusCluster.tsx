import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Anchor, Group, Text } from "@mantine/core";
import { healthQuery } from "../lib/api";
import { timeAgo } from "../lib/format";
import { AuthControl } from "./AuthControl";
import { OcellusDot } from "./OcellusMark";

// Right-side header cluster: live run state and auth warning. The manual refresh
// lives in its own RefreshButton (placed on the nav row), so this is status-only.
export function StatusCluster() {
    const health = useQuery(healthQuery);

    const poller = health.data?.poller;
    const running = !!poller?.running;

    return (
        <Group gap="sm" c="dimmed" fz="xs">
            <AuthControl />
            {poller &&
                !poller.authOk &&
                health.data?.auth?.provider !== "broker" && (
                    <Text span size="xs" c="orange">
                        az login needed
                    </Text>
                )}
            {running && poller?.currentRunId ? (
                <Anchor
                    renderRoot={(props) => (
                        <Link
                            {...props}
                            to="/activity/$runId"
                            params={{ runId: String(poller.currentRunId) }}
                        />
                    )}
                    size="xs"
                    c="dimmed"
                >
                    <Group component="span" gap={6} wrap="nowrap">
                        <OcellusDot watching />
                        watching…
                    </Group>
                </Anchor>
            ) : (
                <Group component="span" gap={6} wrap="nowrap">
                    <OcellusDot watching={running} />
                    {running
                        ? "watching…"
                        : poller?.lastRunAt
                          ? `last watch ${timeAgo(poller.lastRunAt)}`
                          : "on watch"}
                </Group>
            )}
        </Group>
    );
}
