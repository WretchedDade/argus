import type { AdoRawPr, CurrentPr } from "./types.ts";
import type { Ownership } from "./ownership.ts";
import { DEFAULT_VENDOR_PATTERN } from "../config.ts";

// A name is a vendor when it matches the configured regular expression. The
// default matches a "(Company)" parenthetical, for example "Jane Doe (Acme)".
// An empty pattern turns the rule off. An invalid pattern matches nothing.
export function isVendorName(
    name: string | null | undefined,
    pattern: string = DEFAULT_VENDOR_PATTERN,
): boolean {
    if (!pattern) return false;
    try {
        return new RegExp(pattern).test(name || "");
    } catch {
        return false;
    }
}

// Map a raw ADO PR into the normalized form. canonical matches the URL shape the
// legacy tracker used, so it lines up with migrated history.
export function normalizePr(
    raw: AdoRawPr,
    org: string,
    project: string,
    ownership: Ownership,
    vendorPattern: string = DEFAULT_VENDOR_PATTERN,
): CurrentPr {
    const repo = raw.repository?.name ?? "";
    const author = raw.createdBy?.displayName ?? null;
    return {
        canonical: `https://${org}.visualstudio.com/${project}/_git/${repo}/pullrequest/${raw.pullRequestId}`,
        org,
        project,
        repo,
        repoId: raw.repository?.id ?? "",
        projectId: raw.repository?.project?.id ?? "",
        number: raw.pullRequestId,
        title: raw.title ?? "",
        description: raw.description ?? "",
        author,
        isVendor: isVendorName(author, vendorPattern),
        role: ownership.role ?? "reviewer",
        teams: ownership.teams,
        requiredApproverGroups: [
            ...new Set(
                (raw.reviewers ?? [])
                    .filter(
                        (r) => r.isContainer && r.isRequired && r.displayName,
                    )
                    .map((r) => r.displayName!),
            ),
        ],
        reviewState: ownership.reviewState,
        otherVotes: ownership.otherVotes,
        isDraft: !!raw.isDraft,
        status: raw.status ?? "active",
        mergeStatus: raw.mergeStatus ?? "",
        createdAt: raw.creationDate,
        sha: raw.lastMergeSourceCommit?.commitId ?? null,
        targetBranch: (raw.targetRefName ?? "").replace(/^refs\/heads\//, ""),
        sourceBranch: (raw.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
        reviewers: (raw.reviewers ?? [])
            .filter((r) => r.id)
            .map((r) => ({
                id: r.id!,
                vote: r.vote ?? 0,
                displayName: r.displayName ?? null,
                isContainer: !!r.isContainer,
                uniqueName: r.uniqueName ?? null,
            })),
    };
}
