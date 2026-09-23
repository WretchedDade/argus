import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for the Activity section; children (index list, run detail) render here.
export const Route = createFileRoute("/activity")({ component: () => <Outlet /> });
