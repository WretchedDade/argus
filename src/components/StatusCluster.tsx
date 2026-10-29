import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
        <div className="flex items-center gap-3 text-xs text-white/85">
            <AuthControl />
            {poller &&
                !poller.authOk &&
                health.data?.auth?.provider !== "broker" && (
                    <span className="rounded-full border border-amber-300/60 bg-amber-400/20 px-2 py-0.5 text-amber-100">
                        az login needed
                    </span>
                )}
            {running && poller?.currentRunId ? (
                <Link
                    to="/activity/$runId"
                    params={{ runId: String(poller.currentRunId) }}
                    className="flex items-center gap-1.5 hover:underline"
                >
                    <OcellusDot watching />
                    watching…
                </Link>
            ) : (
                <span className="flex items-center gap-1.5">
                    <OcellusDot watching={running} />
                    {running
                        ? "watching…"
                        : poller?.lastRunAt
                          ? `last watch ${timeAgo(poller.lastRunAt)}`
                          : "on watch"}
                </span>
            )}
        </div>
    );
}
