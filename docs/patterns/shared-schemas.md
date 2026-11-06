# Shared schemas

`shared/schemas/` holds zod schemas and the types inferred from them. The server and the client both use these types, so the two builds cannot drift. Use one file for each domain, for example `pr.ts`.

## Rules

- Import with the `#shared/*` alias, for example `#shared/schemas/pr`. The alias is the `imports` field in `package.json`. Node, tsc, Vite, and esbuild all resolve it.
- Import from the domain file. Do not add a barrel `index.ts`.
- Put each test next to its schema, in `shared/schemas/<domain>.test.ts`. `npm test` finds it by glob.
- `server/types.ts` and `src/lib/api.ts` re-export the shared types, so existing imports keep working.
- Parse every API response with its schema in the `api` helper. Do not cast it.

## How to move a type to the shared layer

1. Define the schema in `shared/schemas/<domain>.ts`. Export the inferred type with `z.infer`.
2. Delete the hand-written copies. Re-export the type from `server/types.ts` and `src/lib/api.ts`.
3. Parse the response in the `api` helper, for example `PrsResponseSchema.parse(await getJson("/api/prs"))`.
4. Add a test that accepts a valid value and rejects an invalid one.

## Status

`Pr` and its enums use this pattern. Other types still have two copies.
