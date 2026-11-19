# Argus user guide

For downloads and installation, see [Install and upgrade Argus](INSTALL.md).
For source builds and browser previews, see [Contributing](../CONTRIBUTING.md).

## Requirements

- A way to sign in to Azure DevOps: either the Azure CLI (`az`) on your PATH, signed
  in with `az login` (default), or the Windows account broker (see below).
- Access to the Azure DevOps organization and project you want to track.

Argus stores no secret and no password. With `az`, it gets a token from
`az account get-access-token` at runtime.

## Appearance

Open **Settings > Appearance** to select a color mode and an accent.
Changes apply at once. **Auto** selects light or dark from the
Copilot canvas background when that token is present. In a normal browser, it
uses the system preference. An explicit Light or Dark choice overrides both.
For a dark host, the page background matches the host and shared neutral shades
follow it. Standalone dark mode uses the GitHub dark background.
Your selected accent remains independent.

Appearance choices are saved in browser storage for the current origin. They
are separate from **Save settings** and are not stored in the Argus database.
Different browsers or canvas ports can have different choices.

Controls, forms, PR cards, notifications, and charts use Mantine.
Load context bands use Recharts inside the Mantine chart.
Chart text, grids, and surfaces follow the selected mode.
Verdict and category colors stay distinct from the accent.
The radar stays in the header and uses the selected accent. Its sweep speeds
up while a poll runs. The header uses a neutral surface in both modes.
The sweep stops when your system requests reduced motion. Turn on
**Settings > Appearance > Always animate the radar** to override this for the
radar only. This choice is saved with the other appearance settings.

## Sign-in method

Choose the method under **Settings > Sign-in method**. The change applies without a
restart. If Argus cannot reach Azure DevOps, a sign-in screen explains what to do and
lets you switch method.

- **Azure CLI** (default): run `az login`, then select **Check again**.
- **Windows account** (experimental, Windows only): Argus signs in through the Windows
  account broker (WAM) and calls the Azure DevOps REST API directly. It needs the
  client ID and tenant ID of an Entra app registration. Create one with the steps in
  [ADO client setup](../packages/ado-client/README.md), or get the IDs from
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

## Configuration

Setup and Settings save configuration in the SQLite database. Saved values
override environment defaults. Standalone previews use their own database.

`argus.config.json` and `ARGUS_CONFIG_FILE` are no longer read. Before upgrading
from a version that uses that file, save any file-only values through Settings
in the old version. Existing database settings do not need migration.

The Windows account registration file and `storage.json` are separate and still
supported. `ARGUS_DB_FILE` still overrides the database path.

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

Select **Start watching** to save. Argus starts a poll immediately. The empty
board shows loading feedback while the poll runs, then displays the results.
You can change any of these values later under Settings.

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
- **Review modes** — choose a mode when you start a review. **Review for me** is
  the primary action: Copilot reviews, then you add your findings. **Review with
  me** lets you lead, turn by turn. **Delegate** lets Copilot approve only when
  it finds no issues. For a PR with a linked review session, **Review updates**
  replaces these choices when the head changed since the last recorded review.
  Otherwise, the action is **Re-review**. Both reuse the linked session and the
  last interactive mode (Review with me if none is saved). The queue puts PRs
  that need you first, then sorts by recent activity.
- **History** — the stored `quick` and `review` keys now mean Review for me and
  Review with me. Starting either mode saves that choice for history and charts.
  Delegate leaves it unchanged, so its reviews count under the last saved mode
  (or Review with me for a new PR). No database migration is needed.
- **Snooze** — hide a PR until a time, or until an FTE (a non-vendor teammate)
  approves it. An FTE approval wakes an FTE-snooze automatically. A name is a
  vendor when it matches the **Vendor name pattern** setting
  (`ARGUS_VENDOR_PATTERN` sets the environment default). The pattern is
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

The board's **Review for me**, **Review with me**, and **Delegate** buttons
dispatch a chat message to start a review session. A later interactive review
reuses the linked session and applies the selected mode. That loop needs a
**`pr-review` skill** installed. The skill owns the review behavior; prompts
carry the PR, mode marker, and session and verdict commands.

No mode runs local tests, builds, linters, or typechecks. The PR build runs
them. Merge validations and policies do not affect the review verdict.
Delegate posts no comments and votes only to approve with zero findings.
When it finds issues, it records a provisional `waiting` result in Argus
(not an ADO vote) and offers to continue as Review for me in the same chat.
That result does not change the current vote state or completed-review metrics.

A baseline skill ships in [`skills/pr-review/`](../skills/pr-review/) in the source checkout. It carries the parts
Argus depends on plus a neutral review philosophy. To use it, copy it into your
skills directory from the source checkout. Keep an existing `pr-review` skill.
The manual install command stops if the destination already exists:

```powershell
$skillsDirectory = Join-Path $HOME ".copilot\skills"
$destination = Join-Path $skillsDirectory "pr-review"
if (Test-Path -LiteralPath $destination) {
    throw "A pr-review skill already exists. Keep your existing skill."
} else {
    New-Item -ItemType Directory -Path $skillsDirectory -Force -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath .\skills\pr-review -Destination $destination -Recurse -ErrorAction Stop
}
```

A manual copy has no `.argus-skill.json` sidecar file, so Argus cannot track it.
It gets no automatic updates and no update notices. To get both, let Argus
install the skill (**Install the baseline skill** in setup). Argus writes
the sidecar and then updates the copy when you have not edited it.

Do not edit an installed copy, or Argus shows a notice on every update. Put
personal rules in your global instructions or skills instead.

If you write your own skill, keep this contract, because Argus drives it:

- Read the mode from the `Review mode:` line in the kickoff prompt (`with-me`,
  `for-me`, or `delegate`). Use Review with me when the line is missing.
- Keep the `reviewModels` config keys: `quick` selects Review for me, `full`
  selects Review with me, and `automatic` selects Delegate.
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
