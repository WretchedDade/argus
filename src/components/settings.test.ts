import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const result = await build({
    stdin: {
        contents: `
            import { createElement as h } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MantineProvider } from "@mantine/core";
            import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
            import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
            import { SettingsForm } from "./src/routes/settings.tsx";
            import { argusTheme } from "./src/theme.ts";
            export function render() {
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
                const client = new QueryClient();
                client.setQueryData(["teams"], ["Preview reviewers"]);
                client.setQueryData(["version"], "0.0.0");
                client.setQueryData(["repo-scopes"], [{
                    repo: "Preview.Repository", scope: null, open: 2, hidden: 1,
                }]);
                client.setQueryData(["auth-registration"], { clientId: "", tenantId: "" });
                client.setQueryData(["health"], { poller: { running: false } });
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
    write: false,
    format: "esm",
    platform: "node",
    packages: "external",
    jsx: "automatic",
});
const cacheDir = path.join("node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(path.join(cacheDir, "argus-settings-test-"));
try {
    const outFile = path.join(outDir, "settings.mjs");
    writeFileSync(outFile, result.outputFiles[0].text);
    const { render } = (await import(pathToFileURL(outFile).href)) as {
        render: () => string;
    };
    const html = render();
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
        const id = new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}`).exec(
            html,
        )?.[1];
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
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
