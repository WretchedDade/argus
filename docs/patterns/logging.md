# Server logging

Use `logger` from `server/log.ts` for server diagnostics. It uses Pino to write
one JSON record per line to stderr from startup. After the Copilot session
connects, it also sends the same records to the session log. If session delivery
fails, stderr stays available and gets one warning if the selected level allows it.
Tests and build scripts can keep their own console output. ESLint rejects console
calls in server code.

The default level is `info`. Set `ARGUS_LOG_LEVEL` before starting Argus:

```powershell
$env:ARGUS_LOG_LEVEL = "debug"
npm run standalone
```

In the Copilot app, set the variable in the environment that starts the extension
host, then restart that host. Supported values are `trace`, `debug`, `info`,
`warn`, `error`, `fatal`, and `silent`. An invalid value emits a warning and uses
`info`. Logs stay local. Argus does not add a log file or send logs to a service.

## Levels and context

- `debug`: poll phases, individual enrichment failures, HTTP request completions,
  update checks, and update progress.
- `info`: startup, shutdown, poll summaries, and completed app updates.
- `warn`: partial enrichment, invalid config, and recoverable failures.
- `error`: failed polls, HTTP server errors, and failed app updates.

Use a child logger for shared context. Keep messages fixed. Put counts, duration,
and operation names in fields:

```ts
const log = logger.child({ component: "poller", runId });
log.info({ added, updated, durationMs }, "Poll completed");
```

Each poll emits one completion summary. Partial enrichment adds one warning with
failure counts by operation. HTTP diagnostics include a generated request ID,
method, route pattern, status, and duration. Successful requests emit only at
`debug`. The response includes `X-Request-Id`. Route patterns do not include
query values or path parameter values.

Log a failure where it is handled. Do not log the same failure in each layer.
Expected absence and normal fallbacks are not errors. Repeated lease-renewal
failures emit one warning until renewal recovers.

## Safe data

Do not log tokens, PR titles, descriptions, comments, prompts, request bodies,
headers, raw ADO responses, or CLI output. Use operation names, counts, and local
run or request IDs. Redaction removes common sensitive fields as a backstop.
It cannot remove sensitive text embedded in arbitrary message strings.

Pass errors under `err`. The serializer keeps the error type, a safe error code,
an HTTP status when present, and stack frames. It omits the message, cause, and other properties because
upstream errors can contain private text. Add known-safe context at the call
site when the type and stack are not enough.

## Activity history

`activity_log` and `poll_runs` are separate from diagnostics. They feed the
activity and poll-run views. Keep their detailed records at every diagnostic
level, including `silent`. Do not mirror arbitrary activity messages or data to
Pino. Do not store all Pino records in SQLite.

Pino stays external to the server bundle. The release includes it in
`extension/node_modules` with the other runtime packages. Do not add a
worker-based transport or an in-process pretty printer without checking release
packaging.
