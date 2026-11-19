import {
    createRootRouteWithContext,
    Link,
    Outlet,
    useLocation,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
    ActionIcon,
    Badge,
    Box,
    Button,
    Container,
    Group,
    Menu,
    Stack,
    Text,
} from "@mantine/core";
import { ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { configQuery, healthQuery, prsQuery } from "../lib/api";
import { needsYouCount } from "../lib/triage";
import { useUpdateToasts } from "../lib/useUpdate";
import { NotificationsBell } from "../components/NotificationsBell";
import { ArchiveBanner } from "../components/notifications/ArchiveBanner";
import { PrSearch } from "../components/PrSearch";
import { RefreshButton } from "../components/RefreshButton";
import { StatusCluster } from "../components/StatusCluster";
import { AuthGate } from "../components/AuthGate";
import { SetupGate } from "../components/SetupGate";
import { Toaster } from "../components/Toaster";
import { BrandMark } from "../components/BrandMark";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
    {
        component: RootLayout,
    },
);

const tabs = [
    { to: "/", label: "Board", exact: true },
    { to: "/mine", label: "My PRs", exact: false },
    { to: "/tracked", label: "Tracked", exact: false },
] as const;

// Secondary views grouped under one dropdown to keep the primary nav lean.
const menuTabs = [
    { to: "/insights", label: "Insights" },
    { to: "/activity", label: "Activity" },
] as const;

function TabCount({ n, tone }: { n: number; tone: "attention" | "neutral" }) {
    if (n <= 0) return null;
    return (
        <Badge
            size="sm"
            variant="light"
            color={tone === "attention" ? undefined : "gray"}
            ml={6}
        >
            {n}
        </Badge>
    );
}

// The trigger shows the active secondary view, or "Insights".
function NavMenu() {
    const { pathname } = useLocation();
    const active = menuTabs.find((t) => pathname.startsWith(t.to));
    return (
        <Menu shadow="md" position="bottom-start" withinPortal>
            <Menu.Target>
                <Button
                    size="xs"
                    variant={active ? "light" : "subtle"}
                    color={active ? undefined : "gray"}
                    rightSection={<ChevronDown size={14} />}
                >
                    {active ? active.label : "Insights"}
                </Button>
            </Menu.Target>
            <Menu.Dropdown>
                {menuTabs.map((t) => (
                    <Menu.Item component={Link} key={t.to} to={t.to}>
                        {t.label}
                    </Menu.Item>
                ))}
            </Menu.Dropdown>
        </Menu>
    );
}

function RootLayout() {
    const { pathname } = useLocation();
    const health = useQuery(healthQuery).data;
    const prs = useQuery(prsQuery).data ?? [];
    const recencyDays = useQuery(configQuery).data?.recencyDays ?? 7;
    const [authDismissed, setAuthDismissed] = useState(false);
    // Above the early returns, so the update toast survives the setup and auth gates.
    useUpdateToasts();
    // First-run gate: until the user confirms their org/project/reviewer groups,
    // the board would be empty and mis-classified, so show setup instead.
    if (health && !health.setup_complete) {
        return (
            <>
                <SetupGate pluginInstalled={health.pluginInstalled} />
                <Toaster />
            </>
        );
    }

    const authBlocked =
        !!health &&
        (health.auth
            ? !health.auth.configured ||
              !health.auth.account ||
              health.auth.interactionRequired
            : health.poller.authOk === false);
    if (authBlocked && !authDismissed) {
        return (
            <>
                <AuthGate onDismiss={() => setAuthDismissed(true)} />
                <Toaster />
            </>
        );
    }

    const counts: Partial<
        Record<
            (typeof tabs)[number]["to"],
            { n: number; tone: "attention" | "neutral" }
        >
    > = {
        "/": { n: needsYouCount(prs, recencyDays), tone: "attention" },
        "/mine": {
            n: prs.filter((p) => p.role === "author").length,
            tone: "neutral",
        },
    };

    return (
        <Box mih="100vh" bg="var(--page-base)">
            <Stack
                component="header"
                pos="sticky"
                top={0}
                gap={14}
                px="md"
                pt={18}
                pb={10}
                bg="var(--mantine-color-body)"
                style={{
                    zIndex: 30,
                    borderBottom:
                        "1px solid var(--mantine-color-default-border)",
                }}
            >
                <Group justify="space-between" gap="sm">
                    <Group gap={10} wrap="nowrap">
                        <BrandMark size={30} />
                        <Text size="lg" fw={600}>
                            Argus
                        </Text>
                    </Group>
                    <Group gap="sm" ml="auto">
                        <StatusCluster />
                        <NotificationsBell />
                        <ActionIcon
                            component={Link}
                            to="/settings"
                            variant="subtle"
                            color="gray"
                            title="Settings"
                            aria-label="Settings"
                        >
                            <SettingsIcon size={18} />
                        </ActionIcon>
                    </Group>
                </Group>
                <Group justify="space-between" gap="xs">
                    <Group
                        component="nav"
                        aria-label="Primary navigation"
                        gap={4}
                        flex="1 1 320px"
                        miw={0}
                    >
                        {tabs.map((t) => (
                            <Button
                                component={Link}
                                size="xs"
                                key={t.to}
                                to={t.to}
                                activeOptions={{ exact: t.exact }}
                                variant={
                                    (
                                        t.exact
                                            ? pathname === t.to
                                            : pathname.startsWith(t.to)
                                    )
                                        ? "light"
                                        : "subtle"
                                }
                                color={
                                    (
                                        t.exact
                                            ? pathname === t.to
                                            : pathname.startsWith(t.to)
                                    )
                                        ? undefined
                                        : "gray"
                                }
                            >
                                {t.label}
                                {counts[t.to] && (
                                    <TabCount
                                        n={counts[t.to]!.n}
                                        tone={counts[t.to]!.tone}
                                    />
                                )}
                            </Button>
                        ))}
                        <NavMenu />
                    </Group>
                    <Group gap="xs" ml="auto">
                        <PrSearch />
                        <RefreshButton />
                    </Group>
                </Group>
            </Stack>
            <Container component="main" fluid p="md" miw={0}>
                <ArchiveBanner />
                <Outlet />
            </Container>
            <Toaster />
        </Box>
    );
}
