# Argus

Argus is a personal pull request triage canvas for Azure DevOps. It watches the
PRs that need your review, groups them by how much attention they need, and shows
insights about your review load over time. It runs as a Copilot canvas extension
with its own Node process.

## What it does

- **Board** — the PRs on your plate, split into a full-review lane and a quick
  lane, plus snoozed, stale, and out-of-scope sections.
- **My PRs** — the PRs you authored, with merge-blockers and comment counts.
- **Insights** — review rhythm, verdict mix, coverage, and a Load and capacity
  chart with a per-day drill-down.
- **Recap** — a weekly review summary you can copy into a status update or 1:1.
- **Headless verdict recording** — a review session records its verdict with one
  HTTP POST, so no canvas needs to be open.

## Requirements

- The Azure CLI (`az`) on your PATH, signed in with `az login`.
- Access to the Azure DevOps organization and project you want to track.

Argus gets an Azure DevOps token from `az account get-access-token` at runtime. It
stores no secret and no password.

## Install

1. Clone this repo, then link or place it at `~/.copilot/extensions/argus`.
2. Build it (build output is not committed):

```powershell
npm ci             # also runs the build via the prepare script
npm run build      # rebuild after source changes: vite -> dist/, esbuild -> extension.mjs
```

3. Reload extensions (or restart the app).
4. Open the Argus canvas.

Run the build from the real folder path before creating the symlink. Vite fails
to resolve `index.html` when the project root is a symlink.

## Local config

Org-specific values live in `argus.config.json` in the extension folder. The file
is gitignored, so it never reaches the repo. Copy the example and edit it:

```powershell
Copy-Item argus.config.example.json argus.config.json
```

It accepts any setting from the Configuration section, plus two that have no
environment variable:

- `teamLabels` — maps a reviewer group name to a short label.
- `repoPipelines` — maps a repo name to its build pipeline definition id, for the
  deploy timeline.

Set `ARGUS_CONFIG_FILE` to read the file from another path. Values saved in
Settings override this file, and this file overrides the environment variables.

## First run

The first time you open Argus, a setup screen asks for four things:

- **Identity** — your Azure DevOps account. Argus detects this from `az`, so you
  can leave it blank.
- **Org URL and slug** — for example `https://dev.azure.com/your-org` and
  `your-org`.
- **Project** — for example `LPE`.
- **Your reviewer groups** — comma-separated globs matched against the ADO team
  reviewer names you belong to, for example `*My Team Name*`. A PR counts as
  yours when one of these groups is a reviewer on it.

Select **Start watching** to save. Argus then polls Azure DevOps and fills the
board. You can change any of these values later under Settings.

The reviewer-group globs are the important part. They decide which PRs Argus
treats as yours. On first run you must type the names by memory, but once PRs load
you can refine the globs against the real team names in the Settings picker.

## How it works

- **Ownership** — Argus classifies each PR as authored, a direct-reviewer PR, or
  a team PR (a reviewer group you match). Team PRs show as "covered" when every
  matched group has approved, so a teammate's approval takes it off your plate.
- **Lanes** — new PRs default to the full-review lane. Move a PR to the quick lane
  when it needs only a light look. The lane is remembered.
- **Snooze** — hide a PR until a time, or until an FTE (a non-vendor teammate)
  approves it. An FTE approval wakes an FTE-snooze automatically.
- **Load and capacity** — "On your plate" counts a PR from when it enters your
  queue until it closes, a teammate covers it, or you record a verdict (it leaves
  the next day). Click a day to see which PRs were new, reviewed, or existing.
- **Poller** — a background poll runs on a clock-aligned cadence during your work
  hours. It runs only in a host that has the canvas open.

## Recording a review verdict

A review agent records its verdict with a plain HTTP POST to the fixed ingest
port (48100), so no canvas is needed:

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:48100/api/pr/record-review `
  -ContentType application/json `
  -Body '{"canonical":"<pr-url>","verdict":"approved"}'
```

The verdict is one of `approved`, `suggestions`, `waiting`, or `rejected`.

## Review workflow (optional)

The board's **Review** and **Re-review** buttons dispatch a chat message that
spawns a child session to review the PR, then records the verdict back with the
POST above. That loop needs a **`pr-review` skill** installed, because the
dispatched message tells the agent to "run the pr-review skill".

A baseline skill ships in `skills/pr-review/` in this folder. It carries the parts
Argus depends on (the Quick and Full lane modes, and the Phase 3 verdict
recording) plus a neutral review philosophy. To use it, copy it into your skills
directory and adapt the "What to look for" section to your own bar:

```
cp -r skills/pr-review ~/.copilot/skills/pr-review
```

The board, My PRs, Insights, and Recap all work without any skill. Only the
spawn-a-review loop needs `pr-review`.

## Configuration

Settings persist in the store. Environment variables set the defaults:

| Variable              | Purpose                               | Default                                |
| --------------------- | ------------------------------------- | -------------------------------------- |
| `ARGUS_ME`            | identity override                     | auto from `az`                         |
| `ARGUS_ORG_URL`       | Azure DevOps org URL                  | none, or built from `ARGUS_ORG_SLUG`   |
| `ARGUS_ORG_SLUG`      | org slug                              | none                                   |
| `ARGUS_PROJECT`       | project                               | none                                   |
| `ARGUS_TEAM_PATTERNS` | reviewer-group globs, comma-separated | none                                   |
| `ARGUS_RECENCY_DAYS`  | days before an idle PR goes stale     | `7`                                    |
| `ARGUS_WORK_HOURS`    | work hours, `start-end`               | `9-17`                                 |
| `ARGUS_WORK_DAYS`     | work days, `start-end` (Mon=1)        | `1-5`                                  |
| `ARGUS_DB_FILE`       | store path                            | OneDrive Desktop, else `data/argus.db` |

The store is a `node:sqlite` database. It holds your PR history, so keep it
private. It lives outside the extension folder by default, so sharing the folder
does not share your data.

## Formatting

Run `npm run format` to format source files with four-space indentation. Run
`npm run format:check` to check formatting without changing files.

`npm ci` installs the Git pre-commit hook through the `prepare` script. The hook
uses lint-staged to format staged files with Prettier. Generated files and local
configuration are excluded.

## Stack

- React 18 + TanStack Router + TanStack Query
- Tailwind v4 (follows the app light/dark theme)
- Recharts for the insights charts
- Vite (client) and esbuild (server bundle)
- `server/extension.ts` compiled to `extension.mjs` (the loadable entry)
