# Contributing to Argus

Argus is maintained by a small team. Unsolicited pull requests are not accepted.
Only maintainers and contributors explicitly invited by a maintainer may submit
a pull request. Public issues track maintainer work; they are not invitations
to contribute.

This guide is for maintainers and invited contributors. It shows how to set up,
run, test, and submit a change. For how the code fits together, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Set up

You need:

- Windows x64 (the tested platform), Node.js 22.22.1 or later, and Git. (The development tools need 22.22.1. The release ZIP needs only 22.13.)
- Azure CLI (`az`) signed in with `az login`, or the [Windows account sign-in method](docs/USER-GUIDE.md#sign-in-method).
- Access to an Azure DevOps project, to run the app against real data.

Install the dependencies:

```powershell
npm ci
```

`npm ci` also installs the Git pre-commit hook. It does not build. Run `npm run build` to build the client and the server bundle. The repo has an `.nvmrc` file for Node version managers.

## Run and change the code

The fastest loop is the standalone runner. It runs Argus in your browser with a scratch database, and does not touch the installed extension.

```powershell
npm ci
npm run build:client
$env:ARGUS_DB_FILE = Join-Path $PWD "data\standalone.db"
npm run standalone
```

Run `npm run build:client` before the first standalone start. This also generates `src/routeTree.gen.ts`.

- After a **client** change (`src/`): run `npm run build:client` (or keep `npm run dev` running, which is a watch build), then refresh the browser.
- After a **server** change (`server/`): stop the runner and start it again.
- The standalone runner polls live Azure DevOps. The `data` folder holds private PR data. Do not share it or commit it.
- To see the error states, set `ARGUS_FAKE_FAULT` to a comma-separated list before you start the runner. The values are `prs` (PR list fails with a 500, so the banners and Retry show), `prs-bad` (PR list returns bad data, so the router error screen shows), `config` and `config-slow` (config fails, or loads after 5 seconds), and `setup` (forces the setup screen; combine with `config` or `config-slow` to test the setup form, and do not submit it). Remove the variable and restart to go back to normal.
- To preview the notification bell, set `$env:ARGUS_FAKE_NOTICES = "1"` before you start standalone. It shows synthetic release, skill, and storage notices with `Preview:` titles. Dismissal uses separate preview IDs. Install, replace, and Copilot actions remain unavailable. Remove the variable and restart to return to real notices.

The [Standalone browser preview](#standalone-browser-preview) section lists the environment variables for more than one preview at the same time.

To test inside the Copilot app, run `npm run build`, then copy the build output to the extension folder (see [docs/INSTALL.md](docs/INSTALL.md) for the layout), and reload extensions in the Copilot app (or restart it). Reloading only the canvas does not load a new server bundle.

### Build the extension from source

1. Clone this repo.
2. Run `npm ci` and `npm run build` from the real checkout path.
3. Link or place the checkout at `~/.copilot/extensions/argus`.
4. Reload extensions in the Copilot app, then open the Argus canvas.

Build before creating a symlink. Vite cannot resolve `index.html` when the
project root is a symlink. Build output is not committed. Run the build again
after source changes.

## Standalone browser preview

Run a branch in your browser without changing the installed Copilot extension.
Use a [sign-in method](docs/USER-GUIDE.md#sign-in-method) from the user guide.
Run these commands from the branch checkout or worktree:

```powershell
npm ci
npm run build:client
$env:ARGUS_DB_FILE = Join-Path $PWD "data\standalone.db"
npm run standalone
```

Open the URL printed as `Argus standalone`. The default instance prefers
`http://127.0.0.1:48530/`. If that port is in use, the server selects another port
and prints its URL. After client changes, run `npm run build:client` in another
terminal, then refresh the browser. After server changes, stop and restart the
runner.

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

Each checkout has its own default database. Save preview settings through the
setup and Settings screens. Environment variables can override the paths and ports:

| Variable              | Purpose                                     | Standalone default                    |
| --------------------- | ------------------------------------------- | ------------------------------------- |
| `ARGUS_DB_FILE`       | Preview database path                       | `data\standalone.db` in this checkout |
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

A reset deletes the preview's PR history and database settings. Environment
defaults still apply on the next run. No cleanup script is needed for normal use.

## Test

```powershell
npm test
```

`npm test` uses Vitest. It finds every `*.test.ts` file under `server/`, `shared/`, `src/`, `scripts/`, and `packages/ado-client/src/`. Use `describe` and `it` for named suites and tests. Keep `node:assert/strict` assertions where useful. Run `npm run test:watch` for watch mode. Run `npm run test:coverage` for V8 coverage, including text, JSON summary, and LCOV reports in `coverage/`.

For a bug fix, write the test first. It must fail on the old code and pass on the new code.

## Format and check types

Run `npm run build` before these checks on a clean clone, and after adding, removing, or renaming routes. Typecheck and lint need the generated route tree.

```powershell
npm run format        # fix formatting
npm run format:check  # check formatting
npm run typecheck     # TypeScript
npm run lint          # ESLint (typed rules, React hooks, import boundaries)
npm run knip          # unused client files, exports, and types
```

Knip checks `src/`. Routes are entry points, so the check does not need the generated route tree. Exports used in their own file can remain available to render tests.

The pre-commit hook formats staged files with Prettier and fixes lint errors with ESLint. Use four-space indentation (set in `.prettierrc.json`). Do not edit generated files, such as `src/routeTree.gen.ts`.

CI runs the same checks on every pull request. Run all of them before you push:

```powershell
npm run build
npm run format:check
npm run typecheck
npm run lint
npm test
```

## Write code and docs

- Use TypeScript for all code, including build and server code.
- Write comments only where the code is not clear. Keep them short.
- Write documentation and comments in Simplified Technical English: short sentences, one instruction in each sentence, active voice, present tense.
- Make the narrowest change that solves the problem. Do not mix unrelated changes in one pull request.
- Do not put real PR data, tokens, or private config in code, tests, or screenshots.

## Submit a pull request

Keep a pull request under about 400 changed lines. Split larger work.

The pull request template lists the checks. Before you open the pull request:

1. Run the checks above.
2. Decide the version change (see [Release rules](#release-rules)).
3. Write the title and set the label.

### Title

The pull request title becomes one line in the release notes. So:

- Start with an imperative verb: "Add", "Fix", "Change", "Remove". Example: "Add update notices to the bell".
- Describe the result the user sees, not the implementation. Do not use a type prefix such as `feat:` or `fix:`.
- Keep it under 70 characters, with no period at the end.
- Make it clear without the pull request body. Do not use "WIP", "updates", or "misc fixes".

### Labels

Set exactly one category label. The label chooses the release-notes section (see `.github/release.yml`).

| Label           | Use for                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `enhancement`   | A new feature or an improvement to an existing one                     |
| `bug`           | A fix for incorrect behavior                                           |
| `documentation` | Documentation-only changes                                             |
| `maintenance`   | CI, tests, dependencies, refactors, and other changes users do not see |

You can add these labels as well:

- `breaking`: users must act on upgrade (config, database schema, setup flow, archive layout). Describe the action in the pull request body.
- `skip-changelog`: the pull request does not appear in the release notes.

## Release rules

Argus uses semantic versioning. The version is in `package.json`. While the major version is `0`:

- Bump MINOR for new features and for changes that can disrupt users (config format, database schema, setup flow, archive layout).
- Bump PATCH for bug fixes, and for docs or internal changes that users must receive.
- Do not bump for changes that do not reach users (CI-only, tests, repository docs).

To bump the version, change `version` in `package.json`, then run `npm install --package-lock-only` to update the lockfile. Mention the new version in the pull request body.

A release publishes when a change to `package.json` reaches `main` with a minor or major version (patch `0`) that has no tag. A patch version does not release on push: a daily scheduled run releases it if it has no tag yet, or a maintainer runs the Release workflow manually. The Release workflow runs the checks, creates the tag, and attaches the ZIP to a GitHub Release. Do not create or push a tag yourself.

If the workflow fails, no tag exists. Fix the problem and re-run the workflow
from the Actions tab (it also has a manual trigger). To undo a bad release,
delete the GitHub Release and the tag (`git push origin :refs/tags/vX.Y.Z`),
then re-run the workflow.

If you change the archive layout, the install destinations, or the upgrade behavior, update [docs/INSTALL.md](docs/INSTALL.md).

## Plugin publication

The **Publish plugin** workflow runs after a successful Release workflow, or
manually on `main`. It downloads the latest stable release ZIP and checksum,
verifies its source commit and native runtime, and generates the plugin from
that acquired payload. Releases from before plugin support are rejected.

The workflow appends a generated commit to `plugin`. That branch contains only
the installable payload and its marketplace catalog. Do not edit it by hand.
`main` and the `vX.Y.Z` tags still identify source code. Publication never
force-pushes, downgrades a version, or replaces an existing version with different
files. An identical rerun changes nothing.

The checked-in files under `plugin/` define the plugin and marketplace manifests.
Staging copies the catalog unchanged and stamps the plugin manifest with the
release version. The script does not maintain a second copy of this metadata.

If publication fails, the ZIP release stays available. Fix the cause and rerun
**Publish plugin**. No new release tag is needed for an interrupted publication.
A changed payload needs a new package version and ZIP release.

To stage and verify a local plugin without publishing or installing it:

```powershell
node scripts/package-release.ts --output-root <release-output>
node scripts/plugin-release.ts stage <release-directory> <plugin-output>
node scripts/verify-release.ts --plugin <plugin-directory>
```

Use output directories outside the source checkout. The generated payload records
the original ZIP's source/build identity and new file hashes. Local dirty builds
can be staged, but publication requires clean release evidence.

## Report a security problem

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
