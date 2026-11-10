import {
    createRootRouteWithContext,
    Link,
    Outlet,
    useLocation,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActionIcon, Badge, Button, Menu } from "@mantine/core";
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
    { to: "/recap", label: "Recap" },
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

// Dropdown grouping the secondary views (Insights / Recap / Activity). The
// trigger shows the active child's name when you're on one, else "Insights".
function NavMenu() {
    const { pathname } = useLocation();
    const active = menuTabs.find((t) => pathname.startsWith(t.to));
    return (
        <Menu shadow="md" position="bottom-start" withinPortal>
            <Menu.Target>
                <Button
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
                <SetupGate />
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
        <div className="app-bg text-fg min-h-screen">
            <div className="app-shell">
                <header className="app-header sticky top-0 z-30 flex flex-col gap-3.5 px-4 pb-2.5 pt-3.5">
                    <div className="flex items-center gap-3">
                        <div className="flex shrink-0 items-center gap-2.5">
                            <BrandMark size={30} />
                            <span className="text-lg font-semibold tracking-tight">
                                Argus
                            </span>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-3">
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
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <nav className="flex w-full min-w-0 flex-1 flex-wrap items-center gap-1 sm:w-auto">
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
                        </nav>
                        <div className="flex shrink-0 self-end items-center gap-2 sm:self-auto">
                            <PrSearch />
                            <RefreshButton />
                        </div>
                    </div>
                </header>
                <main className="p-4">
                    <ArchiveBanner />
                    <Outlet />
                </main>
            </div>
            <Toaster />
        </div>
    );
}
