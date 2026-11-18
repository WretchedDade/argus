# Mantine migration

## Status and scope

The selected UI migration is implemented. Recap remains hidden from navigation
and deferred. Its route, scoring, and stored data remain available.

The migration does not change the database schema, stored review history, or
metric definitions. The tracked inventory adds an all-history read endpoint.
The release version is 0.14.0.

## Shared decisions

- Use Mantine Core, Hooks, and Charts 9.8.0 with React 19.3.1.
- Keep TanStack Router, Query, and Form.
- Prefer documented native components and composition over bespoke visuals.
- Keep shared defaults and style overrides in `src/theme.ts`.
- Keep Appearance browser-local and separate from Save settings.
- Preserve the animated radar and the 4px accent border. Honor reduced motion
  unless the user enables the radar-only override.
- Preserve all three review actions and their separate loading states.
- Keep fixed data-series colors distinct from the chosen accent.

## Completed surfaces

| Surface           | Result                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell             | Native wrapping `Group`, `Stack`, and `Container` layouts. The header stays sticky without a fixed height. Primary navigation remains real router links. Search, Refresh, account status, notifications, and Settings remain separate controls. |
| Shared states     | Native alerts, loaders, skeletons, notifications, and loading buttons. Failed loads offer retry. Cached data stays visible after a failed refresh.                                                                                              |
| Setup and account | Native labeled inputs, fieldsets, radio choices, and segmented controls. Registration and setup keep their independent save and polling boundaries.                                                                                             |
| Review queue      | Native cards, headings, filters, badges, avatar groups, action groups, overflow labels, and history popovers. The queue retains its priority order and compact reviewed states.                                                                 |
| My PRs            | Shared card header and author identity, with authored-PR age, thread counts, votes, and actions in the footer. No reviewer triage controls.                                                                                                     |
| PR detail         | Shared full-card layout, readable markdown with a native Spoiler, and a native event Timeline. Loading, failed load, missing PR, and cached refresh failure are separate states.                                                                |
| Tracked           | Archived / Active / All tabs, search, paginated native table, and separate restore actions. Closed history remains readable without a Restore action.                                                                                           |
| Settings          | Controlled native tabs, fieldsets, numeric inputs, repository table, save bar, and delete confirmation. Inactive panels stay mounted so validation can reveal invalid fields across tabs.                                                       |
| Activity          | Native table, timeline, severity controls, and structured-data accordions. Missing counters, errors, empty results, and stale cached data stay distinct.                                                                                        |
| Insights          | Native section composition and charts, with the scopes and exceptions below.                                                                                                                                                                    |

### Interaction boundaries

- PR titles navigate. Card actions do not sit inside links.
- Compact summaries keep quick actions. Expand reuses the full card layout.
  Keyboard focus follows expand and collapse.
- Native history popovers fetch only while open. Empty history, failed history,
  retry, and retained cached events remain separate.
- Settings keeps one TanStack form. Save setup, Save settings, and immediate
  Appearance changes do not share a save action.
- Notification lists use one bounded scroll owner. Actions wrap on narrow screens.

## Insights and charts

| Section                        | Renderer and scope                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary                        | Native text and grid layout. All-history totals and the eight-week throughput label remain distinct.                                                                                                        |
| Load & capacity                | Mantine CompositeChart, native legend and hover, and a day/week control. Weekly load is peak daily load, not a sum. The chart is read-only.                                                                 |
| Review responsiveness          | Native ScatterChart and distribution bars. Coincident points retain PR identity through stable point IDs. Unknown verdicts stay visible.                                                                    |
| Review reach                   | Native Treemap with the top 12 authors plus Other. An Accordion and Table list the remaining authors. Windowed counts use when Argus first tracked each PR, not when it was reviewed.                       |
| How you vote                   | Native 100% stacked BarChart. Labels include PR counts. Latest recorded votes cover all history, excluding own PRs, manually dismissed PRs, and unknown authors.                                            |
| Review thoroughness            | Shared native DonutChart. Slices show PR counts for 0, 1-2, 3-5, and 6+ comments. All-time totals include PRs with a recorded vote and a known comment count. Comment volume is not a review-quality score. |
| Review load & coverage by team | Native WaffleChart, one square per PR. A PR can appear in more than one team. Full titles and coverage states remain in wrapping tooltips.                                                                  |
| Review rhythm                  | Native ScatterChart. Totals cover all recorded events. Points show the ten most recent active days in local time. Repeated verdicts remain separate events.                                                 |
| Review calendar                | Native Heatmap with 3/6/12-month controls, local calendar dates, and weekday-only cells. Longer ranges scroll inside the chart.                                                                             |
| Review load                    | Native cards and donuts for repositories and author types. The window selects PRs first tracked in that period, including unreviewed PRs. Repository slices retain the top five plus Other.                 |
| Comments by author type        | Native donut with explicit all-time scope. The PR window does not filter or hide it. Missing measurements are not treated as zero comments.                                                                 |

### Removed sections

The following cards were removed by request:

- How your reviews resolve.
- Whose PRs you review, over time.
- Balance & sustainability.
- Where your review attention lands.

Their stored history and API analytics remain unchanged. The unused streamgraph,
balance strip, repository scatter, old depth meter, depth bars, throughput chart,
and their private helpers are removed.

### Intentional custom code

- Load context bands use Recharts `ReferenceArea` and `Label` inside the native
  CompositeChart. Mantine Charts itself uses Recharts.
- Treemap labels use a small character-budget adapter for ellipsis. Very small
  tiles hide the label. Native hover retains the full author name.
- Scatter tooltips map stable point IDs back to PR identity, including points
  with identical coordinates.
- Waffle grid capacity is explicit, so partial rows do not inflate PR counts.
  Transparent spare cells are not presented as uncovered PRs.
- Donut legends use native `Group`, `ColorSwatch`, and `Text` beside the chart.
  This avoids squeezing long names into the chart's fixed plot area.
  Compact native tooltips wrap names and keep count units together. Their hidden
  measurement boxes no longer cause horizontal page scrolling on phones.
- Native chart legend labels wrap through the shared theme. Four-option window
  controls use the compact size to fit narrow cards.
- The brand radar, compact-card opacity, semantic card tints, and accent frame
  remain intentional custom styling. Legacy CSS utilities use Mantine tokens.

The old custom Avatar, PrList, PrRow, unused team-badge styling helper, orphaned
chart colors, custom scrollbar rules, lane classes, card-glow rules, and toast
animation are removed.

## Verification

Final-pass results:

- `npm run format:check`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed. Targeted ESLint checks also passed after the wrapping changes.
- `npm test`: passed, including 140 root tests and 31 ADO client tests.
- `npm run build`: passed for client and extension. Client rebuilds passed after
  the final responsive fixes.
- `node --test src\components\primitives.test.ts src\components\review-actions.test.ts`:
  passed after the shared legend and detail-state changes. The primitives test
  passed again after the narrow tooltip correction.

The client still reports the existing large-chunk warning. Code splitting is
not part of this migration.

The isolated browser harness uses synthetic PRs in an in-memory store and a
separate Edge profile. It does not inspect the user's browser, connect to ADO,
or change the normal database. Its checks cover default routes at phone, tablet,
and desktop widths in explicit light and dark modes, opposite OS color modes,
host theme-variable changes, five accent tokens, reduced motion, and menu
Escape/focus return. All 42 route/viewport/theme cases passed.

This is not a check of every possible data state. Component regressions cover
loading, empty, missing, error, cached error, action loading, labels, and chart
adapters. PR-detail and long chart-legend regressions fail before their fixes.

An actual Copilot-host smoke test remains a release check. The extension bundle
is built, but this pass does not install it or reload the user's app. Session
creation, host dispatch, and host overlay behavior are not visually verified by
the standalone harness.

## Working safely

- Work in the branch worktree, not the installed extension.
- Keep preview databases ignored. Never commit PR data, tokens, private config,
  screenshots of real PRs, or generated `src/routeTree.gen.ts`.
- After client edits, rebuild and refresh. Server edits require a runner restart.
- Use synthetic API data for browser checks and screenshots.
- Follow [CONTRIBUTING.md](../CONTRIBUTING.md) before pushing:

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

Commits and pushes need a user request. A future PR also needs the version
choice required by the repository instructions. Do not create a tag.
