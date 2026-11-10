# How to add a chart

Charts show data from `/api/insights` (`computeInsights` in `server/db.ts`).

1. Compute the data in the store. Add a field to the `Insights` type in `server/types.ts` and fill it in `computeInsights`. Derive it from `pr_events` when you can. Read `prs` snapshot columns only when the event timeline does not hold the value. Do not store a new copy of data that already exists.
2. Add the matching type to `src/lib/api.ts`.
3. Add a component to `src/components/Charts.tsx`. Use Mantine Charts for supported chart types. Keep direct Recharts for custom layouts that Mantine cannot preserve, such as the streamgraph and treemap. Use theme tokens for chart text, surfaces, and grid lines. Keep meaningful series colors distinct from the user-selected accent.
4. Render it in `src/routes/insights.tsx` (or `recap.tsx`).
5. Test the calculation in `server/db.test.ts`. Do not test Recharts itself.
