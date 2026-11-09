# How to add an API endpoint

1. Add the route to its domain in `server/routes/`. Use `ApiContext` to reach the store and host. Reply with `context.json`. Register a new domain in `server/app.ts`. During migration, add the path to `isHonoRoute` so `handleApi` sends it to Hono.
2. In `src/lib/api.ts`, call the route with `hc<AppType>` from `hono/client`. Add an entry in `api` and a `queryOptions` (reads only). When the type is in `shared/schemas/`, parse the response with its schema. See [shared schemas](../patterns/shared-schemas.md).
3. Add a test next to the code that you changed (see [CONTRIBUTING.md](../../CONTRIBUTING.md#test)).
