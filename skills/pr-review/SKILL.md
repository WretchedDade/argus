---
name: pr-review
description: "Collaborative Azure DevOps PR review. Fetches PR details, walks through the changes with the reviewer, posts approved findings as PR comments, and records the verdict to Argus with a headless HTTP POST. Use when given a PR link, a PR number, or when asked to review a PR."
---

# PR Review (baseline)

Review Azure DevOps pull requests end-to-end: fetch the PR, gather context, walk
the changes with the reviewer, post approved findings as comments, then record the
verdict to **Argus**.

This is a baseline skill. It carries the structure Argus depends on (the review
modes and the headless verdict recording) plus a neutral review philosophy.
Adapt the review standards in "What to look for" to your own bar. Keep the mode
names and the Phase 3 recording exactly as written, because Argus drives them.

## Philosophy

The human owns the review. The AI accelerates it.

The reviewer reads the code, forms their own understanding, and identifies
concerns. The skill makes that faster and more thorough, it does not replace it:

- **Speed** — set up the workspace and context before the reviewer starts.
- **Context** — surface PR metadata, linked work items, and prior review history.
- **Cross-referencing** — use code intelligence to check things that are slow by
  hand.
- **Gap-filling** — after the reviewer shares their read, catch what they missed.
- **Accountability** — the reviewer's name goes on every comment. The reviewer
  must understand and be able to defend every piece of feedback.

Focus only on issues that matter: bugs, security problems, logic errors, and
architectural concerns. Do not comment on style or formatting.

## Spawned reviews (from Argus)

When Argus dispatches a review, this skill starts in a fresh session that the user
joins to drive the review. Do not front-run the collaboration:

- A kickoff containing `Review mode: automatic` is the intentional autonomous
  exception. Follow Automatic Mode below instead of waiting for the user.
- Do the prep (workspace and context), then **stop and wait for the user** before
  revealing findings, casting a vote, or stating a verdict.
- Only once the review has concluded with the user do you wrap up.
- Recording the outcome is part of the skill (Phase 3). Record it yourself; do not
  report back to your creator.

## Review modes

This skill runs in interactive Full or Quick mode, plus an explicit Automatic
mode. Detect the mode at the start. `Review mode: automatic` takes precedence
over `Lane: quick`. Otherwise the lane selects Full or Quick mode. Default to
Full Mode when neither marker is present.

### Full Mode (review lane — default)

The standard file-by-file review. For each file, the reviewer examines first and
shares what they notice (Turn 1), then the skill fills gaps (Turn 2). Best for PRs
that need careful attention. Run full context setup and the full Phase 2 ceremony.

### Quick Mode (quick lane)

A faster pass for small surface areas the reviewer trusts. Skip the per-file
Turn 1 / Turn 2. Present every file's diff together with any findings inline, all
at once. The reviewer scans, adjusts, and proceeds to Phase 2. Expect 1 to 3
findings, not 10 or more.

### Automatic Mode (`Review mode: automatic`)

Run an autonomous, in-depth Full Mode review even though Argus exposes the action
only in the quick lane. Review the entire PR, set up the worktree, use code
intelligence, inspect existing threads and linked work items, and validate
normally. Do not pause for Turn 1 / Turn 2 or use ownership-only filtering.

When there are **zero findings** and **validation is complete and confident**,
cast the ADO Approved vote and record Argus verdict `approved`. Do not approve
under any other condition. With any
finding, uncertainty, incomplete validation, or operational failure: **post no
ADO comments**, **cast no ADO vote**, record provisional Argus verdict `waiting`
when possible, and leave a detailed findings/blocker summary in the child chat.
Never claim success after a partial failure.

## Phase 0 — Setup and context

**Step 0 — Determine the review mode.** First scan for
`Review mode: automatic`; it selects Automatic Mode regardless of the lane.
Otherwise `Lane: quick` selects Quick Mode and `Lane: review` (or no line)
selects Full Mode. Announce the mode in one line before anything else.

Then gather context:

- Fetch the PR metadata (title, description, author, reviewers, status, files).
- Read linked work items and any prior review history.
- For Full and Automatic Mode, set up a worktree or a read context so the reviewer
  can navigate the code with code intelligence. Keep dependency installs lazy.

## Phase 1 — Walk the changes

- **Full Mode:** go file by file. The reviewer reads first and shares concerns;
  you then add anything missed, with a short note on how you found it.
- **Quick Mode:** present all diffs together with inline findings; the reviewer
  scans and adjusts.

Cross-reference with code intelligence (definitions, references, call graphs) and
related code so a finding is grounded, not guessed.

## Phase 2 — Findings and comments

- **Automatic Mode:** do not post comments. Any finding, uncertainty, incomplete
  validation, or failure stops the review before ADO writes. Only a completed,
  confident zero-finding review casts an Approved vote and records Argus
  `approved`.
- Consolidate related findings. Tier them into "fix now" and "follow-up".
- Lead with what is good. Frame conventions as patterns to learn, not mistakes.
- Post a comment **only** with the reviewer's approval. The reviewer's name is on
  it, so the reviewer must agree with and understand each one.
- Cast the vote only when the reviewer says so.

## Phase 3 — Record the verdict to Argus

Once the review has concluded and the vote is cast, record the outcome yourself
with a headless HTTP POST to Argus's fixed ingest port (48100). No canvas is
needed.

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:48100/api/pr/record-review `
  -ContentType application/json `
  -Body '{"canonical":"<pr-url>","verdict":"<approved|suggestions|waiting|rejected>"}'
```

- `canonical` is the full PR URL.
- `verdict` is one of `approved`, `suggestions` (approve with suggestions),
  `waiting` (waiting on the author), or `rejected`.
- If the POST fails (Argus is not running), tell the user the verdict so they can
  record it by hand. Do not report back to your creator.

In Automatic Mode, `approved` is allowed only after the ADO Approved vote
succeeds. Otherwise record provisional `waiting` when possible; it is an Argus
queue state and does not imply an ADO vote. The final child-chat summary must
state what was reviewed, validation performed, ADO vote status, and Argus
recording status. If not approved, include every finding or blocker and confirm
that no ADO comments or vote were posted.

## What to look for

Adapt this to your own bar. A reasonable baseline:

- **Correctness** — logic errors, off-by-one, wrong conditionals, missed cases.
- **Security** — injection, missing authz checks, secret handling, unsafe input.
- **Error handling** — swallowed errors, missing rollback, partial writes.
- **Concurrency** — races, unguarded shared state.
- **API and data contracts** — breaking changes, schema and version mismatches.
- **Tests** — do the tests cover the change, and would they catch a regression.

Do not comment on formatting, naming preferences, or anything a linter owns.
