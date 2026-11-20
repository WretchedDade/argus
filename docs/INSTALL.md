# Install and upgrade Argus

Install Argus as a Copilot plugin. No source checkout or build tools are needed. The plugin manager installs Argus and its bundled review skill.

## Supported platform

Windows x64 is tested. The payload is built on Windows and its `node_modules` include native Windows binaries, which only the Windows account sign-in method loads. The Azure CLI sign-in method uses no native code, so it may work on other platforms, but this is not tested or supported.

## Prerequisites

- The Copilot app, with plugins and canvas extensions enabled.
- Node.js 22.13 or later on your PATH. The Copilot app runs `extension.mjs` with it.
- Azure CLI (`az`) signed in with `az login`, or the [Windows account sign-in setup](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#sign-in-method).
- Access to the Azure DevOps organization and project you want to track.

## Install the plugin

Add the marketplace `WretchedDade/argus#plugin` in the Copilot app, then install `argus@argus`. You can also use the CLI:

```powershell
copilot plugin marketplace add "WretchedDade/argus#plugin"
copilot plugin install argus@argus
```

Reload extensions in the Copilot app, or restart the session, then open the **Argus** canvas. Plugin installation does not run npm or build from source.

## The pr-review skill (optional)

The board, My PRs, Insights, and Recap work without the skill. The **Review** and **Re-review** buttons need a `pr-review` skill.

The plugin includes the skill. There is no separate skill installation step. Personal and project skills take precedence over the plugin skill. To use the bundled baseline, move any existing `pr-review` copy to a backup location outside your skills directories, then start a new session. Keep the backup if it contains custom rules.

You can also bring your own skill. In Settings, set **Review skill** to the `name` from your skill's frontmatter. The Review buttons then tell the agent to run that skill. Your skills folder is left untouched. Your skill must record the verdict back to Argus. See [Recording a review verdict](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#recording-a-review-verdict).

## First-run setup

Enter your Azure DevOps org URL, org slug, and project, and choose a sign-in method (Azure CLI, or Windows account on Windows). Then choose where to keep your history, and select **Start watching**.

Setup starts a poll immediately. The empty board shows loading feedback while Argus checks Azure DevOps, then displays the results.

- **This device** (default): the database is `%LOCALAPPDATA%\argus\argus.db`. Your PR data stays private. A device reset loses the history.
- **OneDrive**: the database is `<OneDrive>\Desktop\argus.db`. OneDrive syncs it, so you can restore your history after a device reset. The PR titles, descriptions, and review history sync to your OneDrive. Run Argus on one device at a time.

If you choose OneDrive, reload extensions to start using it. See [Where the database lives](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#where-the-database-lives) for more detail.

If you choose Windows account, the sign-in screen provides separate **Application (client) ID** and **Directory (tenant) ID** fields. Enter both IDs from your Entra app registration, then select **Save setup**. You can edit them there or under **Settings > Windows account setup**. Saving setup saves only the IDs, not your sign-in method. See the [sign-in guide](https://github.com/WretchedDade/argus/blob/main/docs/USER-GUIDE.md#sign-in-method) for the saved auth-config location and explicit environment overrides.

`ado-auth-config.example.json` contains only the empty registration structure. Configure actual IDs through the canvas. These sign-in files are separate from the removed optional Argus config file.

## Verify the installation

1. The Argus canvas opens and shows the setup screen, or the board if already set up.
2. After setup, the first poll starts automatically and fills the board. To check again later, select **Refresh** beside the search box. It runs the same check as the background poll.
3. With the skill installed, select **Review** on a PR. A child review session starts and records a verdict.

## Upgrade

Use your plugin manager to update Argus. With the CLI, refresh the marketplace catalog and update the plugin:

```powershell
copilot plugin marketplace update argus
copilot plugin update argus@argus
```

Then reload extensions or restart the session. The plugin manager updates Argus and its bundled skill together. It does not change a personal or project skill that takes precedence.

Argus checks the latest successfully published plugin version once a day while a canvas is open. When a newer version is available, the bell and **Settings > System** show your installed version, the available version, and plugin-manager instructions. Select **Check for updates** in Settings to check now. The result and update instructions stay on that page. Turn off **Check for new versions** to stop these checks.

The notice checks the published plugin payload, not the latest ZIP release. A separate marketplace listing can take longer to update. If your plugin manager does not list the new version yet, check again after its catalog updates. Argus does not install plugin updates or replace plugin files. Automatic updates depend on the plugin manager and its settings.

## Uninstall

Remove Argus through your plugin manager, or run:

```powershell
copilot plugin uninstall argus@argus
```

Then reload extensions or restart the session. Your external database, database-location choice, and Windows sign-in files remain. To remove your history as well, close Argus and delete the database at your configured location. Delete `%LOCALAPPDATA%\argus\storage.json` to forget your location choice.

## Switch from a ZIP install

Do not enable the old extension and the plugin at the same time.

1. In the old install, save any values from `argus.config.json` through Settings. The plugin no longer reads that file or `ARGUS_CONFIG_FILE`.
2. Select **This device** or **OneDrive** in Settings, then reload extensions. Confirm that your history is present. This moves an old extension-local database out of the installation folder when needed.
3. Close Argus in all Copilot sessions. Back up your database. Move `%USERPROFILE%\.copilot\extensions\argus` to a backup location outside `extensions`, then reload extensions or restart the app.
4. [Install the plugin](#install-the-plugin). Confirm that your history and Settings are present before removing any backup.

Database settings and Windows sign-in files stay in their existing locations. An old personal `pr-review` skill still takes precedence. See [The pr-review skill](#the-pr-review-skill-optional) to use the bundled skill.

## ZIP fallback

Use the [release ZIP](https://github.com/WretchedDade/argus/releases/latest) only if you cannot use plugins. It contains the same verified runtime.

<details>
<summary>ZIP installation, upgrades, and removal</summary>

### ZIP layout

```text
argus-vX.Y.Z/
  INSTALL.md
  install.ps1
  LICENSE
  THIRD-PARTY-NOTICES
  release-manifest.json
  extension/
    extension.mjs
    dist/
    node_modules/
    package.json
    package-lock.json
    ado-auth-config.example.json
    skills/pr-review/
```

### Install the extension

1. Download the ZIP and its `.zip.sha256` file. Compare the published hash with `(Get-FileHash .\argus-vX.Y.Z-windows.zip -Algorithm SHA256).Hash`.
2. Extract the ZIP. From the extracted `argus-vX.Y.Z` folder, run:

    ```powershell
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
    ```

    This copies `extension` to `%USERPROFILE%\.copilot\extensions\argus`. `-ExecutionPolicy Bypass` applies to this command only. To use another folder, pass `-Destination <path>`. The installer preserves user files and replaces `node_modules` so removed packages do not remain.

3. Reload extensions or restart the Copilot app, then open Argus.
4. Complete setup. You can install the baseline review skill, keep an existing skill, or select **I'll use my own**.

### ZIP upgrades

Argus checks for releases daily. Select **Update now** in the bell notice to download the ZIP, verify its SHA-256, and run the installer. A checksum mismatch stops installation and shows an error. Then reload extensions. Clear **Check for new versions** in Settings to disable the check. These controls are not available in plugin installs.

To upgrade manually, verify and extract the new ZIP, then run `install.ps1` and reload extensions. Save any file-only configuration through Settings in the old version first. `argus.config.json` and `ARGUS_CONFIG_FILE` are no longer read.

Argus updates an unedited baseline skill that it installed. If you edited it, Argus leaves it and shows **Merge with Copilot** and **Use new version**. **Use new version** backs up your copy in `~/.copilot/skill-backups/` before replacing it. A skill copied by hand has no update tracking.

### Remove the ZIP extension

Close Argus and delete `%USERPROFILE%\.copilot\extensions\argus`. First move any old `data\argus.db` out of that folder if you want to keep it. Current installs keep the database outside the extension folder. External data and personal skills remain after removal.

</details>
