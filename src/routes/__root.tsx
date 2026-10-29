import {
    createRootRouteWithContext,
    Link,
    Outlet,
    useLocation,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { configQuery, healthQuery, prsQuery } from "../lib/api";
import { needsYouCount } from "../lib/triage";
import { BrandMark } from "../components/BrandMark";
import { NotificationsBell } from "../components/NotificationsBell";
import { PrSearch } from "../components/PrSearch";
import { RefreshButton } from "../components/RefreshButton";
import { StatusCluster } from "../components/StatusCluster";
import { AuthGate } from "../components/AuthGate";
import { SetupGate } from "../components/SetupGate";
import { Toaster } from "../components/Toaster";

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
        <span
            className="ml-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-4"
            style={
                tone === "attention"
                    ? { background: "var(--peacock-gold)", color: "#3a2c00" }
                    : { background: "rgba(255,255,255,0.25)", color: "#fff" }
            }
        >
            {n}
        </span>
    );
}

// Dropdown grouping the secondary views (Insights / Recap / Activity). The
// trigger shows the active child's name when you're on one, else "Insights".
function NavMenu() {
    const [open, setOpen] = useState(false);
    const { pathname } = useLocation();
    const active = menuTabs.find((t) => pathname.startsWith(t.to));
    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors hover:text-white"
                style={
                    active
                        ? {
                              background: "rgba(255,255,255,0.22)",
                              color: "#fff",
                          }
                        : { color: "rgba(255,255,255,0.8)" }
                }
            >
                {active ? active.label : "Insights"}
                <ChevronDown
                    size={14}
                    className={
                        open
                            ? "rotate-180 transition-transform"
                            : "transition-transform"
                    }
                />
            </button>
            {open && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        className="border-line absolute left-0 top-full z-50 mt-1.5 w-40 overflow-hidden rounded-lg border shadow-lg"
                        style={{ background: "var(--card-bg)" }}
                    >
                        {menuTabs.map((t) => (
                            <Link
                                key={t.to}
                                to={t.to}
                                onClick={() => setOpen(false)}
                                className="text-fg hover:bg-surface block px-3 py-2 text-sm"
                                activeProps={{
                                    style: {
                                        background:
                                            "color-mix(in srgb, var(--color-fg) 8%, transparent)",
                                        fontWeight: 600,
                                    },
                                }}
                            >
                                {t.label}
                            </Link>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function RootLayout() {
    const health = useQuery(healthQuery).data;
    const prs = useQuery(prsQuery).data ?? [];
    const recencyDays = useQuery(configQuery).data?.recencyDays ?? 7;
    const [authDismissed, setAuthDismissed] = useState(false);

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
                <header className="app-header sticky top-0 z-30 flex flex-col gap-3.5 px-4 py-2.5">
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
                            <Link
                                to="/settings"
                                className="text-white/80 hover:text-white"
                                title="Settings"
                                aria-label="Settings"
                            >
                                <SettingsIcon size={18} />
                            </Link>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                            {tabs.map((t) => (
                                <Link
                                    key={t.to}
                                    to={t.to}
                                    activeOptions={{ exact: t.exact }}
                                    className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2.5 py-1 text-sm text-white/80 transition-colors hover:text-white"
                                    activeProps={{
                                        className: "text-white",
                                        style: {
                                            background:
                                                "rgba(255,255,255,0.22)",
                                        },
                                    }}
                                >
                                    {t.label}
                                    {counts[t.to] && (
                                        <TabCount
                                            n={counts[t.to]!.n}
                                            tone={counts[t.to]!.tone}
                                        />
                                    )}
                                </Link>
                            ))}
                            <NavMenu />
                        </nav>
                        <div className="flex shrink-0 items-center gap-2">
                            <PrSearch />
                            <RefreshButton />
                        </div>
                    </div>
                </header>
                <main className="p-4">
                    <Outlet />
                </main>
            </div>
            <Toaster />
        </div>
    );
}
