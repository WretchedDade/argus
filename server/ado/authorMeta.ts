import { fetchPrThreads, listPrPolicies } from "./client.ts";
import type { AuthorMetaUpdate } from "../types.ts";
import type { CurrentPr } from "./types.ts";

const RESOLVED_THREAD = new Set(["fixed", "wontfix", "closed", "bydesign"]);

// Keep policy and comment results separate so a failed fetch cannot erase data.
export async function fetchAuthorMeta(
    pr: CurrentPr,
    orgUrl: string,
    client = { listPrPolicies, fetchPrThreads },
): Promise<AuthorMetaUpdate> {
    const meta: AuthorMetaUpdate = {
        policies: { ok: false, error: "Policies have not been fetched." },
        comments: {
            ok: false,
            error: "PR has no repository id for thread lookup.",
        },
        mergeStatus: pr.mergeStatus,
    };

    try {
        const policies = await client.listPrPolicies(
            orgUrl,
            pr.project,
            pr.projectId,
            pr.number,
        );
        if (policies === null)
            throw new Error("Policy lookup returned no data.");
        const blockers = policies
            .filter(
                (p) =>
                    p.configuration?.isBlocking &&
                    p.status !== "approved" &&
                    p.status !== "notApplicable",
            )
            .map((p) => p.configuration?.type?.displayName ?? "policy")
            // de-dupe (a policy type can have several evaluations)
            .filter((name, i, arr) => arr.indexOf(name) === i);
        meta.policies = {
            ok: true,
            value: {
                blockers,
                completable:
                    blockers.length === 0 &&
                    !pr.isDraft &&
                    pr.mergeStatus === "succeeded",
            },
            lastSuccessfulAt: new Date().toISOString(),
        };
    } catch (error) {
        meta.policies = { ok: false, error: String(error) };
    }

    try {
        if (pr.repoId) {
            const threads = await client.fetchPrThreads(
                orgUrl,
                pr.project,
                pr.repoId,
                pr.number,
            );
            const real = threads.filter(
                (t) =>
                    !t.isDeleted &&
                    (t.comments ?? []).some((c) => c.commentType !== "system"),
            );
            const resolvedComments = real.filter((t) =>
                RESOLVED_THREAD.has((t.status ?? "").toLowerCase()),
            ).length;
            meta.comments = {
                ok: true,
                value: {
                    resolvedComments,
                    activeComments: real.length - resolvedComments,
                },
                lastSuccessfulAt: new Date().toISOString(),
            };
        }
    } catch (error) {
        meta.comments = { ok: false, error: String(error) };
    }

    return meta;
}
