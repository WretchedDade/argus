import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Copy, Eye, GitPullRequest, Loader2, MessageSquare, MessageSquareText, PencilLine, RotateCw, X } from "lucide-react";
import { api, prsQuery, type Pr } from "../lib/api";
import { shortAge } from "../lib/format";
import { pushToast } from "../lib/toast";

// My own authored PRs — a flat list (count stays low). The framing is "what's
// blocking this from merging", so each card leads with review status.
export const Route = createFileRoute("/mine")({
  loader: ({ context }) => context.queryClient.ensureQueryData(prsQuery),
  component: MyPrs,
});

interface Status {
  label: string;
  anchor: string;
  Icon: typeof Check;
}

// Overall standing of one of my PRs. Prefers ADO's own completability signal
// (branch-policy evaluations), falling back to reviewer votes for nuance.
function statusOf(pr: Pr): Status {
  if (pr.isDraft) return { label: "Draft", anchor: "--color-slate-400", Icon: PencilLine };
  const v = pr.otherVotes;
  const m = pr.authorMeta;
  if (m?.mergeStatus === "conflicts") return { label: "Merge conflicts", anchor: "--color-rose-500", Icon: X };
  if (v.some((x) => x.vote === -10)) return { label: "Changes requested", anchor: "--color-rose-500", Icon: X };
  if (v.some((x) => x.vote === -5)) return { label: "Waiting on you", anchor: "--color-orange-500", Icon: Clock };
  if (m?.completable) return { label: "Ready to complete", anchor: "--color-green-500", Icon: Check };
  if (m && m.blockers.length > 0) return { label: "In review", anchor: "--color-teal-500", Icon: Eye };
  if (v.some((x) => x.vote === 10 || x.vote === 5)) return { label: "Approved", anchor: "--color-green-500", Icon: Check };
  return { label: "Awaiting review", anchor: "--color-teal-500", Icon: Eye };
}

function voteWord(v: number): string {
  return v === 10 ? "approved" : v === 5 ? "approved with suggestions" : v === -5 ? "waiting for author" : v === -10 ? "rejected" : "voted";
}

const VOTE_CHIP: Record<number, { anchor: string; Icon: typeof Check }> = {
  10: { anchor: "--color-green-500", Icon: Check },
  5: { anchor: "--color-green-500", Icon: MessageSquareText },
  [-5]: { anchor: "--color-orange-500", Icon: Clock },
  [-10]: { anchor: "--color-rose-500", Icon: X },
};

// Full reviewer names as vote-colored chips.
function ReviewerChips({ votes }: { votes: { name: string; vote: number }[] }) {
  if (votes.length === 0) return <span className="text-muted text-xs">No reviewers have voted yet</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {votes.map((v, i) => {
        const m = VOTE_CHIP[v.vote] ?? { anchor: "--color-slate-400", Icon: Eye };
        return (
          <span
            key={i}
            title={`${v.name} — ${voteWord(v.vote)}`}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: `color-mix(in srgb, var(${m.anchor}) 14%, transparent)`,
              color: `color-mix(in srgb, var(${m.anchor}) 68%, var(--color-fg))`,
            }}
          >
            <m.Icon size={11} className="shrink-0" />
            {v.name}
          </span>
        );
      })}
    </div>
  );
}

function MyPrCard({ pr }: { pr: Pr }) {
  const s = statusOf(pr);
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api.refreshPr(pr.canonical),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prs"] });
      pushToast(`Refreshed ${pr.repo} #${pr.number}`);
    },
    onError: () => pushToast("Refresh failed", "error"),
  });
  const onRefresh = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!refresh.isPending) refresh.mutate();
  };
  return (
    <a
      href={pr.canonical}
      target="_blank"
      rel="noreferrer"
      className="pr-card border-line group flex flex-col gap-3 rounded-xl border py-4 pl-5 pr-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
      style={{ borderLeftColor: `var(${s.anchor})`, borderLeftWidth: "3px" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-muted flex items-center gap-1.5 text-xs">
            <GitPullRequest size={12} className="shrink-0" />
            <span className="text-fg font-semibold">{pr.repo}</span>
            <span>#{pr.number}</span>
            {pr.isDraft && (
              <span className="border-line ml-1 shrink-0 rounded border px-1.5 py-0 text-[10px] uppercase tracking-wide">
                draft
              </span>
            )}
          </div>
          <h3 className="text-fg mt-1.5 line-clamp-2 text-base font-semibold leading-snug">{pr.title}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refresh.isPending}
              title="Refresh from Azure DevOps"
              aria-label="Refresh"
              className="text-muted hover:text-fg hover:bg-surface rounded-md p-1 transition-colors disabled:opacity-50"
            >
              {refresh.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
            </button>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: `color-mix(in srgb, var(${s.anchor}) 15%, transparent)`,
                color: `color-mix(in srgb, var(${s.anchor}) 65%, var(--color-fg))`,
              }}
            >
              <s.Icon size={12} />
              {s.label}
            </span>
          </div>
          <span className="text-muted text-xs">{shortAge(pr.prCreatedAt ?? pr.updatedAt)} old</span>
        </div>
      </div>

      {pr.authorMeta && pr.authorMeta.blockers.length > 0 && !pr.authorMeta.completable && (
        <div className="text-muted text-xs">
          <span className="font-medium">Needs:</span> {pr.authorMeta.blockers.join(" · ")}
        </div>
      )}

      <div className="border-line flex items-center justify-between gap-3 border-t pt-3">
        <ReviewerChips votes={pr.otherVotes} />
        {pr.authorMeta && pr.authorMeta.activeComments + pr.authorMeta.resolvedComments > 0 && (
          <span className="text-muted inline-flex shrink-0 items-center gap-1 text-xs">
            <MessageSquare size={12} />
            {pr.authorMeta.activeComments} active
            {pr.authorMeta.resolvedComments > 0 ? ` · ${pr.authorMeta.resolvedComments} resolved` : ""}
          </span>
        )}
      </div>
    </a>
  );
}

// Build clipboard payloads for sharing my PRs. Teams/Outlook render pasted
// rich text (HTML) but NOT markdown, so we write an HTML list with the title as
// a real anchor; the plain-text fallback stays markdown for editors that want it.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(prs: Pr[]): string {
  const items = prs
    .map((pr) => `<li>${escapeHtml(pr.repo)}: <a href="${escapeHtml(pr.canonical)}">${escapeHtml(pr.title)}</a></li>`)
    .join("");
  return `<ul>${items}</ul>`;
}
function buildText(prs: Pr[]): string {
  return prs.map((pr) => `* ${pr.repo}: [${pr.title}](${pr.canonical})`).join("\n");
}

function MyPrs() {
  const prs = useQuery(prsQuery);
  const mine = (prs.data ?? [])
    .filter((p) => p.role === "author")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const copy = async () => {
    const done = () => pushToast(`Copied ${mine.length} PR${mine.length === 1 ? "" : "s"} to clipboard`);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([buildHtml(mine)], { type: "text/html" }),
          "text/plain": new Blob([buildText(mine)], { type: "text/plain" }),
        }),
      ]);
      done();
    } catch {
      // Fallback for contexts without rich-clipboard support.
      try {
        await navigator.clipboard.writeText(buildText(mine));
        done();
      } catch {
        pushToast("Couldn't copy", "error");
      }
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-fg text-lg font-semibold">My PRs</h1>
          <span className="text-muted text-sm">{mine.length}</span>
        </div>
        {mine.length > 0 && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: "var(--peacock-teal)" }}
          >
            <Copy size={14} /> Copy list
          </button>
        )}
      </div>
      {mine.length === 0 ? (
        <p className="text-muted text-sm">No open PRs authored by you.</p>
      ) : (
        mine.map((pr) => <MyPrCard key={pr.canonical} pr={pr} />)
      )}
    </div>
  );
}
