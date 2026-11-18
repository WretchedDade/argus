# How to add a chart

Charts show data from `/api/insights` (`computeInsights` in `server/db.ts`).

1. Compute the data in the store. Add a field to the `Insights` type in `server/types.ts` and fill it in `computeInsights`. Derive it from `pr_events` when you can. Read `prs` snapshot columns only when the event timeline does not hold the value. Do not store a new copy of data that already exists.
2. Add the matching type to `src/lib/api.ts`.
3. Add a component in `src/components/charts/<ChartName>.tsx`. Keep chart-specific helpers in that file. Extract helpers or constants only when multiple charts use them. Keep shared component defaults in `src/theme.ts`. Use Mantine Charts. The current components use `CompositeChart`, `BarChart`, `DonutChart`, `ScatterChart`, `Treemap`, `WaffleChart`, and `Heatmap`. Load context bands use Recharts `ReferenceArea` and `Label` inside `CompositeChart`. Use theme tokens for chart text, surfaces, and grid lines. Keep meaningful series colors distinct from the user-selected accent.
4. Wrap the chart in `AccessibleChart`. Set a short summary with the metric, units, and time range when relevant. Supply table columns and rows for all displayed data, including zero values. Keep chart filters and table filters the same. The wrapper names the chart group and provides a visually hidden data table without changing the visual.
5. Render it in `src/routes/insights.tsx` (or `recap.tsx`).
6. Test the calculation in `server/db.test.ts` and the text alternative in `src/components/primitives.test.ts`. Do not test Recharts itself.
