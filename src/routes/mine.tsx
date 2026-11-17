import { Button } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
    ErrorBanner,
    LoadErrorPage,
    PendingPage,
} from "../components/ErrorBanner";
import { warmQuery } from "../lib/query-defaults";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { configQuery, prsQuery, type Pr } from "../lib/api";
import { AuthoredPrCard } from "../components/PrCard";
import { pushToast } from "../lib/toast";

// My own authored PRs — a flat list (count stays low). The framing is "what's
// blocking this from merging", so each card leads with review status.
export const Route = createFileRoute("/mine")({
    loader: ({ context }) => warmQuery(context.queryClient, prsQuery),
    component: MyPrs,
});

// Build clipboard payloads for sharing my PRs. Teams/Outlook render pasted
// rich text (HTML) but NOT markdown, so we write an HTML list with the title as
// a real anchor; the plain-text fallback stays markdown for editors that want it.
function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(prs: Pr[]): string {
    const items = prs
        .map(
            (pr) =>
                `<li>${escapeHtml(pr.repo)}: <a href="${escapeHtml(pr.canonical)}">${escapeHtml(pr.title)}</a></li>`,
        )
        .join("");
    return `<ul>${items}</ul>`;
}
function buildText(prs: Pr[]): string {
    return prs
        .map((pr) => `* ${pr.repo}: [${pr.title}](${pr.canonical})`)
        .join("\n");
}

function MyPrs() {
    const prs = useQuery(prsQuery);
    const labels = useQuery(configQuery).data?.teamLabels ?? {};
    const mine = (prs.data ?? [])
        .filter((p) => p.role === "author")
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    if (prs.isPending && !prs.data) return <PendingPage />;
    if (prs.isError && !prs.data) {
        return (
            <LoadErrorPage
                what="your pull requests"
                error={prs.error}
                onRetry={() => void prs.refetch()}
            />
        );
    }
    const copy = async () => {
        const done = () =>
            pushToast(
                `Copied ${mine.length} PR${mine.length === 1 ? "" : "s"} to clipboard`,
            );
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([buildHtml(mine)], {
                        type: "text/html",
                    }),
                    "text/plain": new Blob([buildText(mine)], {
                        type: "text/plain",
                    }),
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
            {prs.isError && (
                <ErrorBanner
                    title="Couldn't load PRs"
                    error={prs.error}
                    onRetry={() => void prs.refetch()}
                />
            )}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-fg text-lg font-semibold">My PRs</h1>
                    <span className="text-muted text-sm">{mine.length}</span>
                </div>
                {mine.length > 0 && (
                    <Button
                        variant="filled"
                        type="button"
                        leftSection={<Copy size={14} />}
                        onClick={copy}
                    >
                        Copy list
                    </Button>
                )}
            </div>
            {mine.length === 0 ? (
                <p className="text-muted text-sm">
                    No open PRs authored by you.
                </p>
            ) : (
                mine.map((pr) => (
                    <AuthoredPrCard
                        key={pr.canonical}
                        pr={pr}
                        labels={labels}
                    />
                ))
            )}
        </div>
    );
}
