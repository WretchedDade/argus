import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, healthQuery, type Health } from "../lib/api";
import { timeAgo } from "../lib/format";
import { OcellusDot } from "./OcellusMark";

// Right-side header cluster: live run state, auth warning, and a manual refresh
// that triggers the same reconcile the timer runs.
export function StatusCluster() {
  const qc = useQueryClient();
  const health = useQuery(healthQuery);
  const refresh = useMutation({
    mutationFn: api.refresh,
    // Flip running=true in the cache immediately so the radar reacts on click,
    // instead of waiting up to one health-poll interval.
    onMutate: () => {
      qc.setQueryData(["health"], (old: Health | undefined) =>
        old ? { ...old, poller: { ...old.poller, running: true } } : old,
      );
    },
    onSettled: () => {
      for (const key of ["prs", "activity", "runs", "health"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const poller = health.data?.poller;
  const running = !!poller?.running || refresh.isPending;

  return (
    <div className="flex items-center gap-3 text-xs text-white/85">
      {poller && !poller.authOk && (
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
          {running ? "watching…" : poller?.lastRunAt ? `last watch ${timeAgo(poller.lastRunAt)}` : "on watch"}
        </span>
      )}
      <button
        type="button"
        onClick={() => refresh.mutate()}
        disabled={running}
        className="rounded-md bg-white px-2.5 py-1 font-semibold text-[var(--peacock-indigo)] shadow-sm hover:bg-white/90 disabled:opacity-60"
      >
        Refresh
      </button>
    </div>
  );
}
