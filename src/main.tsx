import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createQueryClient } from "./lib/query-defaults";
import { PendingPage, RouteError } from "./components/ErrorBanner";
import { AppearanceProvider } from "./components/AppearanceProvider";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = createQueryClient();

// queryClient in router context lets route loaders prefetch; intent preload
// warms a route's loader on hover/focus.
const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingMs: 300,
    defaultPendingComponent: PendingPage,
    defaultErrorComponent: ({ error, reset }) => (
        <RouteError
            error={error}
            reset={() => {
                reset();
                void queryClient.resetQueries();
                void router.invalidate();
            }}
        />
    ),
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element missing");

createRoot(rootEl).render(
    <StrictMode>
        <AppearanceProvider>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>
        </AppearanceProvider>
    </StrictMode>,
);
