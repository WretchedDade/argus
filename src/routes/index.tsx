import { createFileRoute } from "@tanstack/react-router";
import { prsQuery, configQuery } from "../lib/api";
import { TriageQueue } from "../components/TriageQueue";

// Board = the triage queue: PRs to review (reviewer or via a team), bucketed by
// how much attention they need. Your own authored PRs live on the My PRs route.
export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(prsQuery),
      context.queryClient.ensureQueryData(configQuery),
    ]),
  component: Board,
});

function Board() {
  return (
    <div className="mx-auto max-w-3xl pl-10">
      <TriageQueue />
    </div>
  );
}
