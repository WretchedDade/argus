# How to add an API endpoint

1. Add the route to its domain module in `server/routes/`. Call a store method and reply with `c.json`. Mount a new domain in `server/app.ts` and add its paths to `isHonoRoute` while the legacy handler remains. Use the mounts in `server/app.ts` to find migrated domains. Routes that have not moved to Hono remain in `server/api.ts`.
2. In `src/lib/api.ts`, add the response type, an entry in `api`, and a `queryOptions` (reads only). Use the typed Hono client for migrated routes. When the type is in `shared/schemas/`, parse the response with its schema. See [shared schemas](../patterns/shared-schemas.md).
3. Add a test next to the code that you changed (see [CONTRIBUTING.md](../../CONTRIBUTING.md#test)).
