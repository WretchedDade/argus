# How to add an API endpoint

1. Add the route to its domain in `server/routes/`. Use `ApiContext` to reach the store and host. Reply with `context.json`. Use the mounts in `server/app.ts` to find domains or register a new domain. Both HTTP servers send all requests to Hono.
2. Define a Zod schema for each request input. Use `queryParams(schema)` from `server/validation.ts` for query parameters. Use `...jsonBody(schema)` for legacy actions that accept an empty body as `{}`. Use `zValidator("json", schema)` when a JSON body is required. Read checked values with `context.req.valid`. Do not assert an input type without a runtime check. Throw `HTTPException` for an expected HTTP error. The app handles unexpected errors.
3. In `src/lib/api.ts`, call the route with `hc<AppType>` from `hono/client`. Add an entry in `api` and a `queryOptions` (reads only). When the type is in `shared/schemas/`, parse the response with its schema. See [shared schemas](../patterns/shared-schemas.md).
4. Add a test next to the code that you changed (see [CONTRIBUTING.md](../../CONTRIBUTING.md#test)). Cover invalid input and confirm that it does not change data.
