# How to add an API endpoint

1. In `server/api.ts`, add an `if (route === "/api/<name>")` block inside `handleApi`. Call a store method and reply with `sendJson`.
2. In `src/lib/api.ts`, add the response type, an entry in `api`, and a `queryOptions` (reads only). When the type is in `shared/schemas/`, parse the response with its schema. See [shared schemas](../patterns/shared-schemas.md).
3. Add a test next to the code that you changed (see [CONTRIBUTING.md](../../CONTRIBUTING.md#test)).
