# Install and upgrade Argus

This guide is for the release ZIP. You do not need a source checkout or build tools.

## Supported platform

Windows x64 is tested. The ZIP is built on Windows and its `node_modules` include native Windows binaries, which only the Windows account sign-in method loads. The Azure CLI sign-in method uses no native code, so it may work on other platforms, but this is not tested or supported.

## Prerequisites

- The Copilot app, with canvas extensions enabled.
- Node.js 22.13 or later on your PATH. The Copilot app runs `extension.mjs` with it.
- Azure CLI (`az`) signed in with `az login`, or the Windows account sign-in setup described in the README.
- Access to the Azure DevOps organization and project you want to track.

## ZIP layout

```
argus-vX.Y.Z/
  INSTALL.md
  install.ps1                 -> copies extension/ to the install folder
  LICENSE
  THIRD-PARTY-NOTICES        licenses of the packages in extension/node_modules
  release-manifest.json      source/build identity, dependency inventory, file hashes
  extension/                  -> install to %USERPROFILE%\.copilot\extensions\argus
    extension.mjs
    dist/
    node_modules/              only the runtime packages (Azure sign-in) and their dependencies
    package.json
    package-lock.json          pins the installed versions
    argus.config.example.json
    ado-auth-config.example.json   empty registration template, not runtime config
    skills/pr-review/         installed by the first-run setup, if you accept
```

The release also includes a `.zip.sha256` sidecar. Before extracting, compare its
hash with `(Get-FileHash .\argus-vX.Y.Z-windows.zip -Algorithm SHA256).Hash`.
The manifest records the source commit, dirty-source flag, lockfile SHA-256,
build Node/platform/architecture, installed dependency versions/registry
integrities/license metadata and payload file hashes. Dependency license files
remain in `node_modules`. These checks detect accidental changes; they are not a
signature, security review, or reproducible-build attestation.

Maintainers can test acquisition without installing anything:

```powershell
node scripts/package-release.ts --output-root "$env:TEMP\argus-acquisition"
# Or extract a downloaded ZIP outside the source checkout.
node scripts/verify-release.ts "$env:TEMP\argus-acquisition\argus-X.Y.Z"
```

Staging replaces only `argus-X.Y.Z` under that output root, not other versions or
archives. Verification checks the file inventory, entry-point syntax, runtime
imports and Windows x64 native MSAL loading without starting Argus or signing in.
When `GITHUB_SHA` is set, verification also requires a clean source tree and a
manifest source commit that matches that SHA. Both release CI verification
steps enforce this check. Local runs without `GITHUB_SHA` can verify dirty
development builds; the manifest still records their dirty-source flag.
It does **not** prove interactive WAM login, window association, app canvas
discovery or host-injected SDK availability. Never copy a real registration file
into an archive. The empty example is informational; the current canvas continues
to save IDs to the existing shared auth-config location described in the README.
No plugin persistent-data migration has been enabled.

## Install the extension

1. Extract the ZIP to a temporary folder.
2. Run the install script from the extracted `argus-vX.Y.Z` folder. It copies `extension` to `%USERPROFILE%\.copilot\extensions\argus`:

    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
    ```

    The `-ExecutionPolicy Bypass` option applies to this one command only. It lets the script run under the default `Restricted` policy, or when the extracted file has the download mark. It does not change your policy.

    To use a different folder, pass `-Destination <path>`. The script copies over the existing files and does not delete the folder first, so `argus.config.json` stays.

3. Reload extensions in the Copilot app, or restart it.
4. Open the Argus canvas.

## The pr-review skill (optional)

The board, My PRs, Insights, and Recap work without the skill. The **Review** and **Re-review** buttons need a `pr-review` skill.

The first-run setup screen offers to install the skill. Accept the offer to get the review workflow. Argus never overwrites an existing `pr-review` skill, so a customized one stays as it is.

You can also bring your own skill. On the setup screen, choose **I'll use my own** and enter the `name` from your skill's frontmatter. The Review buttons then tell the agent to run that skill. Your skills folder is left untouched. Your skill must record the verdict back to Argus. See the README section "Recording a review verdict".

## First-run setup

Enter your Azure DevOps org URL, org slug, and project, and choose a sign-in method (Azure CLI, or Windows account on Windows). Then choose where to keep your history, and select **Start watching**.

- **This device** (default): the database is `%LOCALAPPDATA%\argus\argus.db`. Your PR data stays private. A device reset loses the history.
- **OneDrive**: the database is `<OneDrive>\Desktop\argus.db`. OneDrive syncs it, so you can restore your history after a device reset. The PR titles, descriptions, and review history sync to your OneDrive. Run Argus on one device at a time.

If you choose OneDrive, reload extensions to start using it. The README section "Where the database lives" has more detail.

If you choose Windows account, the sign-in screen provides separate **Application
(client) ID** and **Directory (tenant) ID** fields. Enter both IDs from your Entra
app registration, then select **Save setup**. You can edit them there or under
**Settings > Windows account setup**. Saving setup saves only the IDs, not your
sign-in method. See the README for the saved auth-config location and explicit
environment overrides.

To prefill organization defaults, copy `argus.config.example.json` to
`argus.config.json` in the extension folder and edit it. That example does **not**
prefill the client or tenant ID fields. `ado-auth-config.example.json` contains
only the empty registration structure; configure actual IDs through the canvas.

## Verify the installation

1. The Argus canvas opens and shows the setup screen, or the board if already set up.
2. After setup, PRs appear on the board within one poll cycle. To load them now, select **Refresh** beside the search box. It runs the same check as the background poll.
3. With the skill installed, select **Review** on a PR. A child review session starts and records a verdict.

## Upgrade

Once a day, Argus checks GitHub for a new release. When one exists, the bell shows a notice. Select **Update now**. Argus downloads the ZIP, checks it against the SHA-256 file of the release, and runs `install.ps1`. If the checksum does not match, Argus installs nothing and shows an error. Then reload extensions. If you edited your `pr-review` skill, a **Merge with Copilot** notice appears after the reload. To stop the check, clear **Check for new versions** in Settings. Argus sends no data about you.

To upgrade by hand, extract the new ZIP and run `install.ps1` from it with the same command as the install. To check the ZIP first, compare `(Get-FileHash <zip>).Hash` with the hash in the `.sha256` file on the release page. Your `argus.config.json` and database are not in the ZIP, so the copy keeps them. Then reload extensions.

An unedited `pr-review` skill that Argus installed updates by itself. If you edited it, Argus leaves it and shows a notice with **Merge with Copilot** and **Use new version**. **Use new version** replaces your copy with the bundled one and saves your old copy in `~/.copilot/skill-backups/`.

If your database is still on OneDrive from an earlier version, Argus keeps using it and shows a notice with **Choose with Copilot**. Choose to move it to `%LOCALAPPDATA%\argus\argus.db`, or to keep it on OneDrive as a backup. The notice clears after you choose and reload extensions. Argus never moves the file without your approval.

## Uninstall

Delete `%USERPROFILE%\.copilot\extensions\argus`. Your database is not in that folder in a current install, so it stays where it was: `%LOCALAPPDATA%\argus\argus.db`, the OneDrive file, or the path in `ARGUS_DB_FILE`. An install from an earlier version that never used OneDrive can still keep its database in `data\argus.db` in the extension folder. Move it out first if you want to keep your history. Delete the database too if you want to remove your stored history. Delete `%LOCALAPPDATA%\argus\storage.json` as well to forget your location choice.
