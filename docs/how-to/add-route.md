# How to add a route (page)

1. Create `src/routes/<name>.tsx`. Export `Route = createFileRoute("/<name>")({ component })`.
2. Run `npm run build:client` (or `npm run dev`). Vite regenerates `src/routeTree.gen.ts`. Do not edit or commit that file.
3. To add it to the navigation, edit `tabs` or `menuTabs` in `src/routes/__root.tsx`.
4. Fetch data with a `queryOptions` from `src/lib/api.ts`. For a new endpoint, see [how to add an API endpoint](add-api-endpoint.md).
