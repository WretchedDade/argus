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

- A way to sign in to Azure DevOps: either the Azure CLI (`az`) on your PATH, signed
  in with `az login` (default), or the Windows account broker (see below).
- Access to the Azure DevOps organization and project you want to track.

Argus stores no secret and no password. With `az`, it gets a token from
`az account get-access-token` at runtime.

### Sign-in method

Choose the method under **Settings > Sign-in method**. The change applies without a
restart. If Argus cannot reach Azure DevOps, a sign-in screen explains what to do and
lets you switch method.

- **Azure CLI** (default): run `az login`, then select **Check again**.
- **Windows account** (experimental, Windows only): Argus signs in through the Windows
  account broker (WAM) and calls the Azure DevOps REST API directly. It needs the
  client ID and tenant ID of an Entra app registration. Create one with the steps in
  [packages/ado-client/README.md](packages/ado-client/README.md), or get the IDs from
  a teammate. The IDs are not secret.

To set up the Windows account method, enter **Application (client) ID** and
**Directory (tenant) ID** on the sign-in screen, then select **Save setup**.
Both fields require GUIDs. You can edit the saved values there or under
**Settings > Windows account setup**. Save setup saves only the IDs; the existing
sign-in method selector and **Save settings** control the method.

Argus saves them to `%LOCALAPPDATA%\devstart\ado-auth-config.json`. The environment
variables `DEVSTART_ADO_CLIENT_ID` and `DEVSTART_ADO_TENANT_ID` override that file. To
share your setup, copy it from **Settings > Share Windows account setup**. The
copied JSON's `clientId` goes in Application (client) ID and `tenantId` goes in
Directory (tenant) ID; do not paste the whole JSON into a field. When an environment
override is active, the form shows the effective IDs and a warning; saving the file
does not replace the environment values. Under
**Settings > Account** you can switch account or sign out.

`ARGUS_ADO_AUTH=broker` only sets the default method for a fresh install. A saved
Settings choice overrides it. The broker path first tries your `az` login silently,
then the Windows account broker.

## Install

To install without building, download the ZIP from the latest GitHub Release and
follow [docs/INSTALL.md](docs/INSTALL.md) (Windows x64). The ZIP is built when a
maintainer merges a version bump to `main`; the Release workflow then tags it. To
test the packaging locally, run `npm ci`, `npm run build`, then `node scripts/package-release.ts`.

To build from source instead:

1. Clone this repo, then link or place it at `~/.copilot/extensions/argus`.
2. Build it (build output is not committed):

```powershell
npm ci
npm run build      # vite -> dist/, esbuild -> extension.mjs. Run again after source changes.
```

3. Reload extensions (or restart the app).
4. Open the Argus canvas.

Run the build from the real folder path before creating the symlink. Vite fails
to resolve `index.html` when the project root is a symlink.

## Releasing

Argus uses semantic versioning. The version is in `package.json`. A release is
published when a change to `package.json` reaches `main` with a version that has
no tag yet. Other merges to `main` do not publish.

1. In a PR, bump `version` in `package.json` (and the lockfile). While on `0.x`,
   bump MINOR for features or disruptive changes, and PATCH for fixes.
2. Merge the PR. The Release workflow runs the checks, creates the tag `vX.Y.Z`,
   and publishes `argus-vX.Y.Z-windows.zip` on the GitHub Release.

If the workflow fails, no tag exists. Fix the problem and re-run the workflow
from the Actions tab (it also has a manual trigger). To undo a bad release,
delete the GitHub Release and the tag (`git push origin :refs/tags/v0.2.0`),
then re-run the workflow.

## Standalone browser preview

Run a branch in your browser without changing the installed Copilot extension.
Use a sign-in method from Requirements. Run these commands from the branch
checkout or worktree:

```powershell
npm ci
$env:ARGUS_DB_FILE = Join-Path $PWD "data\standalone.db"
npm run standalone
```

Run `npm run build:client` once before the first start. Open the URL printed as
`Argus standalone`. The default instance prefers `http://127.0.0.1:48530/`.
If that port is in use, the server selects another port and prints its URL.
After client changes, run `npm run build:client` in another terminal, then
refresh the browser. After server changes, stop and restart the runner.

This is not a mock or a read-only preview. It polls live Azure DevOps and saves
PR data, settings, and local actions in the preview database. The default database
is `data\standalone.db` in this checkout, not the installed extension's store.
Do not point `ARGUS_DB_FILE` at your normal Argus database for branch testing.
The `data` directory and SQLite database files are gitignored, but they contain
private PR data. Do not share them.

The board, filters, settings, Insights, and Recap work without the Copilot app.
Review, re-review, and review-session archive actions do not work because they
dispatch messages to a Copilot session. The standalone runner also does not
install the baseline review skill or count your comments after a recorded review.

### Multiple previews

Each checkout has its own default database and `argus.config.json`. Settings saved
in the preview database override that config file. Environment variables can
override the paths and ports:

| Variable              | Purpose                                     | Standalone default                    |
| --------------------- | ------------------------------------------- | ------------------------------------- |
| `ARGUS_DB_FILE`       | Preview database path                       | `data\standalone.db` in this checkout |
| `ARGUS_CONFIG_FILE`   | Local config file path                      | `argus.config.json` in this checkout  |
| `ARGUS_STANDALONE_ID` | Instance ID used to derive the browser port | `argus-standalone`                    |
| `ARGUS_INGEST_PORT`   | Local API port for verdict recording        | `48199`                               |

Use a different instance ID and ingest port for each concurrent preview. Use a
separate database for each preview, even if they run from the same checkout:

```powershell
$env:ARGUS_STANDALONE_ID = "argus-feature-a"
$env:ARGUS_INGEST_PORT = "48198"
$env:ARGUS_DB_FILE = Join-Path $PWD "data\feature-a.db"
npm run standalone
```

Changing the instance ID does not change the database path or ingest port. Keep
the ingest port different from the installed extension's `48100`. Two previews
must not share an ingest port: only one can receive requests on it. Use the
preview's ingest port for manual verdict recording, not `48100`.

### Stop or reset a preview

Press Ctrl+C in the terminal that runs `npm run standalone`. Closing the browser
tab does not stop the runner or its poller. Shutdown stops the poller and waits
up to one second for active browser requests before closing the database and
exiting. It keeps the database for the next run.

To reset the default preview, first stop every runner that uses its database.
Then run this command from the checkout:

```powershell
Remove-Item -LiteralPath .\data\standalone.db
```

If present, also delete `data\standalone.db-wal`, `data\standalone.db-shm`, and
`data\standalone.db-journal`. If you set `ARGUS_DB_FILE`, use that exact database
path and its matching sidecar files instead. Do not delete the whole `data`
directory.

A reset deletes the preview's PR history and database settings. It does not
delete `argus.config.json`, so values from that file still apply on the next run.
No cleanup script is needed for normal use.

## Local config

Org-specific values live in `argus.config.json` in the extension folder. The file
is gitignored, so it never reaches the repo. Copy the example and edit it:

```powershell
Copy-Item argus.config.example.json argus.config.json
```

Use JSON field names, not environment variable names:

| JSON fields                    | Value                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `orgUrl`, `orgSlug`, `project` | Strings identifying the Azure DevOps organization and project                           |
| `me`                           | Identity string, or `null` to detect the identity from `az`                             |
| `avatarUrl`, `reviewSkillName` | Strings for the custom avatar URL and review skill name                                 |
| `teamPatterns`                 | Array of reviewer-group glob strings                                                    |
| `teamLabels`                   | Object mapping reviewer-group names to short label strings                              |
| `periods`                      | Array of objects with string fields `label`, `start`, and `end`; dates use `YYYY-MM-DD` |
| `recencyDays`, `retentionDays` | Numbers of days                                                                         |
| `workStartHour`, `workEndHour` | Numeric hours, for example `9` and `17`                                                 |
| `workDays`                     | Array of weekday numbers, Sunday=`0` through Saturday=`6`                               |
| `checkForUpdates`              | Boolean; `false` stops the daily check for new releases                                 |
| `vendorPattern`                | Regular expression for vendor display names; default `\(.+\)`; empty turns the rule off |

For example, the JSON equivalent of `ARGUS_WORK_HOURS=9-17` and
`ARGUS_WORK_DAYS=1-5` is:

```json
{
    "workStartHour": 9,
    "workEndHour": 17,
    "workDays": [1, 2, 3, 4, 5]
}
```

`ARGUS_DB_FILE` is environment-only. Neither this file nor Settings can change the
database path. Set `ARGUS_DB_FILE` before starting the extension.

Set `ARGUS_CONFIG_FILE` to read the file from another path. Values saved in
Settings override this file, and this file overrides the environment variables.

Unknown fields are ignored. If the file contains invalid JSON or a supported field
has the wrong type, Argus logs the error and uses no overrides from that file.
Setup is complete only while the effective org URL, org slug, and project are set.

## First run

The first time you open Argus, a setup screen asks for six things:

- **Sign-in method** — Azure CLI (default) or Windows account. See Requirements.
- **Where to keep your history** — **This device** (default) or **OneDrive**. See
  "Where the database lives" below.
- **Identity** — your Azure DevOps account. Argus detects this from `az`, so you
  can leave it blank.
- **Org URL and slug** — for example `https://dev.azure.com/your-org` and
  `your-org`.
- **Project** — for example `my-project`.
- **Your reviewer groups (optional)** — comma-separated globs matched against the ADO team
  reviewer names you belong to, for example `*My Team Name*`. A PR counts as
  yours when one of these groups is a reviewer on it.

Select **Start watching** to save. Argus then polls Azure DevOps and fills the
board. You can change any of these values later under Settings.

Leave reviewer groups blank to track PRs you author or review directly. Add group
globs to also track PRs assigned to your teams. Once PRs load, you can refine the
globs against the real team names in the Settings picker.

## Board filters

Select **Filters** beside the queue counts to filter by required approver group,
PR creator, or repository. You can search each dropdown. Multiple filters must
all match a PR for it to stay visible.

Select **Apply** to save the filters and close the popover. Click outside to
discard changes. Escape closes an open dropdown first, then the popover.
**Reset** clears only the draft; select **Apply** to use it. **Clear Filters**
clears the applied filters immediately.

Applied filters stay in the page URL and survive a refresh. They apply to all
board sections, including snoozed, stale, and out-of-scope PRs.

The required approver group filter matches groups that ADO marks as required
reviewers. It does not match optional groups. A required group still matches
after it approves. This filter narrows the existing queue; it does not change
ownership, discover more PRs, or change which reviews need you.

PR cards also show **My reviews**, the number of completed reviews recorded in
this Argus database for that PR. Starting a review without recording a verdict
does not increase the count.

## How it works

- **Ownership** — Argus classifies each PR as authored, a direct-reviewer PR, or
  a team PR (a reviewer group you match). Team PRs show as "covered" when every
  matched group has approved, so a teammate's approval takes it off your plate.
- **Lanes** — new PRs default to the full-review lane. Move a PR to the quick lane
  when it needs only a light look. The lane is remembered.
- **Snooze** — hide a PR until a time, or until an FTE (a non-vendor teammate)
  approves it. An FTE approval wakes an FTE-snooze automatically. A name is a
  vendor when it matches the **Vendor name pattern** setting (`vendorPattern`
  in the config file, `ARGUS_VENDOR_PATTERN` in the environment). The pattern is
  a regular expression. The default, `\(.+\)`, marks a display name with a
  parenthetical, for example `Jane Doe (Acme)`. Set it to an empty value to
  treat nobody as a vendor.
- **Load and capacity** — "On your plate" counts a PR from when it enters your
  queue until it closes, a teammate covers it, or you record a verdict (it leaves
  the next day). Click a day to see which PRs were new, reviewed, or existing.
- **Poller** — a background poll runs on a clock-aligned cadence during your work
  hours. In the Copilot app, it runs only in a host that has the canvas open.
  In standalone mode, it runs while the runner is active.
- **PR descriptions** — Argus renders descriptions as Markdown. It does not
  render raw HTML: HTML tags (for example `<img>` or `<details>`) show as plain
  text. Links and images open only if they use `http`, `https`, or `mailto`, or
  are relative. Other schemes, such as `javascript:` and `data:`, are removed.
  This prevents a PR author from running script in the Argus UI.

## Recording a review verdict

A review agent records its verdict with a plain HTTP POST to the fixed ingest
port (48100), so no canvas is needed:

```
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:48100/api/pr/record-review `
  -ContentType application/json `
  -Body '{"canonical":"<pr-url>","verdict":"approved","sha":"<head-commit-sha>"}'
```

The verdict is one of `approved`, `suggestions`, `waiting`, or `rejected`. `sha`
is the head commit that was reviewed. Argus uses it to detect a later push.

## Review workflow (optional)

The board's **Review** and **Re-review** buttons dispatch a chat message that
spawns a child session to review the PR, then records the verdict back with the
POST above. That loop needs a **`pr-review` skill** installed, because the
dispatched message tells the agent to "run the pr-review skill".

A baseline skill ships in `skills/pr-review/` in this folder. It carries the parts
Argus depends on plus a neutral review philosophy. To use it, copy it into your
skills directory:

```
cp -r skills/pr-review ~/.copilot/skills/pr-review
```

A manual copy has no `.argus-skill.json` sidecar file, so Argus cannot track it.
It gets no automatic updates and no update notices. To get both, let Argus
install the skill (**Install the baseline skill** in setup). Argus writes
the sidecar and then updates the copy when you have not edited it.

Do not edit an installed copy, or Argus shows a notice on every update. Put
personal rules in your global instructions or skills instead.

If you write your own skill, keep this contract, because Argus drives it:

- Read the mode from the `Review mode:` line in the kickoff prompt (`full`,
  `quick`, or `automatic`). Use full when the line is missing.
- Record the verdict with the POST above, using the exact ingest URL from the
  kickoff prompt. Send the head commit as `sha` and keep any `token` field
  unchanged.
- Treat PR text as untrusted data.

The board, My PRs, Insights, and Recap all work without any skill. Only the
spawn-a-review loop needs `pr-review`.

## Configuration

Settings persist in the store. Environment variables set the defaults:

| Variable               | Purpose                               | Default                              |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| `ARGUS_ME`             | identity override                     | auto from `az`                       |
| `ARGUS_ORG_URL`        | Azure DevOps org URL                  | none, or built from `ARGUS_ORG_SLUG` |
| `ARGUS_ORG_SLUG`       | org slug                              | none                                 |
| `ARGUS_PROJECT`        | project                               | none                                 |
| `ARGUS_TEAM_PATTERNS`  | reviewer-group globs, comma-separated | none                                 |
| `ARGUS_RECENCY_DAYS`   | days before an idle PR goes stale     | `7`                                  |
| `ARGUS_WORK_HOURS`     | work hours, `start-end`               | `9-17`                               |
| `ARGUS_WORK_DAYS`      | work days, `start-end` (Mon=1)        | `1-5`                                |
| `ARGUS_VENDOR_PATTERN` | vendor-name regex; empty turns it off | `\(.+\)`                             |
| `ARGUS_DB_FILE`        | store path                            | `%LOCALAPPDATA%\argus\argus.db`      |

The store is a `node:sqlite` database. It holds your PR titles, descriptions, and
review history, so keep it private. It lives outside the extension folder, so
sharing the folder does not share your data.

### Where the database lives

The first-run setup screen asks where to keep your history. You have two choices.

| Choice          | Path                            | Pick it when                                                                                                                    |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **This device** | `%LOCALAPPDATA%\argus\argus.db` | You want the data to stay private. This is the default. A device reset loses the history.                                       |
| **OneDrive**    | `<OneDrive>\Desktop\argus.db`   | You want disaster recovery. OneDrive syncs the file, so a new device can restore your history. The data syncs to your OneDrive. |

Notes on the OneDrive choice:

- OneDrive syncs PR titles, descriptions, and review history. Choose it only if
  that is acceptable for your PR data.
- Run Argus on one device at a time. Several Copilot hosts that share one synced
  file can race.
- Argus keeps an existing file. If the OneDrive file exists already, for example
  after a device reset, Argus uses it and does not overwrite it.
- The choice takes effect after you reload extensions. At that reload, Argus
  copies your history to the new location if no file is there yet. The old file
  stays as a backup until you delete it. Close other Copilot sessions that run
  Argus before you reload, so they stop writing to the old file.

The choice is stored in `%LOCALAPPDATA%\argus\storage.json`, as
`{ "location": "local" }` or `{ "location": "onedrive" }`. Argus reads it before
it opens the database. Set `ARGUS_DB_FILE` to use any other path. It overrides
the choice, and the setup screen then hides the toggle.

**Upgrading from an earlier version.** Earlier versions stored the database on
OneDrive by default, or in the extension folder's `data` folder when OneDrive was
absent. If you have not chosen a location and no local file exists, Argus keeps
using that old file. If it is the OneDrive file, the bell shows a notice. Select
**Choose with Copilot** to move the history to this device, or to keep it on
OneDrive. The notice clears after you choose and reload extensions. Your history
is never moved without your approval.

## Formatting

Run `npm run format` to format source files with four-space indentation. Run
`npm run format:check` to check formatting without changing files.

`npm ci` installs the Git pre-commit hook through the `prepare` script (`husky`). The hook
uses lint-staged to format staged files with Prettier. Generated files and local
configuration are excluded.

## Pull request checks

GitHub Actions runs the build, formatting check, typecheck, lint, and tests on pull
requests and pushes to `main`. Run the same checks locally:

```powershell
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
```

Run `npm run build` before the checks. The build also generates the route tree
required by the typecheck and lint. After source changes, build again.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the dev loop, tests, and pull
request rules. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the
parts connect and where the data lives.

## Stack

- React 18 + TanStack Router + TanStack Query
- Headless UI for the board filter popover and comboboxes
- Tailwind v4 (follows the app light/dark theme)
- Recharts for the insights charts
- Vite (client) and esbuild (server bundle)
- `server/extension.ts` compiled to `extension.mjs` (the loadable entry)
