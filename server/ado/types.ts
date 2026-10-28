// Shapes for Azure DevOps PR data: the raw `az repos pr` JSON (only the fields
// we use) and the normalized form the rest of the app works with.
import type { PrReviewState, PrRole } from "../types.ts";

export interface AdoRawPr {
    pullRequestId: number;
    title: string;
    description?: string;
    status: string;
    isDraft: boolean;
    creationDate: string;
    closedDate?: string;
    createdBy?: { displayName?: string; uniqueName?: string; id?: string };
    reviewers?: {
        id?: string;
        uniqueName?: string;
        displayName?: string;
        vote?: number;
        isContainer?: boolean;
        isRequired?: boolean;
    }[];
    repository?: { name?: string; id?: string };
    mergeStatus?: string;
    lastMergeSourceCommit?: { commitId?: string };
    lastMergeCommit?: { commitId?: string };
    targetRefName?: string;
    sourceRefName?: string;
}

export interface CurrentPr {
    canonical: string;
    org: string;
    project: string;
    repo: string;
    repoId: string;
    number: number;
    title: string;
    description: string;
    author: string | null;
    isVendor: boolean;
    role: PrRole;
    teams: string[];
    requiredApproverGroups: string[];
    reviewState: PrReviewState | null;
    otherVotes: { name: string; vote: number }[];
    isDraft: boolean;
    status: string;
    mergeStatus: string;
    createdAt: string;
    sha: string | null;
    targetBranch: string;
    sourceBranch: string;
    reviewers: {
        id: string;
        vote: number;
        displayName: string | null;
        isContainer: boolean;
        uniqueName?: string | null;
    }[];
}
