import { fetchPrThreads, listPrPolicies } from "./client.ts";
import type { AuthorMeta } from "../types.ts";
import type { CurrentPr } from "./types.ts";

const RESOLVED_THREAD = new Set(["fixed", "wontfix", "closed", "bydesign"]);

// Enrich one of my authored PRs with ADO's own completability signal (branch
// policy evaluations) and comment-thread counts. Best-effort: any fetch failure
// yields a conservative result rather than throwing out of the poll.
export async function fetchAuthorMeta(pr: CurrentPr, orgUrl: string): Promise<AuthorMeta> {
  const meta: AuthorMeta = {
    completable: false,
    blockers: [],
    activeComments: 0,
    resolvedComments: 0,
    mergeStatus: pr.mergeStatus,
  };

  try {
    const policies = (await listPrPolicies(orgUrl, pr.number)) ?? [];
    meta.blockers = policies
      .filter((p) => p.configuration?.isBlocking && p.status !== "approved" && p.status !== "notApplicable")
      .map((p) => p.configuration?.type?.displayName ?? "policy")
      // de-dupe (a policy type can have several evaluations)
      .filter((name, i, arr) => arr.indexOf(name) === i);
    // Completable when nothing blocks, it's not a draft, and it merges cleanly.
    meta.completable = meta.blockers.length === 0 && !pr.isDraft && pr.mergeStatus === "succeeded";
  } catch {
    // leave blockers empty / completable false
  }

  try {
    if (pr.repoId) {
      const threads = await fetchPrThreads(orgUrl, pr.project, pr.repoId, pr.number);
      const real = threads.filter(
        (t) => !t.isDeleted && (t.comments ?? []).some((c) => c.commentType !== "system"),
      );
      meta.resolvedComments = real.filter((t) => RESOLVED_THREAD.has((t.status ?? "").toLowerCase())).length;
      meta.activeComments = real.length - meta.resolvedComments;
    }
  } catch {
    // leave comment counts at 0
  }

  return meta;
}
