# Mantine migration: audit and next steps

## Status and scope

The migration has a working stopping point. It is not complete.
This plan audits all 34 component files and all 11 route files under `src/`.
It also covers client startup, global CSS, the shared theme, color helpers, and
the HTML entry point. This is a source audit, not a usability study or a visual
check of every screen and state.

The branch is `users/dadecook/component-library-options`.
It includes main through `eb79786`, which adds the three review actions.
The package version is `0.13.0`. No new version change is selected.
This checkpoint records the migration and this plan for work on another machine.

### Decisions already made

- Use Mantine Core, Hooks, and Charts. The installed version is `8.3.18`.
- Keep TanStack Router, Query, and Form. A new component library does not require a new form library.
- Prefer documented Mantine composition. Check public examples against installed types.
- Treat this as a design evolution. Do not copy the old layout or preserve a custom visual just for continuity.
- Keep Appearance separate from the configuration form. Its browser-local changes apply at once.
- Keep the animated radar and the 4px accent border. Honor reduced motion unless the user enables the radar-only override.
- Keep the single prioritized review queue and all three actions: Review for me, Review with me, and Delegate.
- Keep approved, waiting, suggestions, and rejected queue entries compact.
- Use soft category-tinted label text, not bright tint text or harsh black text.

### Completed at this stopping point

Mantine owns ordinary controls, menus, filters, tooltips, notifications, and the
load drawer. Several ordinary charts use Mantine Charts. Appearance supports
automatic, light, and dark modes, five accents, and a radar animation override.
Headless UI is removed.

Full review cards now use `Card` with direct `Card.Section` children.
The linked body has hover and keyboard-focus feedback. Footer controls stay
outside that link. The description uses an overflow-only alpha mask, so hover
does not change the fade color. The header has 4px more top padding.
Card metadata can wrap instead of squeezing its status badge.

`src/theme.ts` owns shared component defaults and the light Badge text treatment.
The board status, size, team, vote, row, and stat chips use Mantine Badges.
Some other route tags and minor draft/vendor labels still do not.

## How to read the inventory

**Swap** means a native component fits without a product decision.
**Compose** means use Mantine primitives while keeping the domain logic.
**Rethink** means a layout or information-design decision comes first.
**Keep** means the current Mantine use or small custom behavior has a reason to remain.
These are recommendations, not approval to implement every design change.

Paths in the component tables are relative to `src/components/`.
Paths in the route table are relative to `src/routes/`.
Function names identify the relevant implementation when a file has several parts.

## Shared component inventory

| File or surface                            | Assessment        | Native direction and limits                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppearanceProvider.tsx`                   | Keep              | Keep the Mantine provider and the custom host/system bridge. Mantine's system preference alone does not read the Copilot host background. Preserve storage errors, cross-tab updates, and legacy defaults.                                                                                                                                                                                                        |
| `AppearanceSettings.tsx`                   | Keep              | Already uses `Paper`, `Stack`, `Alert`, `SegmentedControl`, `NativeSelect`, and `Switch`. An optional swatch selector could make accent choices easier to compare, but the select is valid.                                                                                                                                                                                                                       |
| `AuthControl.tsx`                          | Compose           | Already uses `Badge`, `Button`, and `Text`. Use `Button.loading` and `Group` where useful. Keep sign-in failures visible, not only in a hover title.                                                                                                                                                                                                                                                              |
| `AuthGate.tsx`                             | Swap / compose    | Replace the bordered shell with `Paper` and its layout with `Container`, `Stack`, and `Group`. Use `Alert` for errors and native loading states on action buttons. Keep the provider-specific instructions and Skip behavior.                                                                                                                                                                                     |
| `SetupGate.tsx`                            | Compose / rethink | Use `Paper`, labeled inputs, and `Radio.Group` with native labels/descriptions. Current independent radio controls do not form a native named group. Use `TagsInput` for reviewer patterns if that improves setup consistency. A short single-page setup is probably enough; do not add a Stepper just because one exists.                                                                                        |
| `AuthRegistration.tsx`                     | Compose           | Use `Fieldset`, `TextInput` label/description/error props, `Alert`, and `Code` or `Code` with `block` for the shared JSON. Preserve IDs, focus on the first invalid field, Enter handling, environment overrides, and separate Save setup behavior. Do not nest a second form inside Settings.                                                                                                                    |
| `Avatar.tsx`                               | Remove or swap    | No `src` consumer was found, but Settings still offers an avatar image URL. Decide whether to restore avatars or remove the inactive visible setting. Keep stored-config compatibility. If avatars return, use Mantine `Avatar` for image fallback and initials. Keep only the domain initials/color rule and user ring if still needed.                                                                          |
| `BrandMark.tsx`, `RadarSweep.tsx`          | Keep              | The radar is an explicit user choice, not a generic library icon. Keep this small SVG and its health/appearance wiring. Use unique gradient IDs and keep the motion override radar-only.                                                                                                                                                                                                                          |
| `OcellusMark.tsx`, `StatusCluster.tsx`     | Rethink           | `StatusCluster` still uses `OcellusDot`; the larger `OcellusMark` export has no `src` consumer. A Mantine `Indicator` plus `Text`/`Anchor` can simplify the poll status and avoid two competing brand marks. Do not remove the radar. Preserve live-run navigation and auth warnings.                                                                                                                             |
| `ErrorBanner.tsx`                          | Swap / compose    | `ErrorBanner` maps to `Alert`; `PendingPage` maps to `Loader` and `Center`/`Stack`. Build `LoadErrorPage` and `RouteError` from `ThemeIcon`, `Title`, `List`, `Code`, `Group`, and buttons. Keep useful failure explanations, retry, and Activity navigation.                                                                                                                                                     |
| `PrCard.tsx`, full card                    | Keep / finish     | The new `Card` and linked body section are idiomatic. Convert remaining draft/vendor labels to `Badge`. Use native Button/ActionIcon loading instead of manual spinning icons. Wrap footer metadata and team tags on narrow widths. Keep all review modes and footer actions separate from navigation.                                                                                                            |
| `PrCard.tsx`, compact card                 | Rethink           | Replace the hand-built bordered link with `Paper`/`Card` composition and a separate title/body link. The optional restore `ActionIcon` is currently inside the anchor. Keep the compact density, state tint, and restore action without nested interactive elements.                                                                                                                                              |
| `PrRow.tsx`, `PrList.tsx`                  | Remove or compose | No external `src` consumer of `PrList` was found; `PrRow` is used by `PrList`. Remove the pair if unused. If retained, use a `Paper` list and a real linked row, with `Group`, `Text`, and shared Badges. Do not convert a short title list into a table by default.                                                                                                                                              |
| `PrSearch.tsx`                             | Compose           | The `TextInput` is native already. Show pending lookup with `Loader` in a section and keep an explicit accessible label. Keep the number lookup/track flow. Do not introduce Autocomplete without a real suggestion source.                                                                                                                                                                                       |
| `QueueFilters.tsx`                         | Keep              | Already uses documented controlled `Popover`, `Select`, `Stack`, and `Group` composition. Preserve draft/apply/reset behavior, URL state, the selected option when it disappears from the current data, and `withinPortal: false` for nested selects.                                                                                                                                                             |
| `RefreshButton.tsx`                        | Compose           | Use `Button.loading` or a loader section for the current refresh state. Preserve the optimistic health update and query invalidation. Do not change poll semantics during a visual swap.                                                                                                                                                                                                                          |
| `SegToggle.tsx`                            | Keep              | The small typed adapter over `SegmentedControl` is useful. Keep it if numeric callers remain. Give each control an accessible group name at its call site.                                                                                                                                                                                                                                                        |
| `StatChip.tsx`                             | Keep              | Already a Mantine `Badge`. Preserve the intentional zero-value omission.                                                                                                                                                                                                                                                                                                                                          |
| `TeamLabelEditor.tsx`                      | Keep / refine     | Already uses `Stack`, `Group`, `Select`, `TextInput`, and `ActionIcon`. Check long team names and the fixed 140px input at phone widths. Preserve stable team IDs when labels change.                                                                                                                                                                                                                             |
| `TeamMultiSelect.tsx`                      | Keep              | `TagsInput` fits suggested team names plus free-form globs. Preserve exact text, duplicate handling, and blur propagation to TanStack Form.                                                                                                                                                                                                                                                                       |
| `MarkdownPreview.tsx`                      | Compose / rethink | Keep ReactMarkdown, GFM, the image proxy, and compact link suppression. Use installed Mantine `Typography` for full prose, with `Anchor`, `Code`, `Table`, `Blockquote`, or `Image` only where custom renderers remain useful. Restore real heading semantics in the full view. An optional `Spoiler` must sit outside the linked card body because it adds a button. Keeping the small alpha mask is also valid. |
| `Toaster.tsx`                              | Keep / refine     | Already uses Mantine `Notification` and `Stack`. Keep the business toast store, progress messages, and update completion behavior. Adding `@mantine/notifications` only to replace this store is not needed. Revisit placement and layer order with drawers and the Settings save bar.                                                                                                                            |
| `TriageQueue.tsx`, loading and warnings    | Swap              | Replace `BoardSkeleton` with Mantine `Skeleton` and `PollBanner` with `Alert`. Preserve the difference between first-load failure and stale data with a warning.                                                                                                                                                                                                                                                  |
| `TriageQueue.tsx`, section groups and rail | Rethink           | `Accordion` can own collapsible Stale/Out-of-scope groups and `Badge` their counts. Preserve groups that are intentionally always shown and the current open/closed defaults. Replace or reposition the fixed icon rail; it costs space on phones and is detached from the centered board on wide screens.                                                                                                        |

### Notifications

| File                               | Assessment    | Native direction and limits                                                                                                                                                                                     |
| ---------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationsBell.tsx`            | Keep / refine | The controlled `Popover`, `Indicator`, target/dropdown, and focus trap are sound. Use one bounded `ScrollArea.Autosize` instead of several nested scroll containers. Keep all notice types and archive actions. |
| `notifications/ArchiveBanner.tsx`  | Swap          | Use `Alert` with an archive icon, text, and actions. Its `icon-badge-gold` class no longer has a CSS definition. Preserve dismissal until a new eligible session appears.                                       |
| `notifications/ArchiveSection.tsx` | Compose       | Use `Stack`/`Group`, `Divider`, and the bell's shared scroll owner. Keep the aggregate archive action and each session's identity/status.                                                                       |
| `notifications/IconBadge.tsx`      | Keep          | Already uses `ThemeIcon`. Old `teal`/`gold` tone names can become semantic names or direct theme colors in a small cleanup.                                                                                     |
| `notifications/NoticeRow.tsx`      | Compose       | Use `Group`, `Stack`, and `Text` for layout. Its button wrappers use native HTML prop types and hide Mantine props such as `loading` and sections. Use direct Buttons or Mantine Button prop types.             |
| `notifications/SkillNotice.tsx`    | Keep / refine | Keep both actions and their different effects. Use native loading props after the button wrappers allow them. Do not fold replacement and merge into one generic action.                                        |
| `notifications/StorageNotice.tsx`  | Keep / refine | Keep the existing host action. Improve only button pending feedback and common notice layout.                                                                                                                   |
| `notifications/UpdateNotice.tsx`   | Compose       | Replace the hand-styled View release anchor with `Button component="a"` or `Anchor`. Keep the existing update store, progress toast, and close behavior.                                                        |

## Route inventory

| Route                      | Native direction                                                                                | Layout or behavior to reconsider                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__root.tsx`               | `Container`, `Group`, `Stack`, `Anchor`, existing Buttons/Menu; optional `AppShell`             | Give navigation and page widths a consistent frame. A stable Reports/More menu label may be clearer than a trigger whose name changes. Do not force a fixed-height AppShell header if wrapped mobile navigation makes it fragile. Keep actual route links and active-route semantics, not tabs that only change local state.                                                           |
| `index.tsx`                | `Container` and responsive layout                                                               | Remove unconditional `pl-10` when the rail is hidden or replaced. Prefer section navigation beside the board on wide screens and a compact labeled selector on phones.                                                                                                                                                                                                                 |
| `mine.tsx`                 | `Card`, `Card.Section`, `Badge`, native loading                                                 | Reuse the board's visual hierarchy, not its reviewer-specific business logic. Lead with the merge blocker, show votes beneath it, and put Refresh outside the external anchor. The current refresh button is nested inside the whole-card link.                                                                                                                                        |
| `tracked.tsx`              | `Paper`, `Accordion`, `Badge`, `Alert`, `ScrollArea`, native loading                            | Preserve primary/secondary grouping and search. Put archive controls in a clear section with independent restore buttons. An optional `Table.ScrollContainer` plus `Table` suits exact inventory comparison, but do not add a data-grid dependency. Use a labeled state indicator, not color alone.                                                                                    |
| `pr.tsx`                   | `Paper` or sectioned `Card`, `Badge`, `Button component="a"`, `Timeline`                        | Replace local `Badge`/`StatePill`/`Chip` implementations and the manual event line/dots. Separate summary/actions from the full description and history. Consider a summary column on wide screens and a single column on phones. Keep event filtering/order, full markdown, and refresh-on-open behavior. A non-clickable detail surface should not inherit whole-card hover styling. |
| `settings.tsx`             | Controlled `Tabs`, `Fieldset`, labeled inputs, `NumberInput`, `Table`, `Affix`/`Paper`, `Modal` | Replace `NavLink` buttons plus custom hidden groups with real tab/panel semantics. Keep inactive panels mounted and preserve hidden-invalid-field navigation. Replace `Row` labels around multiple controls or nested labels with native field props and real fieldsets. Keep one TanStack form and its cross-tab dirty state.                                                         |
| `insights.tsx`             | `Paper`, `SimpleGrid`, `ThemeIcon`, `Title`, `Text`, `ColorSwatch`, existing Drawer/Tabs        | Group the long dashboard by user question: load, responsiveness, coverage/quality, and allocation. Keep useful headline KPIs visible. Consider a few page sections or tabs instead of a long wall of equal-weight panels. Make time windows explicit; do not silently make unlike metrics share a window.                                                                              |
| `insights.tsx`, LoadDrawer | `Drawer`, stable `Tabs.Panel` per bucket, `Accordion`, `ScrollArea`, `Badge`, `Alert`/`Loader`  | The outer Drawer/Tabs are native; rows, sticky group headers, scrollbars, and query states are still custom. Keep day/week grouping, peak-day snapshot semantics, search, counts, focus return, and Escape handling. An inline Retry is clearer than “close and try again.”                                                                                                            |
| `recap.tsx`                | `Paper`/`Card`, `Badge`, `SimpleGrid`, `BarChart`, `Alert`, `Skeleton`                          | Keep the readable weekly summary, then show drivers and ranked reviews. Replace custom score pills/chips and manual width bars with native bars where comparison is the goal. These bars show relative quantities, not task completion; do not label them as progress. Preserve scoring, missing-data notes, week selection, and copied facts.                                         |
| `activity.index.tsx`       | `Paper`, linked rows or `Table`, `Badge`/`Indicator`                                            | Align status, time, counts, and duration. Add a plain status label so the dot is not the only signal. Keep links to run details.                                                                                                                                                                                                                                                       |
| `activity.$runId.tsx`      | `Paper`, `Alert`, `Timeline`, `Anchor`, shared stat Badges                                      | Replace `TraceItem`'s line/dot geometry and the manual change-list shells. Keep live trace updates, error levels, chronology, and links to changed PRs.                                                                                                                                                                                                                                |
| `activity.tsx`             | Keep                                                                                            | A routing-only Outlet needs no UI replacement.                                                                                                                                                                                                                                                                                                                                         |

### Settings details that a mechanical swap misses

- `Tabs` keeps inactive panels mounted by default in the installed version. Keep that behavior so switching sections does not discard values.
- Keep native validation able to reveal and focus an invalid field in another panel. Cover this before removing the current `onInvalidCapture` logic.
- Bind each Mantine input to TanStack value, change, blur, and errors. Do not add a second form state store.
- Use `NumberInput` only with an explicit string/number/empty adapter. Do not turn an empty field into zero by accident.
- Work days already use `Checkbox.Group`. Update checks can use a labeled Checkbox or Switch instead of nested labels.
- Keep simple date inputs unless a date-picker design is selected. `@mantine/dates` is not installed; it is not required for this migration.
- Context-band rows need a narrow-screen layout with visible Start/End labels. Placeholders and two adjacent dates are not enough.
- Put repo scope in `Table`/`Table.ScrollContainer` and show pending/error feedback per action.
- A local confirmation `Modal` can make Delete all data clearer. Preserve the explicit confirmation and the fact that settings stay.
- Appearance and Save setup apply separately from Save settings. Show that boundary clearly, including when another tab has unsaved edits.

## Chart inventory and design options

All entries below are in `src/components/Charts.tsx`.
Keep transformations and metric definitions separate from a chart renderer change.

| Export              | Current state                                                                      | Native direction or design recommendation                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LOAD_COLORS`       | Shared tokens                                                                      | Keep semantic series identity distinct from the chosen accent. The orange-accent backlog fallback is intentional.                                                                                                                                                                                            |
| `ThroughputChart`   | Mantine `BarChart`; no `src` consumer found                                        | Remove if unused. If retained, keep unique PR throughput and review-mode series labels.                                                                                                                                                                                                                      |
| `LoadChart`         | Mantine `CompositeChart` with Recharts period overlays and custom ticks            | Keep the native mixed chart. Reference bands are a valid low-level extension. Make daily load versus weekly peak clear. Separate the backlog level from arrivals/reviews visually if users read them as the same quantity. Keep keyboard/click access to the breakdown.                                      |
| `ReviewStreamChart` | Recharts silhouette streamgraph, collision-aware labels, custom tooltip and legend | High-value redesign candidate: native stacked `AreaChart` or `BarChart`, with ranked source totals and fewer visible series. Prefer counts over a percent chart when the question is volume. Preserve grouping and time windows; explicitly decide whether to retain or aggregate the omitted tail as Other. |
| `DepthMeter`        | Actual Mantine `Progress.Root`/`Progress.Section`                                  | Keep. Standardize its legend with `ColorSwatch`, `Group`, and `Text`. Do not claim this is still a custom meter.                                                                                                                                                                                             |
| `DepthBars`         | Mantine `BarChart`; no `src` consumer found                                        | Remove if unused.                                                                                                                                                                                                                                                                                            |
| `HBars`             | Mantine `BarChart`                                                                 | Keep for categorical counts and distributions. Check long labels, non-decimal count ticks, and mobile height.                                                                                                                                                                                                |
| `VoteBars`          | Mantine `BarChart`                                                                 | Keep the 100% verdict mix and author-type categories. Preserve raw counts in accessible labels/tooltips so percentages have context.                                                                                                                                                                         |
| `CoverageWaffle`    | Custom per-PR grid and hover detail                                                | Choose between per-PR inspection and team-level comparison. A native stacked `BarChart` by team plus a PR list is easier to compare. Keep a custom grid only if one-square-per-PR inspection remains the chosen task. Native Tooltip/Popover can replace the manual hover shell.                             |
| `ReviewRhythm`      | Custom weekday/time dots, overlaps, team colors, and tooltip                       | A native `ScatterChart` is plausible with time-of-day x, day y, and team series. It will change overlap/density behavior. Another option is a per-day sitting summary with drill-down. Decide whether the useful task is locating individual reviews or seeing batches.                                      |
| `ReviewCalendar`    | Custom weekday calendar heatmap                                                    | No installed native Heatmap was found in Core or Charts. Keep a small themed calendar with native Tooltip, or select a standard weekly-count `BarChart` if exact volume matters more than the calendar pattern. Do not invent a Heatmap API or upgrade just for this.                                        |
| `BalanceStrip`      | Custom signed weekday bars with independent load shading                           | Candidate for a normal Mantine `BarChart` with positive/negative net series around zero, plus a separate overload indicator row. Net is inflow minus throughput; overload is concurrent load against the threshold. This is not a composition/progress strip. Preserve both metrics and the streak KPIs.     |
| `Donut`             | Mantine `DonutChart` and native legend layout                                      | Keep for a few parts-of-whole categories. Prefer ranked horizontal bars for many repos/authors. Decide whether zero-count legend entries help or add noise.                                                                                                                                                  |
| `RepoScatter`       | Raw Recharts with repo labels                                                      | Use Mantine `ScatterChart` with numeric x/y values. Preserve repo identity through explicit series or metadata lookup in the tooltip. Use a companion ranked list/table instead of overlapping labels when there are many repos.                                                                             |
| `VoteTurnBubbles`   | Recharts x/y/z bubbles and per-point verdict colors                                | Prefer native grouped/stacked `BarChart`: turn on x, verdict series, count on y. It makes exact counts easier to compare. Native scatter is not a documented 1:1 replacement for the variable bubble-area encoding in this version.                                                                          |
| `LatencyScatter`    | Raw Recharts, verdict-colored points                                               | Use Mantine `ScatterChart` with one series per verdict and an explicit numeric-point-to-PR identity mapping. Keep date and duration formatting, median/p90 context, and actionable outliers. The route already has a Spread alternative; improve that rather than adding a second distribution view.         |
| `AuthorTreemap`     | Recharts Treemap with custom tiles and Other tooltip                               | Prefer native horizontal `BarChart` for ranked author counts. Keep top-N/Other totals and a way to inspect the tail. No installed native Mantine Treemap exists. Keep Recharts only if tile area is a deliberate design choice.                                                                              |

### Installed-version constraints

Mantine Charts wraps Recharts. Adopting its wrappers does not remove that
dependency, and a Recharts overlay is not automatically a failed migration.

- Installed `AreaChart` types are `default`, `stacked`, `percent`, and `split`. There is no `type="stream"`. A silhouette escape hatch through Recharts props still needs a proof of concept; it is not a native stream API.
- Installed `ScatterChart` series data is numeric (`Record<string, number>[]`). Do not cast string metadata into that type. Keep a typed identity lookup or use named series.
- Installed ScatterChart has `scatterProps` and x/y point labels. It does not expose a documented Mantine-level z-to-size mapping or `dotSize` prop. Do not promise native variable bubbles.
- Installed Core exports `Typography`. `TypographyStylesProvider` is a deprecated alias in this version.
- No extra chart or form package is required for the recommended first phases.

## Cross-cutting cleanup

| Location                                              | Finding and next step                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/theme.ts`                                        | Keep defaults and Badge variable overrides centralized. Mantine auto-contrast does not solve light-variant badge text. Preserve the approved softer treatment and test it over actual surfaces. Add shared defaults only when repeated use supports them.                                                         |
| `src/styles.css`                                      | Keep the intentional accent frame, radar, and small body hover/focus rules. Replace custom scrollbar CSS when ScrollArea owns the viewport. Remove `card-glow`, lane classes, and toast keyframes only after a final whole-repo reference check. Do not delete structural CSS merely to claim zero custom styles. |
| `src/lib/teamColor.ts`, `src/lib/triage.ts`           | Keep deterministic team colors and domain state metadata. Move remaining hand-styled consumers to Badge before removing `teamBadgeStyle`. Share presentation without confusing authored merge-policy status with reviewer verdict status.                                                                         |
| `src/lib/runStatus.ts`, Activity routes, poll warning | Replace `--true-color-red` fallbacks and fixed warning text colors with Mantine semantic colors. Keep text labels and icons as well as color. Fixed data-series palettes can remain if they work in both modes.                                                                                                   |
| `src/routes/recap.tsx:531`                            | `dark:text-amber-300` follows Tailwind's dark media variant, not the selected Mantine mode. Use a Mantine semantic text color so explicit Light/Dark works independently of the OS.                                                                                                                               |
| All controls and surfaces                             | A component being Mantine does not make its composition idiomatic. Replace duplicated borders, manual spinners, nested labels, and nested interactions. Keep valid semantic HTML, layout divs, and small typed adapters.                                                                                          |
| All motion                                            | Audit manual spin/pulse classes, smooth section scrolling, chart transitions, and old toast animation. Preserve reduced-motion behavior across them. The radar opt-in is not permission to override every animation.                                                                                              |
| `src/main.tsx`, `index.html`                          | Keep one provider and the current router/query setup. The entry HTML has no custom widget to replace. Do not edit the generated route tree.                                                                                                                                                                       |
| Browser/host layers                                   | Check drawer, menu, tooltip, toast, sticky header, and save-bar layers together. Keep overlays responsive and focusable in both standalone and the Copilot canvas.                                                                                                                                                |
| Build output                                          | The current client build warns about chunks over 500kB. This is not a migration blocker. Compare bundle output after deleting unused charts and changing imports before adding manual chunk configuration.                                                                                                        |

## Recommended layout decisions

The highest-value changes are not a one-for-one replacement of every `div`.

1. **One PR interaction pattern.** Use a clear linked title/body and separate actions across the board, compact rows, and My PRs. Keep body-only hover/focus feedback. Do not put a button inside a link.
2. **Board navigation that belongs to the board.** Use a labeled side list on wide layouts or a compact in-flow selector on phones. Keep the prioritized queue and compact reviewed states, rather than bringing back three lanes.
3. **Settings that behaves like tabs and a form.** Use real panels, connected field labels, and clear save boundaries. Show the difference between instant Appearance changes, Save setup, and Save settings.
4. **Insights organized by question.** Make load and responsiveness easy to find. Put allocation and deeper review-pattern analysis behind clear section headings or tabs. Avoid a new dashboard framework.
5. **Charts chosen for the comparison.** Prefer bars for author ranking and vote-turn counts. Simplify the streamgraph before porting its collision engine. Retain a bespoke calendar only when the calendar shape is useful.
6. **Details that support reading.** Use summary/actions, readable markdown, and a native event timeline. Let the desktop layout use available width without making the mobile view a horizontal scroll area.

## Execution plan

Finish and review one phase before starting the next. Do not mix chart metric
changes, backend changes, or a new form library into these UI phases.

| Phase                                 | Work                                                                                                                                                                 | Prerequisites                                    | Done when                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Finish native primitives           | Alert/Loader/Skeleton swaps; remaining Badges; native button loading; external link-buttons; input labels/errors; notice button prop types; semantic warning colors. | Current stopping point                           | No duplicated primitive remains without a recorded reason. Retry, errors, labels, pending states, and category contrast still work.                                    |
| 2. Unify PR cards and lists           | Compact cards, authored cards, responsive footer metadata, consistent linked rows; remove unused Avatar/PrList/PrRow only after reference checks.                    | Phase 1 and PR interaction decision              | No nested links/buttons. Footer actions never navigate. Long names, multiple teams, drafts, vendors, and all review states work at 320px and desktop widths.           |
| 3. Rework Settings                    | Tabs/panels, fieldsets, typed numeric adapters, repo scope table, responsive context bands, save bar, delete confirmation.                                           | Phase 1 and Settings layout decision             | Cross-tab dirty values survive. Hidden invalid fields are revealed and focused. Reset/save work across sections. Appearance and registration saves remain independent. |
| 4. Align shell and grouped navigation | Header/page frame; board rail; queue/Tracked accordions; notification scroll ownership; consistent surface spacing.                                                  | Phase 2 and board navigation decision            | No rail overlap or wasted phone gutter. Section defaults and filters remain unchanged. Menus and keyboard navigation work at narrow widths.                            |
| 5. Align detail, Activity, and Recap  | Native panels/timelines, readable markdown, recap chips and quantitative bars, loading/error/empty states.                                                           | Phase 1; reuse Phase 2 patterns                  | History and copied facts are unchanged. Live traces remain readable. Empty, failed, and stale queries have distinct visible states.                                    |
| 6. Reshape Insights                   | Page grouping, KPI hierarchy, load drawer rows/groups/scrolling, clear window labels.                                                                                | Phases 1 and 4; Insights grouping decision       | Each section states its question/window. Drawer tabs, search, bucket counts, retry, focus return, and day/week semantics work.                                         |
| 7. Simplify charts                    | First ordinary scatter wrappers; then author bars and vote-turn bars; then stream/balance/rhythm/coverage decisions.                                                 | Phase 6 and a decision for each changed encoding | Synthetic fixtures preserve totals, grouping, zero/missing values, identity, outliers, and drill-down. Each remaining custom renderer has a short reason.              |
| 8. Close the migration                | Remove unused code/styles/helpers, update architecture/how-to docs, verify both hosts and the whole theme matrix.                                                    | All selected phases                              | The UI inventory has no unclassified remainder. All checks pass. Chosen custom exceptions and deferred design changes are explicit.                                    |

Phases 3 and 5 can proceed independently once their prerequisites are met.
Phases 6 and 7 need design choices, not just component replacements.
Do not treat every recommendation in this plan as a required release blocker.

## Verification and resume notes

### Current stopping-point evidence

- `npm run format:check`: passed, including this plan.
- `npm run typecheck`: passed for the final code checkpoint.
- `npm run lint`: passed for the final code checkpoint.
- `npm run build:client`: passed after the narrow-width badge fix, with the chunk-size warning noted above.
- `node --test src\components\review-actions.test.ts src\lib\markdown-options.test.ts src\lib\appearance.test.ts`: 9 passed, including the final badge regression.
- Temporary synthetic Edge checks passed after the fix across light/dark, all five accents, and 320px/1280px widths. They cover body hover/focus, fade behavior, header padding, all three review POST modes, footer navigation isolation, and fixture badge wrapping/contrast of at least 4.5:1.
- The new narrow-width badge regression failed before its fix. The broader browser check first found a clipped Needs Review label at 320px.
- `npm test`: passed for the final checkpoint, including the ADO client package.
- `npm run build`: passed for the final checkpoint, including the client and server bundle.

The browser harness is temporary session tooling, not a checked-in browser test
suite. The repo keeps the component rendering regression. Recreate browser
fixtures on another machine rather than relying on a session directory.

### Resume safely

1. Read this plan and inspect `git status` before changing anything.
2. Use the branch worktree, not the installed extension or another checkout.
3. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) to install and build.
4. Run standalone with a new ignored `data` database. It polls live ADO, so it is not an offline fixture environment.
5. Use synthetic API responses for screenshots and UI checks. Never commit the database, private config, or real PR data.
6. After client edits, rebuild the client and refresh. Server edits need a runner restart.
7. Test both standalone and the Copilot host before calling the migration complete. Session-backed actions must still fail clearly in standalone.

For each UI phase, cover loading, empty, error, stale-data, success, and pending
states as applicable. Include explicit Light on a dark OS, explicit Dark on a
light OS, automatic host changes, storage failure, and reduced motion.
Include keyboard focus, tab order, menu Escape/return focus, long names, narrow
widths, and no accidental navigation from actions.

Before a future push, run the documented full checks:

```powershell
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

Further commits and pushes need a new user request. A future PR also needs the version
choice required by the repository instructions. Do not create a tag.

## Documentation references

Use the installed declaration files to resolve differences from current docs.

- [Card and direct sections](https://mantine.dev/core/card/)
- [Polymorphic roots and generic router links](https://mantine.dev/guides/polymorphic/)
- [Badge variants](https://mantine.dev/core/badge/)
- [Theme component defaults](https://mantine.dev/theming/default-props/)
- [Input labels, descriptions, and errors](https://mantine.dev/core/input/)
- [Controlled Tabs and mounted panels](https://mantine.dev/core/tabs/)
- [Accordion controls and heading order](https://mantine.dev/core/accordion/)
- [ScrollArea](https://mantine.dev/core/scroll-area/)
- [AreaChart](https://mantine.dev/charts/area-chart/)
- [ScatterChart](https://mantine.dev/charts/scatter-chart/)
