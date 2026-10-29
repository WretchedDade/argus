# Copilot instructions for Argus

## Releases and versioning

Argus uses semantic versioning (`MAJOR.MINOR.PATCH`). The version lives in `package.json` (`version`). A release is published only when a tag `vX.Y.Z` is pushed. Commits and merges to `main` do not publish anything.

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

```powershell
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

The Release workflow (`.github/workflows/release.yml`) then verifies that the tag matches `package.json`, runs the checks, runs `scripts/package-release.ts`, and attaches `argus-vX.Y.Z-windows.zip` to a GitHub Release. If the tag and `package.json` differ, the workflow fails and publishes nothing.

To fix a bad release, delete the GitHub Release and the tag (`git push origin :refs/tags/vX.Y.Z`), fix the problem, and tag again.

The archive layout and install steps are in `docs/INSTALL.md`. Update that file when the layout, install destinations, or upgrade behavior change.
