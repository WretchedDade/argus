# Argus architecture

This document shows how the parts of Argus connect. It also shows where the data lives and how to add a route, a column, or a chart.

## Overview

Argus is one Node process with three jobs:

- A **poller** reads pull requests (PRs) from Azure DevOps (ADO).
- A **store** keeps them in a SQLite database.
- An **HTTP server** serves a React client and a JSON API.

Two entry points start the same parts:

| Entry point            | Used for                          | Database default                                  |
| ---------------------- | --------------------------------- | ------------------------------------------------- |
| `server/extension.ts`  | The Copilot app (canvas)          | See [Where the data lives](#where-the-data-lives) |
| `server/standalone.ts` | A normal browser, to try a branch | `data/standalone.db` in the repo                  |

```mermaid
flowchart LR
    subgraph Host["Node process"]
        EXT["extension.ts or standalone.ts<br/>(startup, wiring)"]
        POLL["Poller<br/>server/ado/poller.ts"]
        STORE[("ArgusStore<br/>server/db.ts<br/>SQLite")]
        API["API<br/>server/api.ts"]
        HTTP["HTTP server<br/>server/server.ts<br/>+ static.ts"]
    end
    ADO["Azure DevOps"]
    CLIENT["React client<br/>src/ (dist/)"]
    SESSION["Copilot session<br/>(review verdicts)"]

    EXT --> POLL
    EXT --> HTTP
    POLL -- "ado-client, az CLI" --> ADO
    POLL -- "upsert, events" --> STORE
    HTTP --> API
    API -- "read, user actions" --> STORE
    CLIENT -- "fetch /api/*" --> HTTP
    SESSION -- "POST /api/pr/record-review" --> HTTP
```

## Startup

`extension.ts` runs these steps when the Copilot app loads it:

1. Resolve the database file (`server/storage.ts`) and copy the old file if the user changed the location.
2. Open `ArgusStore`. The constructor creates the schema.
3. Build `getConfig()`. It merges the defaults, `argus.config.json`, and the overrides saved in the store.
4. Build a `PollerContext` (`{ store, getConfig }`). The poller does not start yet.
5. Register the canvas. Each open canvas instance starts its own HTTP server on a stable loopback port. All instances share the one store and poller. The **first canvas to open** starts the poller. When the **last canvas closes**, the poller stops. A host with no open canvas does not poll ADO.
6. Start the **ingest server** on a fixed port. Exactly one host owns it (the first to bind). It lets a review session record a verdict with plain HTTP.

`standalone.ts` does the same, but it starts the poller at startup. It runs without the Copilot app. Features that need a Copilot session (Review, re-review, archive) fail with a clear message.

## Poller

`server/ado/poller.ts` runs on a clock-aligned schedule during work hours (`scheduleNext`). Each run:

- reads PRs from ADO through `packages/ado-client` and the `az` CLI helpers in `server/ado/`;
- normalizes them (`normalize.ts`);
- reconciles the result with the store (`reconcile.ts`), which writes `prs` rows and appends `pr_events`;
- records the run in `poll_runs`.

Each tick catches its own errors, so one failed run does not stop the schedule. The poller does not change user choices such as lane, scope, or dismissal. It can clear a snooze: the store clears an expired snooze, and an FTE approval wakes an "until FTE approves" snooze.

## Store

`ArgusStore` in `server/db.ts` uses `node:sqlite` in WAL mode. There are two data models:

- `prs` holds the **current snapshot** of each PR.
- `pr_events` is the **append-only timeline**. Most metrics are derived from it.

Some metrics also read `prs` snapshot columns. For example, review latency uses `prs.reviewed_at` and `prs.reviewed_sha_authored_at`, and the backlog and authored-PR summaries use snapshot rows.

Other tables: `poll_runs`, `activity_log`, `settings` (key/value, holds the saved config overrides), and `changes_read`.

User-managed columns live on `prs`. Only the dedicated action methods write them. `upsertPr` never does.

The schema is a `CREATE TABLE IF NOT EXISTS` script (`SCHEMA`). There is no migration framework. New columns on an existing table use `#ensureColumn`.

## API

`server/api.ts` exports `handleApi`. It is one function that matches `url.pathname` against `/api/...` strings and returns `true` when it handled the request. `server/server.ts` calls it first, and serves the static client (`static.ts`) when it returns `false`.

Rules in the file:

- Reads use `GET`. Actions that change data use `POST`.
- Responses use `sendJson`. Do not write to `res` directly.
- The API reaches the host through `ApiContext` (store, `getConfig`, poller functions). It imports one function directly from the poller: `resetIdentity`, which it calls after a sign-in change.

## Client

The client is a single-page app in `src/`:

- `src/main.tsx` creates the TanStack Router and the TanStack Query client.
- `src/routes/` holds one file per route. Vite generates `src/routeTree.gen.ts` from it. Do not edit or commit that file.
- `src/lib/api.ts` holds the response types, the `api` fetch helpers, and the `queryOptions` for each endpoint.
- `src/components/` holds shared components. Charts are in `Charts.tsx`.

There is no dev server. `npm run dev` runs a watch build, and you reload the canvas to see client changes. A server change needs a reload of extensions (or a restart of the Copilot app).

## Where the data lives

| Data                | Location                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Database            | Chosen in this order: `ARGUS_DB_FILE`, the saved choice, an older existing file, then `%LOCALAPPDATA%\argus\argus.db`    |
| Storage choice      | `%LOCALAPPDATA%\argus\storage.json` (beside the local database, because Argus must read it before it opens the database) |
| Local config        | `argus.config.json` in the extension folder, or the file in `ARGUS_CONFIG_FILE`                                          |
| Saved settings      | The `settings` table in the database. They override `argus.config.json`.                                                 |
| Standalone database | `data/standalone.db` (ignored by Git)                                                                                    |

The logic is in `server/storage.ts` and `server/config.ts`. See the README section "Where the database lives" for the user view.

## How to add a route (page)

1. Create `src/routes/<name>.tsx`. Export `Route = createFileRoute("/<name>")({ component })`.
2. Run `npm run build:client` (or `npm run dev`). Vite regenerates `src/routeTree.gen.ts`.
3. To add it to the navigation, edit `tabs` or `menuTabs` in `src/routes/__root.tsx`.
4. Fetch data with a `queryOptions` from `src/lib/api.ts` (see the next section for a new endpoint).

## How to add an API endpoint

1. In `server/api.ts`, add an `if (route === "/api/<name>")` block inside `handleApi`. Call a store method and reply with `sendJson`.
2. In `src/lib/api.ts`, add the response type, an entry in `api`, and a `queryOptions`.
3. Add a test next to the code that you changed (see [CONTRIBUTING.md](../CONTRIBUTING.md#test)).

## How to add a column

1. Add the column to the `CREATE TABLE` statement in `SCHEMA` in `server/db.ts`. This covers new databases.
2. Add `this.#ensureColumn("<table>", "<column>", "<TYPE>")` in the constructor, after the `SCHEMA` call. This covers existing databases. Use a nullable column or a `DEFAULT`, because old rows have no value.
3. Update the row type and the `rowTo...` mapper (for example `rowToPr`) and the shared type in `server/types.ts`.
4. Write the column from one place. Poller data goes through `upsertPr`. User-managed data goes through a dedicated action method.
5. Add a test in `server/db.test.ts`. It must open an old-schema database and check that the column is added.

Argus has no down-migration. A column change must be safe for a user who upgrades and keeps their history.

## How to add a chart

Charts show data from `/api/insights` (`computeInsights` in `server/db.ts`).

1. Compute the data in the store. Add a field to the `Insights` type in `server/types.ts` and fill it in `computeInsights`. Derive it from `pr_events` when you can. Read `prs` snapshot columns only when the event timeline does not hold the value. Do not store a new copy of data that already exists.
2. Add the matching type to `src/lib/api.ts`.
3. Add a component to `src/components/Charts.tsx`. The file uses Recharts.
4. Render it in `src/routes/insights.tsx` (or `recap.tsx`).
5. Test the calculation in `server/db.test.ts`. Do not test Recharts itself.
