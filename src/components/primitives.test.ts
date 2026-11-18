import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, it, beforeAll, afterAll } from "vitest";

describe("src/components/primitives", () => {
    type Render = Record<
        | "error"
        | "failure"
        | "pending"
        | "boardPending"
        | "noticePending"
        | "notificationBell"
        | "refreshPolling"
        | "signInMethod"
        | "groupedAuthors"
        | "longChartLegend",
        () => string
    > & {
        toast: (kind: "success" | "error" | "progress") => string;
        pollWarning: (authOk: boolean) => string;
        registration: (polling?: boolean) => string;
        chartAlternatives: (empty?: boolean) => Record<string, string>;
        latencySamples: () => {
            points: Record<string, number>[];
            labels: (string | null)[];
        };
        treemapTile: (
            width: number,
            height: number,
        ) => {
            markup: string;
            authorNames: string[];
        };
        voteSamples: () => {
            source: {
                label: string;
                approved: number;
                suggestions: number;
                waiting: number;
                rejected: number;
            }[];
            points: {
                label: string;
                approved: number;
                suggestions: number;
                waiting: number;
                rejected: number;
            }[];
            formattedCounts: string[];
        };
        coverageSamples: () => {
            key: string;
            heading: string;
            cells: { name: string; value: number; color: string }[];
            capacity: number;
            total: number;
            tooltips: string[];
        }[];
        rhythmSamples: () => {
            points: { min: number; day: number; pointId: number }[];
            markup: string;
            stats: string[];
            names: string[];
            domain: number[];
            labels: string[];
        };
        calendarSamples: () => {
            data: Record<string, number>;
            starts: string[];
            end: string;
            tooltip: string;
            empty: string;
            weekendHidden: string;
            weekdayLabel: string;
        };
        donutSamples: (unit?: "PR" | "comment") => {
            segments: { name: string; value: number }[];
            total: number;
            values: string[];
        };
    };
    let render: Render;
    let outDir: string | undefined;
    const tableRows = (html: string) => {
        const table = html.match(/<table\b[^]*?<\/table>/)?.[0];
        assert.ok(table, "Each chart has a data table");
        assert.match(table, /mantine-VisuallyHidden-root/);
        assert.match(table, /<caption>[^<]+<\/caption>/);
        assert.match(table, /<th\b[^>]*scope="col"/);
        return [...table.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)]
            .filter((match) => match[1].includes("<td"))
            .map((match) =>
                [...match[1].matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(
                    (cell) => cell[1],
                ),
            );
    };
    beforeAll(async () => {
        const result = await build({
            stdin: {
                contents: `
            import { cloneElement, createElement as h } from "react";
            import { vi } from "vitest";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MantineProvider } from "@mantine/core";
            import { ChartLegend } from "@mantine/charts";
            import { argusTheme } from "./src/theme.ts";
            import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
            import { ErrorBanner, LoadErrorPage, PendingPage } from "./src/components/ErrorBanner.tsx";
            import { RegistrationImport } from "./src/components/AuthRegistration.tsx";
            import { TriageQueue } from "./src/components/TriageQueue.tsx";
            import { PrimaryButton } from "./src/components/notifications/NoticeRow.tsx";
            import { SegToggle } from "./src/components/SegToggle.tsx";
            import { RefreshButton } from "./src/components/RefreshButton.tsx";
            import { NotificationsBell } from "./src/components/NotificationsBell.tsx";
            import { Toaster } from "./src/components/Toaster.tsx";
            import { dismissToast, pushToast } from "./src/lib/toast.ts";
            import { AuthorTreemap } from "./src/components/charts/AuthorTreemap.tsx";
            import { CoverageWaffle } from "./src/components/charts/CoverageWaffle.tsx";
            import { Donut } from "./src/components/charts/Donut.tsx";
            import { HBars } from "./src/components/charts/HBars.tsx";
            import { LatencyScatter } from "./src/components/charts/LatencyScatter.tsx";
            import { LoadChart } from "./src/components/charts/LoadChart.tsx";
            import { ReviewCalendar } from "./src/components/charts/ReviewCalendar.tsx";
            import { ReviewRhythm } from "./src/components/charts/ReviewRhythm.tsx";
            import { VoteBars } from "./src/components/charts/VoteBars.tsx";
            const render = (child, client = new QueryClient()) => renderToStaticMarkup(
                h(MantineProvider, { theme: argusTheme }, h(QueryClientProvider, { client }, child)));
            export const longChartLegend = () => render(h(ChartLegend, {
                payload: [{ dataKey: "Preview team with a deliberately long display name", color: "blue" }],
                legendPosition: "bottom", onHighlight: () => {},
            }));
            export const error = () => render(h(ErrorBanner, {
                title: "Could not load PRs", error: new Error("Synthetic failure"), onRetry: () => {},
            }));
            export const failure = () => render(h(LoadErrorPage, {
                what: "your config", error: new Error("Synthetic failure"),
                onRetry: () => {}, showActivityLink: false,
            }));
            export const pending = () => render(h(PendingPage));
            export const toast = (kind) => {
                const id = pushToast("Synthetic toast", kind, null);
                try {
                    return render(h(Toaster));
                } finally {
                    dismissToast(id);
                }
            };
            export const boardPending = () => render(h(TriageQueue, { filters: {}, onFiltersChange: () => {} }));
            export const pollWarning = (authOk) => {
                const client = new QueryClient();
                client.setQueryData(["prs"], []);
                client.setQueryData(["health"], { poller: { authOk, lastError: "Synthetic poll failure" } });
                return render(h(TriageQueue, { filters: {}, onFiltersChange: () => {} }), client);
            };
            export const registration = (polling = false) => {
                const client = new QueryClient();
                client.setQueryData(["auth-registration"], { clientId: "", tenantId: "" });
                client.setQueryData(["health"], { poller: { running: polling } });
                return render(h(RegistrationImport), client);
            };
            export const refreshPolling = () => {
                const client = new QueryClient();
                client.setQueryData(["health"], { poller: { running: true } });
                return render(h(RefreshButton), client);
            };
            export const noticePending = () => render(h(PrimaryButton, {
                loading: true, leftSection: h("span", null, "Icon"),
            }, "Archive sessions"));
            export const notificationBell = () => {
                const client = new QueryClient();
                client.setQueryData(["archivable"], []);
                client.setQueryData(["notices"], [{ id: "preview:storage", kind: "storage", title: "Preview", detail: "Synthetic notice" }]);
                return render(h(NotificationsBell), client);
            };
            export const signInMethod = () => render(h(SegToggle, {
                "aria-label": "Sign-in method", value: "az", onChange: () => {},
                options: [{ v: "az", label: "Azure CLI" }, { v: "broker", label: "Windows account" }],
            }));
            export const groupedAuthors = () => render(h(AuthorTreemap, { authors: [
                ...Array.from({ length: 12 }, (_, index) => ({ label: "Synthetic author " + index, count: 1 })),
                { label: "Other", count: 8 },
            ] }));
            export const chartAlternatives = (empty = false) => {
                vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(2026, 2, 17, 12).getTime());
                try {
                    const counts = empty ? [] : [
                        { label: "Synthetic category", count: 3 },
                        { label: "Zero category", count: 0 },
                    ];
                    const items = empty ? [] : [
                        { at: new Date(2026, 2, 16, 9, 0).toISOString(),
                          repo: "Preview.One", team: "team-a", number: 42, title: "Synthetic review" },
                        { at: new Date(2026, 2, 14, 9, 0).toISOString(),
                          repo: "Preview.Weekend", team: null, number: 43, title: "Weekend review" },
                        { at: new Date(2025, 11, 31, 9, 0).toISOString(),
                          repo: "Preview.Old", team: null, number: 44, title: "Older review" },
                    ];
                    return Object.fromEntries(Object.entries({
                        donut: h(Donut, { data: counts, unit: "comment" }),
                        bars: h(HBars, { data: counts }),
                        authors: h(AuthorTreemap, { authors: counts }),
                        votes: h(VoteBars, { data: empty ? [] : [
                            { label: "FTE", approved: 3, suggestions: 2, waiting: 1, rejected: 0 },
                        ] }),
                        load: h(LoadChart, { granularity: "week", data: empty ? [] : [
                            { key: "2026-03-16", inflow: 4, throughput: 2, backlog: 5 },
                        ], periods: [{ label: "Synthetic leave", start: "2026-03-17", end: "2026-03-18" }] }),
                        latency: h(LatencyScatter, { points: empty ? [] : [
                            { at: items[0].at, repo: "Preview.One", number: 42, verdict: null, hours: 2 },
                            { at: items[0].at, repo: "Preview.Two", number: 43, verdict: "future", hours: 0 },
                        ] }),
                        coverage: h(CoverageWaffle, { labels: { "team-a": "Synthetic team" }, data: empty ? [] : [
                            { team: "team-a", total: 2, me: 1, teammate: 0, needs: 1, prs: [
                                { repo: "Preview.One", number: 42, title: "Covered review", coverage: "me" },
                                { repo: "Preview.Two", number: 43, title: "Uncovered review", coverage: "needs" },
                            ] },
                        ] }),
                        rhythm: h(ReviewRhythm, { items, labels: { "team-a": "Synthetic team" } }),
                        calendar: h(ReviewCalendar, { items, months: 3 }),
                    }).map(([name, chart]) => [name, render(chart)]));
                } finally {
                    vi.useRealTimers();
                }
            };
            export const latencySamples = () => {
                const at = "2026-01-02T09:00:00.000Z";
                const props = LatencyScatter({ points: [
                    { at, hours: 2, repo: "Preview.One", number: 1, verdict: "approved" },
                    { at, hours: 2, repo: "Preview.Two", number: 2, verdict: "approved" },
                    { at, hours: 2, repo: "Preview.Three", number: 3, verdict: null },
                    { at, hours: 9, repo: "Preview.Four", number: 4, verdict: "future" },
                ] }).props.children.props;
                const points = props.data.flatMap((series) => series.data);
                return {
                    points,
                    labels: points.map((point) =>
                        props.tooltipProps.labelFormatter(null, [{ payload: point }])),
                };
            };
            export const treemapTile = (width, height) => {
                const name = "Preview author with a very long display name";
                const props = AuthorTreemap({ authors: [{ label: name, count: 3 }] }).props.children.props;
                const content = props.treemapProps?.content;
                return {
                    markup: content ? render(h("svg", null, cloneElement(content, {
                        x: 0, y: 0, width, height, index: 0, depth: 1, name,
                    }))) : "",
                    authorNames: props.data.map((point) => point.name),
                };
            };
            export const voteSamples = () => {
                const data = [
                    { label: "FTE", approved: 1, suggestions: 0, waiting: 0, rejected: 0 },
                    { label: "Vendor", approved: 3, suggestions: 2, waiting: 1, rejected: 1 },
                    { label: "Automated", approved: 0, suggestions: 0, waiting: 1, rejected: 0 },
                ];
                const props = VoteBars({ data }).props.children.props;
                return {
                    source: data,
                    points: props.data,
                    formattedCounts: [props.valueFormatter(1), props.valueFormatter(3)],
                };
            };
            export const donutSamples = (unit) => {
                const element = Donut({ unit, data: [
                    { label: "Preview.One", count: 3 },
                    { label: "Preview.Two", count: 0 },
                    { label: "Preview.Three", count: 1 },
                ] }).props.children;
                const chart = element.props.children[0].props;
                return {
                    segments: chart.data.map(({ name, value }) => ({ name, value })),
                    total: chart.chartLabel,
                    values: [chart.valueFormatter(1), chart.valueFormatter(3)],
                };
            };
            export const coverageSamples = () => {
                const prs = Array.from({ length: 102 }, (_, index) => ({
                    number: index + 1, repo: "Preview.Coverage",
                    title: index === 50
                        ? "Synthetic PR 51 " + "LongTitleToken".repeat(12) + " final title text"
                        : "Synthetic PR " + (index + 1),
                    coverage: index < 100 ? "me" : index === 100 ? "teammate" : "needs",
                }));
                const data = [
                    { team: "team-a", total: 102, me: 100, teammate: 1, needs: 1, prs },
                    { team: "team-b", total: 1, me: 0, teammate: 0, needs: 1, prs: [prs[101]] },
                    { team: "Individual", total: 1, me: 1, teammate: 0, needs: 0, prs: [prs[0]] },
                ];
                const name = "Preview team with a very long display name";
                const props = CoverageWaffle({ data, labels: {
                    "team-a": name, "team-b": name, Individual: "Not the Individual label",
                } }).props.children.props;
                return props.children[1].map(row => {
                    const chart = row.props.children[1].props.children.props;
                    return {
                        key: row.key,
                        heading: render(row.props.children[0]),
                        cells: chart.data,
                        capacity: chart.rows * chart.columns,
                        total: chart.total,
                        tooltips: chart.data.map(cell => render(
                            chart.getTooltipLabel({ ...cell, count: 1 }))),
                    };
                });
            };
            export const rhythmSamples = () => {
                const make = (day, hour, minute, number, repo = "Preview.One", team = "team-a") => ({
                    at: new Date(2026, 1, day, hour, minute).toISOString(),
                    repo, team, number, title: "Synthetic review " + number,
                });
                const items = [
                    make(12, 8, 0, 1),
                    make(12, 8, 45, 2),
                    make(12, 9, 31, 3),
                    make(12, 9, 31, 4, "Preview.Two", null),
                    make(12, 18, 0, 5),
                    ...Array.from({ length: 11 }, (_, i) => make(i + 1, 9, 0, i + 6)),
                ];
                const element = ReviewRhythm({ items, labels: { "team-a": "Preview team" } }).props.children;
                const chart = element.props.children.find(child => child?.props?.dataKey?.x === "min").props;
                const points = chart.data.flatMap(series => series.data);
                return {
                    points,
                    markup: render(h(ReviewRhythm, { items, labels: { "team-a": "Preview team" } })),
                    stats: element.props.children[0].props.children.map(stat => stat.props.value),
                    names: chart.data.map(series => series.name),
                    domain: chart.xAxisProps.domain,
                    labels: points.map(point => render(
                        chart.tooltipProps.labelFormatter(null, [{ payload: point }]))),
                };
            };
            export const calendarSamples = () => {
                vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(2026, 2, 17, 12).getTime());
                try {
                    const make = (year, month, day, hour, minute, repo = "Preview.One") => ({
                        at: new Date(year, month - 1, day, hour, minute).toISOString(),
                        repo, team: null, number: 1, title: "Synthetic review",
                    });
                    const items = [
                        make(2026, 3, 16, 23, 55),
                        make(2026, 3, 16, 0, 5, "Preview.Two"),
                        make(2026, 3, 17, 0, 5),
                        make(2026, 1, 1, 9, 0),
                        make(2025, 12, 31, 9, 0),
                        make(2026, 3, 18, 9, 0),
                        make(2026, 3, 14, 9, 0),
                    ];
                    const chart = months => ReviewCalendar({ items, months })
                        .props.children.props.children[1].props.children.props;
                    const props = chart(3);
                    return {
                        data: props.data,
                        starts: [props.startDate, chart(6).startDate, chart(12).startDate],
                        end: props.endDate,
                        tooltip: props.getTooltipLabel({ date: "2026-03-16", value: 2 }),
                        empty: props.getTooltipLabel({ date: "2026-03-02", value: null }),
                        weekendHidden: props.getRectProps({ date: "2026-03-14", value: null }).style.visibility,
                        weekdayLabel: props.getRectProps({ date: "2026-03-16", value: 2 })["aria-label"],
                    };
                } finally {
                    vi.useRealTimers();
                }
            };
        `,
                resolveDir: process.cwd(),
                loader: "js",
            },
            bundle: true,
            write: false,
            format: "esm",
            platform: "node",
            packages: "external",
            jsx: "automatic",
        });
        const cacheDir = path.join("node_modules", ".cache");
        mkdirSync(cacheDir, { recursive: true });
        outDir = mkdtempSync(path.join(cacheDir, "argus-primitives-test-"));
        const outFile = path.join(outDir, "primitives.mjs");
        writeFileSync(outFile, result.outputFiles[0].text);
        render = (await import(pathToFileURL(outFile).href)) as Render;
    }, 30_000);
    afterAll(() => {
        if (outDir) rmSync(outDir, { recursive: true, force: true });
    });
    it("renders load failures with retry controls", async () => {
        const error = render.error();
        assert.match(error, /role="alert"/);
        assert.match(error, /Could not load PRs/);
        assert.match(error, /Synthetic failure/);
        assert.match(error, /type="button"[^]*?>Retry<\/span>/);
        const failure = render.failure();
        assert.match(failure, /Things to try/);
        assert.match(failure, /Synthetic failure/);
        assert.doesNotMatch(failure, /Open activity log/);
    });
    it("announces pending pages", async () => {
        for (const html of [render.pending(), render.boardPending()]) {
            assert.match(html, /role="status"/);
            assert.match(html, /aria-busy="true"/);
            assert.match(html, /Loading/);
        }
    });
    it("connects registration labels to their controls", async () => {
        const registration = render.registration();
        assert.doesNotMatch(registration, /<form/);
        for (const label of [
            "Application \\(client\\) ID",
            "Directory \\(tenant\\) ID",
        ]) {
            const id = new RegExp(
                `<label[^>]*for="([^"]+)"[^>]*>${label}`,
            ).exec(registration)?.[1];
            assert.ok(id);
            assert.ok(registration.includes(`id="${id}"`));
        }
    });
    it("disables pending notice actions", async () => {
        assert.match(render.noticePending(), /data-loading="true"/);
        assert.match(render.noticePending(), /disabled/);
    });
    it("allows completed toasts to be dismissed", async () => {
        for (const kind of ["success", "error"] as const) {
            const toast = render.toast(kind);
            assert.match(toast, /Synthetic toast/);
            assert.match(toast, /<button\b[^>]*aria-label="Dismiss"/);
        }
        assert.doesNotMatch(render.toast("progress"), /<button\b/);
    });
    it("keeps the notification indicator outside the bell button", async () => {
        const bell = render.notificationBell();
        const bellButton = bell.match(
            /<button\b[^>]*aria-label="Notifications"[^]*?<\/button>/,
        )?.[0];
        assert.ok(bellButton);
        assert.match(bellButton, /aria-expanded="false"/);
        assert.match(bell, /mantine-Indicator-indicator/);
        assert.doesNotMatch(bellButton, /mantine-Indicator-indicator/);
    });
    it("disables refresh and registration actions during polling", async () => {
        for (const html of [
            render.refreshPolling(),
            render.registration(true),
        ]) {
            const button = html.match(/<button\b[^>]*>[^]*?<\/button>/)?.[0];
            assert.ok(button);
            assert.match(button, /\bdisabled(?:=|\s|>)/);
            assert.doesNotMatch(button, /data-loading/);
        }
    });
    it("shows poll warnings for signed-in and signed-out states", async () => {
        for (const authOk of [true, false]) {
            const warning = render.pollWarning(authOk);
            assert.match(warning, /role="alert"/);
            assert.match(warning, /Nothing to review right now/);
            assert.match(
                warning,
                authOk
                    ? /Last poll failed: Synthetic poll failure/
                    : /az login/,
            );
        }
    });
    it("labels the sign-in method control", async () => {
        assert.match(render.signInMethod(), /aria-label="Sign-in method"/);
    });
    it("provides accessible tabular alternatives for every chart", async () => {
        const alternatives = render.chartAlternatives();
        for (const html of Object.values(alternatives)) {
            assert.match(html, /role="group"[^>]*aria-label="[^"]+"/);
            tableRows(html);
        }
        for (const chart of ["donut", "bars", "authors"]) {
            assert.deepEqual(tableRows(alternatives[chart]), [
                ["Synthetic category", "3"],
                ["Zero category", "0"],
            ]);
        }
        const groupedAuthors = render.groupedAuthors();
        assert.ok(
            groupedAuthors.includes(
                'aria-label="Review reach: 20 PRs across 13 displayed author groups."',
            ),
            "The treemap must count displayed author groups, not individual authors",
        );
        const authorGroups = tableRows(groupedAuthors);
        assert.equal(authorGroups.length, 13);
        assert.deepEqual(authorGroups.at(-1), ["Other", "8"]);
        assert.match(
            groupedAuthors,
            /<th\b[^>]*scope="col">Author group<\/th>/,
        );
        assert.match(alternatives.donut, /3 comments/);
        assert.deepEqual(tableRows(alternatives.votes), [
            ["FTE", "3", "2", "1", "0"],
        ]);
        assert.deepEqual(tableRows(alternatives.load), [
            ["2026-03-16", "4", "2", "5", "Synthetic leave"],
        ]);
        assert.match(alternatives.load, /Peak daily load/);
        const latencyRows = tableRows(alternatives.latency);
        assert.equal(latencyRows.length, 2);
        assert.ok(latencyRows[0].includes("No verdict"));
        assert.ok(latencyRows[1].includes("future"));
        assert.ok(latencyRows[1].includes("0"));
        const coverageRows = tableRows(alternatives.coverage);
        assert.equal(coverageRows.length, 2);
        assert.ok(coverageRows.every((row) => row.includes("Synthetic team")));
        assert.ok(coverageRows[0].includes("Covered by me"));
        assert.ok(coverageRows[1].includes("Still needs"));
        assert.equal(tableRows(alternatives.rhythm).length, 3);
        assert.match(alternatives.rhythm, /Synthetic team/);
        const calendarRows = tableRows(alternatives.calendar);
        assert.ok(
            calendarRows.some(
                (row) =>
                    row[0] === "2026-03-16" && row[1] === "1" && row[2] === "1",
            ),
        );
        assert.ok(
            calendarRows.some(
                (row) =>
                    row[0] === "2026-03-17" && row[1] === "0" && row[2] === "0",
            ),
        );
        assert.ok(
            calendarRows.every((row) => {
                const day = new Date(row[0] + "T12:00:00").getDay();
                return (
                    row[0] >= "2026-01-01" &&
                    row[0] <= "2026-03-17" &&
                    day > 0 &&
                    day < 6
                );
            }),
        );
    });
    it("describes empty chart states", async () => {
        for (const [name, html] of Object.entries(
            render.chartAlternatives(true),
        )) {
            const rows = tableRows(html);
            if (name === "calendar") {
                assert.ok(
                    rows.every((row) => row[1] === "0" && row[2] === "0"),
                );
            } else {
                assert.match(html, /No data/);
            }
        }
    });
    it("wraps long chart legend labels", async () => {
        const legend = render.longChartLegend();
        assert.match(
            legend,
            /Preview team with a deliberately long display name/,
        );
        assert.match(legend, /max-width:100%/);
        assert.match(legend, /white-space:normal/);
        assert.match(legend, /overflow-wrap:anywhere/);
    });
    it("fits treemap labels to the available space", async () => {
        const largeTile = render.treemapTile(500, 60);
        assert.match(largeTile.markup, /<text\b/);
        assert.ok(largeTile.markup.includes(largeTile.authorNames[0]));
        const narrowTile = render.treemapTile(120, 60);
        assert.match(narrowTile.markup, />Preview[^<]*…<\/text>/);
        assert.ok(!narrowTile.markup.includes(narrowTile.authorNames[0]));
        assert.deepEqual(narrowTile.authorNames, largeTile.authorNames);
        for (const [width, height] of [
            [24, 60],
            [500, 18],
        ]) {
            const smallTile = render.treemapTile(width, height);
            assert.match(smallTile.markup, /<rect\b/);
            assert.doesNotMatch(smallTile.markup, /<text\b/);
            assert.deepEqual(smallTile.authorNames, largeTile.authorNames);
        }
    });
    it("preserves vote counts and formats their labels", async () => {
        const votes = render.voteSamples();
        assert.deepEqual(
            votes.points.map((point) => point.label),
            ["FTE (1)", "Vendor (7)", "Automated (1)"],
        );
        for (const [index, point] of votes.points.entries()) {
            const { label: sourceLabel, ...sourceCounts } = votes.source[index];
            const { label, ...counts } = point;
            assert.deepEqual(counts, sourceCounts);
            assert.ok(label.startsWith(sourceLabel));
            assert.ok(!sourceLabel.includes("("));
        }
        assert.deepEqual(votes.formattedCounts, ["1 PR", "3 PRs"]);
    });
    it("formats donut totals and units", async () => {
        const donut = render.donutSamples();
        assert.deepEqual(donut.segments, [
            { name: "Preview.One", value: 3 },
            { name: "Preview.Three", value: 1 },
        ]);
        assert.equal(donut.total, 4);
        assert.deepEqual(donut.values, ["1 PR", "3 PRs"]);
        assert.deepEqual(render.donutSamples("comment").values, [
            "1 comment",
            "3 comments",
        ]);
    });
    it("preserves coverage cells, labels, and full tooltips", async () => {
        const coverage = render.coverageSamples();
        assert.deepEqual(
            coverage.map((row) => row.key),
            ["team-a", "team-b", "Individual"],
        );
        assert.deepEqual(
            coverage.map((row) => row.cells.length),
            [102, 1, 1],
        );
        for (const row of coverage) {
            assert.ok(row.capacity >= row.cells.length);
            assert.equal(row.total, row.capacity);
            assert.ok(row.cells.every((cell) => cell.value === 1));
        }
        assert.match(
            coverage[0].heading,
            /Preview team with a very long display name/,
        );
        assert.match(coverage[2].heading, /Individual/);
        assert.doesNotMatch(coverage[2].heading, /Not the Individual label/);
        for (const [index, status] of [
            [0, "Covered by me"],
            [100, "By teammate"],
            [101, "Still needs"],
        ] as const) {
            assert.ok(
                coverage[0].tooltips[index].includes(
                    `Preview.Coverage #${index + 1}: Synthetic PR ${index + 1}`,
                ),
            );
            assert.ok(coverage[0].tooltips[index].includes(status));
        }
        assert.equal(coverage[0].cells[101].name, coverage[1].cells[0].name);
        const longTooltip = coverage[0].tooltips[50];
        assert.ok(longTooltip.includes("LongTitleToken".repeat(12)));
        assert.ok(longTooltip.includes("final title text"));
        assert.match(longTooltip, /white-space:normal/);
    });
    it("preserves review rhythm points and summary counts", async () => {
        const rhythm = render.rhythmSamples();
        assert.equal(tableRows(rhythm.markup).length, rhythm.points.length);
        assert.deepEqual(rhythm.stats, ["16", "14", "1.1"]);
        assert.equal(rhythm.points.length, 14);
        assert.equal(
            new Set(rhythm.points.map((point) => point.pointId)).size,
            14,
        );
        assert.equal(new Set(rhythm.points.map((point) => point.day)).size, 10);
        assert.equal(
            rhythm.points.filter(
                (point) => point.day === 0 && point.min === 571,
            ).length,
            2,
        );
        assert.deepEqual(rhythm.names.sort(), ["Individual", "Preview team"]);
        assert.deepEqual(rhythm.domain, [480, 1080]);
        for (const number of [3, 4]) {
            assert.ok(
                rhythm.labels.some((label) =>
                    label.includes("Synthetic review " + number),
                ),
            );
        }
    });
    it("uses local calendar dates and hides weekend cells", async () => {
        const calendar = render.calendarSamples();
        assert.deepEqual(calendar.data, {
            "2026-01-01": 1,
            "2026-03-16": 2,
            "2026-03-17": 1,
        });
        assert.deepEqual(calendar.starts, [
            "2026-01-01",
            "2025-10-01",
            "2025-04-01",
        ]);
        assert.equal(calendar.end, "2026-03-17");
        assert.match(calendar.tooltip, /2 reviews across 2 repos/);
        assert.match(calendar.empty, /0 reviews across 0 repos/);
        assert.equal(calendar.weekendHidden, "hidden");
        assert.equal(calendar.weekdayLabel, calendar.tooltip);
    });
    it("keeps overlapping latency samples distinct and finite", async () => {
        const latency = render.latencySamples();
        assert.equal(latency.points.length, 4);
        assert.equal(
            new Set(latency.points.map((point) => point.pointId)).size,
            4,
        );
        assert.ok(
            latency.points.every((point) =>
                Object.values(point).every(Number.isFinite),
            ),
        );
        assert.deepEqual(
            latency.points.map((point) => point.hours),
            [2, 2, 2, 9],
        );
        for (const [index, repo] of ["One", "Two", "Three", "Four"].entries()) {
            assert.ok(
                latency.labels.some((label) =>
                    label?.includes(`Preview.${repo} #${index + 1}`),
                ),
            );
        }
    });
});
