import assert from "node:assert/strict";
import { buildTestModule } from "../../scripts/test-bundle.ts";
import { describe, it } from "vitest";

describe("src/components/settings", () => {
    it("renders settings and installation-aware setup controls", async () => {
        const result = await buildTestModule("settings", {
            stdin: {
                contents: `
            import { createElement as h } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MantineProvider } from "@mantine/core";
            import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
            import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
            import { SettingsForm } from "./src/routes/settings.tsx";
            import { SetupGate } from "./src/components/SetupGate.tsx";
            import { argusTheme } from "./src/theme.ts";
                const config = {
                    me: null, adoAuth: "az",
                    orgUrl: "https://example.test", orgSlug: "preview", project: "Preview",
                    teamPatterns: [], teamLabels: { "Preview reviewers": "Reviewers" },
                    periods: [{ label: "Preview period", start: "2026-01-01", end: "2026-01-02" }],
                    reviewSkillName: "pr-review",
                    reviewModels: {
                        quick: { model: "", reasoningEffort: "" },
                        full: { model: "", reasoningEffort: "" },
                        automatic: { model: "", reasoningEffort: "" },
                    },
                    recencyDays: 7, retentionDays: 30,
                    workStartHour: 9, workEndHour: 17, workDays: [1, 2, 3, 4, 5],
                    checkForUpdates: true, vendorPattern: "",
                };
            export function renderSetup(pluginInstalled) {
                const client = new QueryClient();
                client.setQueryData(["config"], config);
                client.setQueryData(["health"], {
                    pluginInstalled, poller: { me: null }, storage: null,
                });
                return renderToStaticMarkup(h(MantineProvider, { theme: argusTheme },
                    h(QueryClientProvider, { client }, h(SetupGate, { pluginInstalled }))));
            }
            export function render(pluginInstalled = false) {
                const client = new QueryClient();
                client.setQueryData(["teams"], ["Preview reviewers"]);
                client.setQueryData(["version"], "0.0.0");
                client.setQueryData(["repo-scopes"], [{
                    repo: "Preview.Repository", scope: null, open: 2, hidden: 1,
                }]);
                client.setQueryData(["auth-registration"], { clientId: "", tenantId: "" });
                client.setQueryData(["health"], { pluginInstalled, poller: { running: false } });
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(h(MantineProvider, { theme: argusTheme },
                    h(QueryClientProvider, { client },
                        h(RouterContextProvider, { router }, h(SettingsForm, { config })))));
            }
        `,
                resolveDir: process.cwd(),
                loader: "js",
            },
            plugins: [
                {
                    name: "appearance-context",
                    setup(bundler) {
                        bundler.onLoad(
                            { filter: /[\\/]AppearanceProvider\.tsx$/ },
                            () => ({
                                contents: `export const useAppearance = () => ({
                    appearance: { mode: "auto", accent: "blue", forceRadarAnimation: false },
                    updateAppearance: () => {}, error: null,
                });`,
                                loader: "js",
                            }),
                        );
                    },
                },
            ],
            bundle: true,
            format: "esm",
            platform: "node",
            packages: "external",
            jsx: "automatic",
        });

        const { render, renderSetup } = result as {
            render: (pluginInstalled?: boolean) => string;
            renderSetup: (pluginInstalled: boolean) => string;
        };
        assert.match(renderSetup(false), /PR review skill/);
        assert.doesNotMatch(
            renderSetup(true),
            /PR review skill|Install the baseline skill|I'll use my own/,
        );
        const html = render();
        assert.match(html, /Check for updates/);
        assert.match(html, /Check for new versions/);
        const pluginHtml = render(true);
        assert.match(pluginHtml, /Argus v0\.0\.0/);
        assert.doesNotMatch(
            pluginHtml,
            /Check for updates|Check for new versions|Check GitHub once a day/,
        );
        assert.doesNotMatch(html, /name="avatarUrl"|Avatar image/);
        assert.equal(
            html.match(/<form\b/g)?.length,
            1,
            "Setup must not nest a form.",
        );
        assert.equal(html.match(/role="tab"/g)?.length, 6);
        assert.equal(html.match(/role="tabpanel"/g)?.length, 6);
        for (const name of [
            "workStartHour",
            "workEndHour",
            "recencyDays",
            "retentionDays",
            "project",
            "orgUrl",
            "reviewModels.quick.model",
            "reviewModels.full.model",
            "reviewModels.automatic.model",
            "periods[0].start",
            "periods[0].end",
        ])
            assert.ok(
                html.includes(`name="${name}"`),
                `Fields stay mounted and named across tabs: ${name}.`,
            );
        for (const label of [
            "Work start \\(hour\\)",
            "Organization URL",
            "Account email override",
            "Start",
            "End",
        ]) {
            const id = new RegExp(
                `<label[^>]*for="([^"]+)"[^>]*>${label}`,
            ).exec(html)?.[1];
            assert.ok(id, `${label} has a native connected label.`);
            assert.ok(html.includes(`id="${id}"`));
        }
        assert.match(html, /Changes apply immediately/);
        assert.match(html, /Preview\.Repository/);
        assert.match(html, /Scope for Preview\.Repository/);
        assert.match(html, /type="button"[^]*?>Save setup<\/span>/);
        let labelDepth = 0;
        for (const tag of html.matchAll(/<\/?label\b[^>]*>/g)) {
            labelDepth += tag[0].startsWith("</") ? -1 : 1;
            assert.ok(labelDepth <= 1, "Input labels must not nest.");
        }
        assert.equal(labelDepth, 0);
    });
});
