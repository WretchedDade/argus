# Install and upgrade Argus

Install Argus as a Copilot plugin or use the release ZIP fallback. Neither path
needs a source checkout or build tools. Both use the same verified release runtime.

## Supported platform

Windows x64 is tested. The payload is built on Windows and its `node_modules` include native Windows binaries, which only the Windows account sign-in method loads. The Azure CLI sign-in method uses no native code, so it may work on other platforms, but this is not tested or supported.

## Prerequisites

- The Copilot app, with canvas extensions enabled.
- Node.js 22.13 or later on your PATH. The Copilot app runs `extension.mjs` with it.
- Azure CLI (`az`) signed in with `az login`, or the [Windows account sign-in setup](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#sign-in-method).
- Access to the Azure DevOps organization and project you want to track.

## Install the plugin

The generated `plugin` branch hosts the built payload and its marketplace catalog:

```powershell
copilot plugin marketplace add "WretchedDade/argus#plugin"
copilot plugin install argus@argus
```

Reload extensions in the Copilot app, or restart the session, then open Argus.
If the plugin branch has not been published yet, use the ZIP below.
Plugin installation does not run npm or build from source.

Do not enable both the ZIP extension and the plugin at the same time. To switch
from ZIP, first select **This device** or **OneDrive** in Settings and reload
extensions. Confirm that your history is present. This moves an old
extension-local database out of the installation folder when needed. Then close
Argus and move the old `%USERPROFILE%\.copilot\extensions\argus` folder to a
backup location outside `extensions` before installing the plugin.
Keep that backup until the plugin shows your history and Settings.

Database settings and Windows sign-in files stay in their existing locations.
`argus.config.json` and `ARGUS_CONFIG_FILE` are no longer read in either mode.
Before upgrading an old version, save any file-only values through Settings.

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
    node_modules/              runtime packages (Azure sign-in and Pino logging) and their dependencies
    package.json
    package-lock.json          pins the installed versions
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
to save IDs to the existing shared auth-config location described in the
[user guide](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#sign-in-method).
No plugin persistent-data migration has been enabled.

## Install the extension

1. Extract the ZIP to a temporary folder.
2. Run the install script from the extracted `argus-vX.Y.Z` folder. It copies `extension` to `%USERPROFILE%\.copilot\extensions\argus`:

    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
    ```

    The `-ExecutionPolicy Bypass` option applies to this one command only. It lets the script run under the default `Restricted` policy, or when the extracted file has the download mark. It does not change your policy.

    To use a different folder, pass `-Destination <path>`. The script copies over the existing files without deleting user files from older versions. It replaces only `node_modules`, so packages that a release drops do not remain.

3. Reload extensions in the Copilot app, or restart it.
4. Open the Argus canvas.

## The pr-review skill (optional)

The board, My PRs, Insights, and Recap work without the skill. The **Review** and **Re-review** buttons need a `pr-review` skill.

The plugin contributes the bundled skill directly and skips this choice in setup.
ZIP setup offers to copy it to your personal skills directory.
Argus never overwrites an existing
`pr-review` skill, so a customized one stays as it is. Personal and project skills
take precedence over the plugin skill. A personal copy from an old ZIP install
also keeps precedence; back it up outside your skills directories if you want to
use the plugin-managed baseline instead.

You can also bring your own skill. In Settings, set **Review skill** to the `name` from your skill's frontmatter. ZIP installs also offer **I'll use my own** during setup. The Review buttons then tell the agent to run that skill. Your skills folder is left untouched. Your skill must record the verdict back to Argus. See [Recording a review verdict](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#recording-a-review-verdict).

## First-run setup

Enter your Azure DevOps org URL, org slug, and project, and choose a sign-in method (Azure CLI, or Windows account on Windows). Then choose where to keep your history, and select **Start watching**.

Setup starts a poll immediately. The empty board shows loading feedback while
Argus checks Azure DevOps, then displays the results.

- **This device** (default): the database is `%LOCALAPPDATA%\argus\argus.db`. Your PR data stays private. A device reset loses the history.
- **OneDrive**: the database is `<OneDrive>\Desktop\argus.db`. OneDrive syncs it, so you can restore your history after a device reset. The PR titles, descriptions, and review history sync to your OneDrive. Run Argus on one device at a time.

If you choose OneDrive, reload extensions to start using it. See [Where the database lives](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#where-the-database-lives) for more detail.

If you choose Windows account, the sign-in screen provides separate **Application
(client) ID** and **Directory (tenant) ID** fields. Enter both IDs from your Entra
app registration, then select **Save setup**. You can edit them there or under
**Settings > Windows account setup**. Saving setup saves only the IDs, not your
sign-in method. See the [sign-in guide](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#sign-in-method)
for the saved auth-config location and explicit environment overrides.

`ado-auth-config.example.json` contains only the empty registration structure.
Configure actual IDs through the canvas. These sign-in files are separate from
the removed optional Argus config file.

## Verify the installation

1. The Argus canvas opens and shows the setup screen, or the board if already set up.
2. After setup, the first poll starts automatically and fills the board. To check again later, select **Refresh** beside the search box. It runs the same check as the background poll.
3. With the skill installed, select **Review** on a PR. A child review session starts and records a verdict.

## Upgrade

For a plugin install, refresh the marketplace catalog and update the plugin:

```powershell
copilot plugin marketplace update argus
copilot plugin update argus@argus
```

Then reload extensions or restart the session. Plugin installs do not use the ZIP
updater or personal-skill sync. The **Check for new versions** setting and bell
update actions apply to ZIP installs only. The plugin manager updates the bundled
skill; it does not change a personal or project skill that takes precedence.

### ZIP upgrades

Once a day, Argus checks GitHub for a new release. When one exists, the bell shows a notice. Select **Update now**. Argus downloads the ZIP, checks it against the SHA-256 file of the release, and runs `install.ps1`. If the checksum does not match, Argus installs nothing and shows an error. Then reload extensions. If you edited your `pr-review` skill, a **Merge with Copilot** notice appears after the reload. To stop the check, clear **Check for new versions** in Settings. Argus sends no data about you.

To upgrade by hand, extract the new ZIP and run `install.ps1` from it with the same command as the install. To check the ZIP first, compare `(Get-FileHash <zip>).Hash` with the hash in the `.sha256` file on the release page. Your database is not in the ZIP. Then reload extensions.

An unedited `pr-review` skill that Argus installed updates by itself. If you edited it, Argus leaves it and shows a notice with **Merge with Copilot** and **Use new version**. **Use new version** replaces your copy with the bundled one and saves your old copy in `~/.copilot/skill-backups/`.

If your database is still on OneDrive from an earlier version, Argus keeps using it and shows a notice with **Choose with Copilot**. Choose to move it to `%LOCALAPPDATA%\argus\argus.db`, or to keep it on OneDrive as a backup. The notice clears after you choose and reload extensions. Argus never moves the file without your approval.

## Uninstall

For a plugin install, run `copilot plugin uninstall argus@argus`, then reload
extensions or restart the session. Your external database, database-location
choice, and Windows sign-in files are not part of the plugin payload and remain.

For a ZIP install:

Delete `%USERPROFILE%\.copilot\extensions\argus`. Your database is not in that folder in a current install, so it stays where it was: `%LOCALAPPDATA%\argus\argus.db`, the OneDrive file, or the path in `ARGUS_DB_FILE`. An install from an earlier version that never used OneDrive can still keep its database in `data\argus.db` in the extension folder. Move it out first if you want to keep your history. Delete the database too if you want to remove your stored history. Delete `%LOCALAPPDATA%\argus\storage.json` as well to forget your location choice.
