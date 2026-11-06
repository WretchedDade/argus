# How to change the schema

1. Add a new entry at the end of `migrations` in `server/store/migrations.ts`. Its `up(db)` runs plain SQL (for example `db.exec("ALTER TABLE prs ADD COLUMN foo TEXT")`). Never edit or reorder an entry that is released.
2. Use a nullable column or a `DEFAULT`, because old rows have no value.
3. Update the row type and the `rowTo...` mapper (for example `rowToPr`) and the shared type in `server/types.ts`. For `Pr`, the type is in `shared/schemas/pr.ts`.
4. Write the column from one place. Poller data goes through `upsertPr`. User-managed data goes through a dedicated action method.
5. Add a test in `server/store/migrations.test.ts` or `server/db.test.ts`. It must open a database at the old version and check the result.

Argus has no down-migration. A column change must be safe for a user who upgrades and keeps their history.
