import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, healthQuery, type Health } from "../lib/api";

// Manual refresh: triggers the same reconcile the poll timer runs. Standalone so
// it can sit apart from the status indicator (e.g. on the nav row by search).
export function RefreshButton() {
    const qc = useQueryClient();
    const health = useQuery(healthQuery);
    const refresh = useMutation({
        mutationFn: api.refresh,
        onMutate: () => {
            qc.setQueryData(["health"], (old: Health | undefined) =>
                old
                    ? { ...old, poller: { ...old.poller, running: true } }
                    : old,
            );
        },
        onSettled: () => {
            for (const key of ["prs", "activity", "runs", "health"]) {
                void qc.invalidateQueries({ queryKey: [key] });
            }
        },
    });

    const running = !!health.data?.poller?.running || refresh.isPending;

    return (
        <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={running}
            className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[var(--peacock-indigo)] shadow-sm hover:bg-white/90 disabled:opacity-60"
        >
            Refresh
        </button>
    );
}
