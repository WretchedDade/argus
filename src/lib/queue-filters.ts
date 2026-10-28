import type { Pr } from "./api.ts";

export interface QueueFilters {
    group?: string;
    creator?: string;
    repository?: string;
}

export function parseQueueFilters(
    search: Record<string, unknown>,
): QueueFilters {
    const text = (value: unknown) =>
        typeof value === "string" && value.trim() ? value : undefined;
    return {
        group: text(search.group),
        creator: text(search.creator),
        repository: text(search.repository),
    };
}

export function matchesQueueFilters(pr: Pr, filters: QueueFilters): boolean {
    return (
        (!filters.group ||
            pr.requiredApproverGroups?.includes(filters.group) === true) &&
        (!filters.creator || pr.author === filters.creator) &&
        (!filters.repository || pr.repo === filters.repository)
    );
}

export function queueFilterOptions(prs: Pr[]) {
    const unique = (values: string[]) =>
        [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
            a.localeCompare(b),
        );
    return {
        group: unique(prs.flatMap((pr) => pr.requiredApproverGroups ?? [])),
        creator: unique(prs.flatMap((pr) => (pr.author ? [pr.author] : []))),
        repository: unique(prs.map((pr) => pr.repo)),
    };
}
