# Stored data

Argus keeps data on your own computer. It does not send this data to any Argus server. Argus reads Azure DevOps (ADO) with your own access and saves what it reads in one SQLite file.

This document lists everything Argus stores. Update it when you add a table, a column, or a setting key.

## Where the data is

| File                | Content                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `argus.db`          | All PR data, events, logs, and settings (see below).                                         |
| `storage.json`      | Next to the local database. Holds only the database location choice (`local` or `onedrive`). |
| `argus.config.json` | Optional. Org values that you write yourself. It is gitignored.                              |

Sign-in data is outside the database, in `%LOCALAPPDATA%\devstart\` (or `~\.devstart`):

| File                   | Content                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `ado-auth-config.json` | The Entra client ID and tenant ID. Override the path with `DEVSTART_ADO_CONFIG_PATH`.                     |
| `ado-auth.json`        | Your account name, user name, and sign-in record (no tokens). Override with `DEVSTART_ADO_ACCOUNT_STORE`. |

The "Delete all data" action and deleting the database do not remove these files. Delete them yourself to sign out.

The database location is chosen in this order: the `ARGUS_DB_FILE` variable, the saved choice, an older file that already exists, then the local default `%LOCALAPPDATA%\argus\argus.db`. See `server/storage.ts` and `docs/INSTALL.md`.

## What is not stored

- No ADO tokens or passwords. Argus asks the Azure CLI or the broker for a token each time.
- No code or diffs. Argus keeps only a count of changed files.
- No comment text. Argus keeps comment counts only.

## Tables

### `prs`

One row for each PR that Argus tracks. It is the current snapshot. The poller writes it. User choices are written only by dedicated action methods.

| Column                                                    | Content                                                                  | Source           |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- |
| `canonical`                                               | PR key (org, project, repo, number)                                      | ADO              |
| `org`, `project`, `repo`, `number`                        | Parts of the PR key                                                      | ADO              |
| `title`                                                   | PR title                                                                 | ADO              |
| `description`                                             | PR description body, for the card preview                                | ADO              |
| `author`                                                  | Author display name                                                      | ADO              |
| `is_vendor`                                               | The author matches the vendor pattern                                    | Computed         |
| `role`                                                    | `author`, `reviewer`, or `team`                                          | Computed         |
| `teams_json`                                              | Display names of the matched teams                                       | ADO              |
| `required_approver_groups_json`                           | Groups that must approve                                                 | ADO              |
| `reviewers_json`                                          | Reviewers: id, display name, vote                                        | ADO              |
| `approvals_json`                                          | People who approved: name and vote                                       | ADO              |
| `author_meta_json`                                        | For your own PRs: completability, blockers, comment counts, merge status | ADO              |
| `state`                                                   | `pending`, `active`, `closed`, and so on                                 | ADO              |
| `is_draft`                                                | Draft flag                                                               | ADO              |
| `source_branch`, `target_branch`                          | Branch names                                                             | ADO              |
| `last_commit_sha`, `last_commit_at`                       | Latest commit and its commit time (read per commit; empty until read)    | ADO              |
| `pr_created_at`                                           | When the PR was opened                                                   | ADO              |
| `changed_files`, `changed_files_sha`                      | Count of changed files, and the commit it was counted at                 | ADO              |
| `my_comments`, `other_comments`                           | Comment counts                                                           | ADO              |
| `added_at`, `updated_at`                                  | When Argus first saw and last updated the row                            | Argus            |
| `lane`                                                    | Board lane                                                               | User or computed |
| `review_state`                                            | Your standing on the PR                                                  | Computed         |
| `dismissed`, `dismissed_reason`, `dismissed_at`           | Dismiss choice                                                           | User             |
| `snoozed_until`, `snooze_mode`                            | Snooze choice                                                            | User             |
| `out_of_scope`                                            | "Not my review" choice                                                   | User             |
| `review_session_id`                                       | Id of the Copilot session that reviews this PR                           | Argus            |
| `reviewed_sha`, `reviewed_at`, `reviewed_sha_authored_at` | Your recorded verdict: commit, time, and commit date                     | User and ADO     |

### `pr_events`

The append-only timeline of each PR. The Insights page and the Changes bell read from this table. Argus never edits or removes a row in normal use.

| Column      | Content                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | Row id                                                                                                                                                                                                                                     |
| `canonical` | PR key                                                                                                                                                                                                                                     |
| `ts`        | Time of the event (UTC, ISO 8601)                                                                                                                                                                                                          |
| `type`      | `added`, `refreshed`, `lane_changed`, `state_changed`, `reviewed`, `vote_changed`, `review_state`, `commit_pushed`, `draft_changed`, `comment_posted`, `snoozed`, `fte_woke`, `dismissed`, `out_of_scope`, `in_scope`, `removed`, `closed` |
| `payload`   | JSON that depends on the type. Examples: commit sha, vote value, reviewer id and display name (`vote_changed`), verdict and session id (`reviewed`), close reason                                                                          |
| `run_id`    | The poll run that wrote the event                                                                                                                                                                                                          |

### `poll_runs`

One row for each poll cycle: start and end time, success flag, counters (PRs mine, added, updated, events, closed, tracked), and an error message. Pruned by age.

### `activity_log`

The trace of the poller. Each row has a time, a level, a message, optional JSON data, and a run id. Messages and data can include PR titles and reviewer names. Pruned by age.

### `settings`

Key and value pairs.

| Key                                                     | Content                                                                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`                                                | Your overrides from the Settings screen (see `ArgusConfig` in `server/config.ts`): identity, org URL, project, team patterns and labels, vendor pattern, work hours, and similar values |
| `setup_complete`                                        | The first-run setup is done                                                                                                                                                             |
| `changes_seen_at`                                       | Watermark for the Changes bell                                                                                                                                                          |
| `dismissed_notices`                                     | Ids of notices that you closed                                                                                                                                                          |
| `update_check`                                          | Result of the last release check                                                                                                                                                        |
| `seen_teams`                                            | Team display names that Argus has seen                                                                                                                                                  |
| `changed_files_reset`, `changed_files_blob_count_reset` | Markers for one-time data fixes                                                                                                                                                         |

### `changes_read`

The event ids that you marked as read in the Changes bell, and the time.

### `poll_lease`

One row. It names the Argus host that may poll ADO (an owner id and an expiry time in milliseconds). Hosts that share the database file renew it every 30 seconds and release it when they close. Another host takes over after it expires (2 minutes).

### `automatic_review_tokens`

One-time tokens for automatic reviews. Each token has a PR key and an issue time. Tokens expire after 6 hours.

## Personal data in the database

The database holds work data about you and your colleagues: display names of authors and reviewers, votes, PR titles and descriptions, and your own review verdicts. All of it comes from ADO data that you can already read. It stays on your computer, or in your OneDrive folder if you choose that location.

## Retention

- `poll_runs` and `activity_log` are pruned by age. The default is 2 days (`retentionDays` in Settings, or `ARGUS_LOG_RETENTION_DAYS`). The prune runs after each successful poll.
- `prs`, `pr_events`, and the other tables are kept without a limit. The Insights page uses this history, so Argus does not prune it.

## Remove your data

In Argus, open Settings, then System, then "Your data", and choose "Delete all data". Argus asks you to confirm. It then deletes all PRs, events, logs, read marks, and review tokens, and compacts the database file. Your settings and setup state stay. Argus reads your open PRs from ADO again on the next poll, but the old history does not come back.

To remove everything, including your settings, stop Argus. Then delete every copy of the database, with its `-wal` and `-shm` files if they exist: `%LOCALAPPDATA%\argus\argus.db`, `argus.db` in your OneDrive Desktop folder, and `data\argus.db` in the extension folder. Also delete `storage.json`. Argus can copy an old database that remains into a new location, so a copy that you leave can bring back old data. Argus creates a new empty database at the next start.
