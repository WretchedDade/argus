# Plugin feasibility: interim findings

Status: **hold on plugin/daemon implementation**, not a rejection of plugin
support. This is a partial milestone for [#15](https://github.com/WretchedDade/argus/issues/15),
following its [approved alignment](https://github.com/WretchedDade/argus/issues/15#issuecomment-6509097777).
Agency catalog eligibility and publication remain separately owned by
[#14](https://github.com/WretchedDade/argus/issues/14#issuecomment-6509097748).
Neither issue is complete and no install, marketplace, artifact branch, release,
or default-branch change is authorized by these findings.

## Evidence collected on 2026-11-02

- Read the installed Agency app-extension and plugin-authoring documentation,
  actual installed manifest examples, and `agency --help` /
  `agency copilot --help`. Documentation describes app canvas delivery through
  plugins. An installed legacy manifest uses a string `extensions` directory.
  That is useful format evidence, not a demonstration that Argus loads.
- Agency reports `2026.10.29.2`, commit `1c27132e`, target
  `x86_64-windows`. Process inventory supplied by the coordinator identified
  GitHub Copilot product `1.1.34`, runtime
  `1.0.102-0.unstable.r40949665530.gab1eef5`, and CLI processes at that version
  and `1.0.86`. These are **inventory, not attribution of the plugin-loading
  host**. Do not confuse the unrelated Microsoft Copilot product with this app.
  A serving-app version API result was not available.
- The installed CLI help offers session-local `--plugin-dir`; Agency also offers
  `--plugin local:...`. Neither documents a one-session **desktop canvas**
  mount in the evidence inspected. The app documentation routes through
  installation/settings. No runtime experiment was performed: persistent plugin
  installs, settings changes and auth prompts are not authorized.
- Read the public [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
  and [Agent Plugins 1.0 specification](https://agent-plugins.org/specification).
  These are live documentation, not proof of implementation by the installed
  desktop/runtime versions.

### Manifest and launch contracts

| Contract            | Verified documentation/example                                                                                                             | Still unproven for Argus                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy `extensions` | Directory string/array, or paths object in CLI reference; actual installed legacy directory example                                        | Minimal Argus canvas loaded in standard and Agency-backed app, correct injected SDK/API                                                     |
| Agent Plugins       | Canonical `$schema` selects semantics; root placement alone does not. `extensions` is a reverse-domain namespaced object, not legacy paths | A supported desktop canvas namespace/layout; do not invent one                                                                              |
| MCP                 | Legacy `.mcp.json`/manifest field versus Agent Plugins root `mcp.json` with matching schema                                                | Installed app/Agency launch behavior and daemon connection lifecycle                                                                        |
| Data and cwd        | CLI Agent Plugins stdio MCP documents `PLUGIN_ROOT`, persistent `PLUGIN_DATA`, interpolation in args/env/cwd                               | Extension process environment, shared standard/Agency profile mapping and writable lifetime; no assumption that MCP data reaches extensions |
| Skills              | Agent Plugins fixed `skills/*/SKILL.md`; legacy configurable paths; CLI precedence/dedup rules                                             | Namespaced review prompts, edited/BYO skills and coexistence in both app modes                                                              |
| Acquisition refs    | CLI marketplace GitHub/URL source objects document `ref`, `path` and exact 40-character `sha`                                              | Same-repository built-ref acquisition on installed app versions and Agency distribution eligibility                                         |

The documented GitHub source format can name this same repository with a branch,
tag or immutable SHA; relative paths select a directory in the catalog checkout,
not a different build ref. Actual fetch/install/update was not exercised. Catalog
refresh, plugin update, client restart and live-daemon replacement are distinct
operations; no uniform automatic-update promise is justified.

## All four build-output options

| Option                                      | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                               | Decision                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Dedicated built `plugin` branch             | Existing release staging already produces the bundle, assets, skill and production dependencies. Can reuse one staged runtime for ZIP and plugin wrapper. Source commit, lock digest, file checksums and dependency inventory are now recorded. Documented ref/SHA selection is promising, not an installed-app test. Branch history/update policy and immutable artifact identity still need agreement; force-push is not required by these findings. | **Preferred proposal only**, conditional on app/data/acquisition gates and explicit authorization |
| Dev branch plus installable `main`          | Changes PR destinations/default-branch meaning and mixes generated runtime with release automation. Current upstream publishes when a new package version reaches `main`, preserves generated PR-title notes and creates its tag only after checks. Old tag-only workflow assumptions are obsolete.                                                                                                                                                    | No workflow change authorized                                                                     |
| Commit built/native output to source `main` | Simple acquisition but large generated/native diffs and repository history growth; ignored assets/dependencies are currently deliberately absent from source.                                                                                                                                                                                                                                                                                          | Not preferred                                                                                     |
| Build on first load                         | Raw source lacks `extension.mjs`, `dist` and installed external packages. Would require network/npm/build tooling and successful native acquisition at startup.                                                                                                                                                                                                                                                                                        | Not reliable for supported installation                                                           |

There is **no final build-output selection**. No artifact branch/tag/release or
marketplace manifest was created. Keep source `main` source-only and retain ZIP
fallback until a verified path is selected.

## Independent packaging milestone

Integrated upstream `7875201` (including #13's workspace-link removal, #25's
version-driven release flow and #88's config/command validation), preserving the
two-field registration milestone and the upstream command tests.
Upstream already moved the package from 0.1.0 to **0.5.0**; no additional version
bump was chosen here. PR/version choice remains pending.

- Staging can target an external output root and deletes only its exact
  versioned stage. Production install still uses the source lockfile; there is
  no first-load build or dependency download in the acquired payload.
- `release-manifest.json` records source SHA/dirty flag, package version,
  Node/platform/architecture, source lock digest, installed dependency metadata
  and SHA-256 payload inventory. Original dependency licenses/notices stay in
  their packages. The release workflow generates a separate ZIP digest.
  This is provenance evidence, not a signature, license approval or bit-for-bit
  reproducibility claim. Dirty local builds explicitly say they are dirty.
- A read-only acquired-payload verifier checks checksums and required files,
  rejects links/writable user-state files, checks bundle syntax and imports
  external Azure dependencies from the acquired directory with no `NODE_PATH`.
  It checks native MSAL `StartupError`, because that package can silently export
  a fallback stub when native loading fails. Successful imports alone were
  insufficient. No account discovery or authentication API is called.
- Ship only an empty registration **example**. Do not initialize a real plugin
  auth-config path before persistent-data semantics are proven.
- Tests cover scoped replacement, unsafe version/path rejection, inventory and
  dependency metadata, repeat verification, tampering/extra files, writable
  registration rejection and link rejection.

An external Windows x64 stage was acquired using Node **26.13.0** and its own
`npm ci --omit=dev` production tree, not the checkout's developer dependencies.
Azure imports, native MSAL loading and bundle syntax passed without an app or
sign-in. The final clean-source stage records commit
`69ce400f1579fee4608cdd92768fb51d7c3bbc9b`, `sourceDirty: false`,
31,902 hashed files and 280 installed dependency entries. This does not certify
the minimum supported Node version or hosted CI;
the release workflow retains Node 22. The SDK is host-injected, so the extension
itself was not started outside the host.

The final stage was compressed and extracted to a fresh directory outside the
repository with PowerShell `Compress-Archive` / `Expand-Archive`, then verified:
all 31,902 payload hashes, Azure imports, native loading and entry-point syntax
passed. Compression took 517 seconds; compression plus extraction took 665
seconds on this machine. The local, unpublished ZIP's SHA-256 is
`25bd73f5fefa558b1d4c82806484ea9494fba2125bfd99ba37ba11cca429960c`.
It identifies this local evidence artifact, **not** a published release or plugin
ref. It retains the developer staging root name `argus-0.5.0`; the release
workflow renames that root to `argus-v0.5.0` before archiving. File checksums are
relative to that root and unaffected by the rename.

After integrating #88's manifest/lock changes, root `npm ci`, the full test suite,
typecheck, formatting check and build passed; packaging scripts also passed a
separate TypeScript check (they are outside the root tsconfig's includes).
The install reported **7 dependency advisories (1 moderate, 6 high)**.
A follow-up `npm audit` was blocked by the configured feed's HTTP 429 response;
no clean audit or dependency-security approval is claimed. No automatic
dependency fixes or install-script approvals were applied. Existing build
chunk-size and npm native-install-script/deprecation warnings remain.

## Data, skills and runtime boundaries

Current code is still the existing extension runtime, not a shared daemon:

- DB: `ARGUS_DB_FILE`, else OneDrive Desktop `argus.db`, else extension-local
  `data/argus.db`. Config: extension-local `argus.config.json` plus stored
  Settings overrides. Standalone previews keep their separate path/profile.
- Registration: `DEVSTART_ADO_CONFIG_PATH`, otherwise existing per-user shared
  auth-config path; explicit client/tenant environment overrides still win.
  The new fields save IDs jointly and do not change provider selection.
- Preserve `skill-sync.ts`, customized/BYO skills, install/merge notices,
  updater and ZIP update notices until plugin discovery/update responsibilities
  are demonstrably replaced. No duplicate-poller coexistence claim is made.

Before any data transition: inventory source/destination, back up SQLite safely,
detect conflicting histories/config, choose explicitly rather than overwrite,
and define rollback. Registration IDs must **not** be auto-imported from legacy
values. Never put populated IDs/account data in evidence or artifacts.

## Next authorized gate and consequences

Obtain separate authorization for a minimal local-plugin **desktop** load using
a documented host mechanism, recording the exact serving app/engine versions
in standard and Agency-backed modes. Confirm extension API, skill discovery,
MCP launch/env/cwd, writable data and host/session-qualified callbacks. If the
only supported mechanism requires install/settings, pause for authorization,
not an undocumented alternative.

Until that succeeds, **no-go for implementing or claiming** the shared daemon,
portable core migration, plugin persistent storage or replaced update/skill
flows. Native loading does not prove user-operated WAM login/window association
in a daemon topology. Full workflow parity, authenticated IPC, explicit
start/stop, half-hour polling with clients closed, origin-qualified dispatch,
cache replacement/data rollback and Windows sign-in remain unverified. #14
must separately resolve ownership/governance/hosting/native-payload eligibility.
