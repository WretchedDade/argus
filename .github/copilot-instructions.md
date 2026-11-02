# Copilot instructions for Argus

Read [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, checks, and the PR process. Read [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) before you change the server, the database, or the client structure.

## Architecture

- Keep Argus as one Node process: poller, store, and HTTP server.
- Wire parts together in `server/extension.ts` and `server/standalone.ts`. Keep the two entry points consistent.
- Read Azure DevOps only through `packages/ado-client` and the helpers in `server/ado/`.
- Let the poller write PR data through `upsertPr`. Do not let it change user choices such as lane, scope, or dismissal.
- Let the API reach the host through `ApiContext`. Do not import more poller functions into `server/api.ts`.

## Database

- Access SQLite only through `ArgusStore` in `server/db.ts`.
- Treat `pr_events` as the append-only timeline. Derive metrics from it when you can, and do not store a second copy of data.
- Write user-managed columns on `prs` only through dedicated action methods.
- Add a column in two places: `SCHEMA` and `#ensureColumn`. Make it nullable or give it a `DEFAULT`.
- Keep every schema change safe for a user who upgrades and keeps their history. There is no down-migration.
- Test each schema change in `server/db.test.ts` against an old-schema database.

## API

- Add routes as `/api/...` blocks in `handleApi` in `server/api.ts`.
- Use `GET` for reads and `POST` for actions that change data.
- Reply with `sendJson`. Do not write to `res` directly.
- Add the response type, the `api` helper, and the `queryOptions` in `src/lib/api.ts` for each endpoint.

## Frontend

- Add one file in `src/routes/` for each route. Do not edit or commit `src/routeTree.gen.ts`.
- Fetch data with TanStack Query and the `queryOptions` from `src/lib/api.ts`.
- Put shared components in `src/components/` and charts in `Charts.tsx` (Recharts).

## Testing

- Write the test first for a bug fix. It must fail on the old code and pass on the new code.
- Add each new test file to the `test` script in `package.json`. A file that is not in the script does not run in CI.
- Test calculations in `server/db.test.ts`. Do not test Recharts itself.
- Run `npm run format:check`, `npm run typecheck`, and `npm test` before you push.

## Code style

- Use TypeScript for all code, including build and server code.
- Use the formatting from Prettier (four-space indentation). Do not hand-format.
- Write comments only where the code is not clear. Keep them to one short line.
- Write prose, comments, and docs in Simplified Technical English.
- Make the narrowest change that solves the problem. Do not mix unrelated changes in one PR.

## Security

- Do not put real PR data, tokens, or private config in code, tests, docs, or screenshots.
- Do not commit the `data` folder or any database file.
- Report security problems as described in `SECURITY.md`. Do not open a public issue.

## Reliability

- Make each poller tick catch its own errors, so one failed run does not stop the schedule.
- Record each poll run in `poll_runs`.
- Keep features that need a Copilot session failing with a clear message in standalone mode.

## Releases and versioning

Argus uses semantic versioning (`MAJOR.MINOR.PATCH`). The version lives in `package.json` (`version`). A release is published when a change to `package.json` reaches `main` with a version that has no tag yet. The Release workflow creates the tag. Other commits and merges to `main` do not publish anything.

Version policy while on `0.x`:

- Bump MINOR for new features, and for any change that can disrupt users (config format, database schema, setup flow, archive layout).
- Bump PATCH for bug fixes and docs-only or internal changes that users should receive.
- Do not bump for changes that do not reach users (CI-only, tests, repo docs).
- Move to `1.0.0` only when upgrades are promised to keep config and stored history working.

### When you open a PR

Before you open a PR, ask the user whether the PR should bump the version. Use `ask_user` with these choices: no bump, patch, minor (recommend one, based on the policy above). Do not bump without an answer.

If the user chooses a bump:

1. Edit `version` in `package.json`. Also update the root `version` fields in `package-lock.json` (run `npm install --package-lock-only` to keep them in sync).
2. Mention the new version in the PR description.

Never create or push a tag unless the user explicitly asks.

### Release notes

GitHub generates the release notes from the PRs merged since the previous tag (`--generate-notes`). Each PR title becomes one line in the notes, and the PR labels choose its section (see `.github/release.yml`). Write both for the user who reads the release.

PR title rules:

- Start with an imperative verb: "Add", "Fix", "Change", "Remove". Example: "Add update notices to the bell".
- Describe the user-visible result, not the implementation. Do not use a type prefix (`feat:`, `fix:`).
- Keep the title under 70 characters, with no trailing period.
- Use a title that makes sense without the PR body. Do not use "WIP", "updates", or "misc fixes".

PR label rules (apply exactly one category label):

- `enhancement`: a new feature or an improvement to an existing one.
- `bug`: a fix for incorrect behavior.
- `documentation`: docs-only changes.
- `maintenance`: CI, tests, dependencies, refactors, and other changes users do not see.
- `breaking`: add this label as well when users must act on upgrade (config, database schema, setup flow, archive layout). Describe the required action in the PR body.
- `skip-changelog`: the PR does not appear in the release notes.

When you open a PR, set the title and labels with `gh pr create --label <label>` (or `gh pr edit --add-label`). The release notes are only as good as these two fields.

### How to release (after the bump PR is merged)

Merging the bump PR is the release. When a change to `package.json` reaches `main` and `vX.Y.Z` has no tag yet, the Release workflow (`.github/workflows/release.yml`) runs the checks, runs `scripts/package-release.ts`, creates the tag on the merge commit, and attaches `argus-vX.Y.Z-windows.zip` to a GitHub Release. If the checks fail, no tag is created. Fix the problem and re-run the workflow (it also has a manual `workflow_dispatch` trigger).

To fix a bad release, delete the GitHub Release and the tag (`git push origin :refs/tags/vX.Y.Z`), fix the problem, and re-run the workflow.

The archive layout and install steps are in `docs/INSTALL.md`. Update that file when the layout, install destinations, or upgrade behavior change.
