import { createFileRoute } from "@tanstack/react-router";
import { prsQuery, configQuery } from "../lib/api";
import { TriageQueue } from "../components/TriageQueue";
import { parseQueueFilters } from "../lib/queue-filters";

// Board = the triage queue: PRs to review (reviewer or via a team), bucketed by
// how much attention they need. Your own authored PRs live on the My PRs route.
export const Route = createFileRoute("/")({
    validateSearch: parseQueueFilters,
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureQueryData(prsQuery),
            context.queryClient.ensureQueryData(configQuery),
        ]),
    component: Board,
});

function Board() {
    const filters = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
        <div className="mx-auto max-w-3xl pl-10">
            <TriageQueue
                filters={filters}
                onFiltersChange={(search) => {
                    void navigate({ search, resetScroll: false });
                }}
            />
        </div>
    );
}
