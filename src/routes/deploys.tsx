import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { deploysQuery, type DeployTimelinePr } from "../lib/api";
import { DeployChips, isProdLive } from "../components/DeployChips";
import { nameColor, shortAge, shortRepo } from "../lib/format";

export const Route = createFileRoute("/deploys")({
  loader: ({ context }) => context.queryClient.ensureQueryData(deploysQuery),
  component: DeploysPage,
});

function DeployRow({ item }: { item: DeployTimelinePr }) {
  return (
    <a
      href={item.canonical}
      target="_blank"
      rel="noreferrer"
      className="hover:bg-surface flex items-center gap-3 px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="text-fg truncate text-sm">{item.title}</div>
        <div className="text-muted truncate text-xs">
          #{item.number} · merged {shortAge(item.mergedAt)} ago
        </div>
      </div>
      <div className="shrink-0">
        <DeployChips deploy={item.deploy} />
      </div>
    </a>
  );
}

function RepoGroup({ repo, items }: { repo: string; items: DeployTimelinePr[] }) {
  const [open, setOpen] = useState(true);
  const live = items.filter((i) => isProdLive(i.deploy)).length;
  const color = nameColor(repo);
  return (
    <section
      className="overflow-hidden rounded-xl border shadow-md"
      style={{ background: "var(--card-bg)", borderColor: `color-mix(in srgb, ${color} 38%, var(--color-line))` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
        style={{ background: `color-mix(in srgb, ${color} 26%, var(--card-bg))` }}
      >
        {open ? <ChevronDown size={15} className="text-muted shrink-0" /> : <ChevronRight size={15} className="text-muted shrink-0" />}
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-fg text-sm font-semibold">{shortRepo(repo)}</span>
        <span className="text-muted text-xs">{items.length}</span>
        <span className="text-muted ml-auto text-[11px]">{live} in prod</span>
      </button>
      {open && (
        <div
          className="divide-line/60 border-line flex flex-col divide-y border-t"
          style={{ background: `color-mix(in srgb, ${color} 13%, var(--card-bg))` }}
        >
          {items.map((item) => (
            <DeployRow key={item.canonical} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function DeploysPage() {
  const data = useQuery(deploysQuery).data;
  const timeline = data?.timeline ?? [];

  // Group by repo, most-active first; rows stay newest-merged first from the server.
  const groups = useMemo(() => {
    const map = new Map<string, DeployTimelinePr[]>();
    for (const item of timeline) (map.get(item.repo) ?? map.set(item.repo, []).get(item.repo)!).push(item);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [timeline]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-fg text-lg font-semibold">Deploys</h1>
        <p className="text-muted text-xs">
          PRs merged in the last {data?.window ?? 14} days and where they have shipped
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted py-10 text-center text-sm">No PRs merged in this window.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([repo, items]) => (
            <RepoGroup key={repo} repo={repo} items={items} />
          ))}
        </div>
      )}
    </div>
  );
}
