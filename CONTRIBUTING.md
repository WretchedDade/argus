# Contributing to Argus

Thank you for helping with Argus. This guide shows how to set up, run, test, and submit a change. For how the code fits together, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Set up

You need:

- Windows x64 (the tested platform), Node.js 22.22.1 or later, and Git. (The development tools need 22.22.1. The release ZIP needs only 22.13.)
- Azure CLI (`az`) signed in with `az login`, or the Windows account sign-in method (see the README, "Sign-in method").
- Access to an Azure DevOps project, to run the app against real data.

Install the dependencies:

```powershell
npm ci
```

`npm ci` also builds the client and the server bundle (the `prepare` script) and installs the Git pre-commit hook.

## Run and change the code

The fastest loop is the standalone runner. It runs Argus in your browser with a scratch database, and does not touch the installed extension.

```powershell
npm ci
$env:ARGUS_DB_FILE = Join-Path $PWD "data\standalone.db"
npm run standalone
```

- After a **client** change (`src/`): run `npm run build:client` (or keep `npm run dev` running, which is a watch build), then refresh the browser.
- After a **server** change (`server/`): stop the runner and start it again.
- The standalone runner polls live Azure DevOps. The `data` folder holds private PR data. Do not share it or commit it.

The README section "Standalone browser preview" lists the environment variables for more than one preview at the same time.

To test inside the Copilot app, run `npm run build`, then copy the build output to the extension folder (see [docs/INSTALL.md](docs/INSTALL.md) for the layout), and reload extensions in the Copilot app (or restart it). Reloading only the canvas does not load a new server bundle.

## Test

```powershell
npm test
```

`npm test` uses the `node --test` runner. It finds every `*.test.ts` file under `server/` and `src/`, and then runs the tests in `packages/ado-client`. Name a new test file `*.test.ts` and it runs without other changes. Run `npm run test:coverage` to also print coverage.

For a bug fix, write the test first. It must fail on the old code and pass on the new code.

## Format and check types

```powershell
npm run format        # fix formatting
npm run format:check  # check formatting
npm run typecheck     # TypeScript
```

The pre-commit hook formats staged files with Prettier. Use four-space indentation (set in `.prettierrc.json`). Do not edit generated files, such as `src/routeTree.gen.ts`.

CI runs the same checks on every pull request. Run all of them before you push:

```powershell
npm run format:check
npm run typecheck
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

1. Run the three checks above.
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

A release publishes when a change to `package.json` reaches `main` with a minor or major version (patch `0`) that has no tag. A patch version does not release automatically: the next minor release includes it, or a maintainer runs the Release workflow manually. The Release workflow runs the checks, creates the tag, and attaches the ZIP to a GitHub Release. Do not create or push a tag yourself. See the README section "Releasing" for how to fix a bad release.

If you change the archive layout, the install destinations, or the upgrade behavior, update [docs/INSTALL.md](docs/INSTALL.md).

## Report a security problem

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
