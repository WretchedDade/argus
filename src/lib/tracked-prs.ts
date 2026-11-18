import type { Pr } from "./api.ts";
import { resolveTeamLabel } from "./format.ts";

export type TrackedView = "archived" | "active" | "all";

export function isArchivedPr(pr: Pr): boolean {
    return (
        pr.dismissed &&
        (pr.dismissedReason === "stale" ||
            pr.dismissedReason === "out_of_scope")
    );
}

export function trackedPrStatus(pr: Pr): string {
    if (isArchivedPr(pr)) return "Archived";
    if (pr.dismissed) return "Dismissed";
    if (pr.state === "closed") return "Closed";
    return pr.isDraft ? "Draft" : "Active";
}

export function trackedPrDate(pr: Pr): string {
    return pr.dismissedAt ?? pr.updatedAt;
}

export function filterTrackedPrs(
    prs: Pr[],
    view: TrackedView,
    search: string,
    labels: Record<string, string>,
): Pr[] {
    const needle = search.trim().toLocaleLowerCase();
    return prs
        .filter((pr) => {
            if (view === "archived" && !isArchivedPr(pr)) return false;
            if (view === "active" && (pr.dismissed || pr.state === "closed"))
                return false;
            const text = [
                pr.title,
                pr.repo,
                `#${pr.number}`,
                pr.author ?? "",
                pr.canonical,
                ...pr.teams.flatMap((team) => [
                    team,
                    resolveTeamLabel(team, labels),
                ]),
            ].join(" ");
            return text.toLocaleLowerCase().includes(needle);
        })
        .sort(
            (a, b) =>
                Date.parse(trackedPrDate(b)) - Date.parse(trackedPrDate(a)) ||
                a.canonical.localeCompare(b.canonical),
        );
}
