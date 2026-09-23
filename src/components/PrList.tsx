import { useQuery } from "@tanstack/react-query";
import type { Pr } from "../lib/api";
import { configQuery } from "../lib/api";
import { PrRow } from "./PrRow";

export function PrList({ prs, empty }: { prs: Pr[]; empty: string }) {
  const labels = useQuery(configQuery).data?.teamLabels ?? {};
  if (prs.length === 0) return <p className="text-muted text-sm">{empty}</p>;
  return (
    <div className="divide-line border-line divide-y overflow-hidden rounded-lg border">
      {prs.map((pr) => (
        <PrRow key={pr.canonical} pr={pr} labels={labels} />
      ))}
    </div>
  );
}
