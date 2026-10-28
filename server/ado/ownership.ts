import type { AdoRawPr } from "./types.ts";
import type { PrReviewState, PrRole } from "../types.ts";

export interface ReviewerVote {
    name: string;
    vote: number; // 10 approved, 5 suggestions, -5 waiting, -10 rejected
}

export interface Ownership {
    role: PrRole | null; // null = not mine
    teams: string[]; // matched team display names (for role "team", possibly several)
    reviewState: PrReviewState | null; // my/my-team standing (null for author)
    otherVotes: ReviewerVote[]; // individual humans (not me, not containers) who have voted
}

// Classify how a PR is mine and where my review stands.
// Precedence author > reviewer > team; teams always lists every matched team.
export function classifyOwnership(
    pr: AdoRawPr,
    me: string,
    teamPatterns: string[],
): Ownership {
    const reviewers = pr.reviewers ?? [];
    const teams: string[] = [];
    const teamVotes: number[] = [];
    const otherVotes: ReviewerVote[] = [];
    let directReviewer = false;
    let myVote = 0;

    for (const r of reviewers) {
        const vote = r.vote ?? 0;
        if (r.uniqueName === me) {
            directReviewer = true;
            myVote = vote;
        }
        if (r.isContainer && r.displayName) {
            for (const pat of teamPatterns) {
                if (matchGlob(r.displayName, pat)) {
                    teams.push(r.displayName);
                    teamVotes.push(vote);
                    break;
                }
            }
        } else if (
            !r.isContainer &&
            r.uniqueName !== me &&
            r.displayName &&
            vote !== 0
        ) {
            otherVotes.push({ name: r.displayName, vote });
        }
    }

    const authored = pr.createdBy?.uniqueName === me;
    const role: PrRole | null = authored
        ? "author"
        : directReviewer
          ? "reviewer"
          : teams.length
            ? "team"
            : null;

    let reviewState: PrReviewState | null = null;
    if (role === "reviewer") {
        reviewState = voteToState(myVote);
    } else if (role === "team") {
        // "Covered" means I'm not blocking the PR: EVERY team container I'm matched
        // on has already been satisfied by a teammate (approve or approve-with-
        // suggestions). If any of my groups still hasn't signed off, the PR can be
        // blocked on my group's review, so it's not covered — it still needs a look.
        // An out-of-group individual approval does NOT cover my group's obligation.
        const allTeamsApproved =
            teamVotes.length > 0 && teamVotes.every((v) => v === 10 || v === 5);
        if (allTeamsApproved) {
            reviewState = "covered";
        } else if (teamVotes.includes(-10)) {
            reviewState = "rejected";
        } else if (teamVotes.includes(-5)) {
            reviewState = "waiting";
        } else {
            reviewState = "needs";
        }
    }

    return { role, teams, reviewState, otherVotes };
}

const voteToState = (v: number): PrReviewState =>
    v === -10
        ? "rejected"
        : v === -5
          ? "waiting"
          : v === 10
            ? "approved"
            : v === 5
              ? "suggestions"
              : "needs";

// Minimal `*`-glob match, case-insensitive, mirroring PowerShell's -like.
function matchGlob(value: string, pattern: string): boolean {
    const rx = new RegExp(
        "^" + pattern.split("*").map(escapeRegex).join(".*") + "$",
        "i",
    );
    return rx.test(value);
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
