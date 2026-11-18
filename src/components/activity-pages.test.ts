import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, it } from "vitest";

describe("src/components/activity-pages", () => {
    it("renders activity pages and their empty states", async () => {
        const result = await build({
            stdin: {
                contents: `
            import { createElement as h } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MantineProvider } from "@mantine/core";
            import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
            import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
            import { Route as ListRoute } from "./src/routes/activity.index.tsx";
            import { Route as DetailRoute } from "./src/routes/activity.$runId.tsx";
            import { argusTheme } from "./src/theme.ts";
            const run = {
                id: 42, startedAt: "2026-01-02T09:00:00.000Z",
                finishedAt: "2026-01-02T09:00:02.000Z", ok: false,
                mine: null, tracked: 3, added: 0, updated: 1, events: 1, closed: 0,
                error: null,
            };
            const detail = {
                run,
                entries: [{
                    id: 1, runId: 42, ts: run.startedAt, level: "warn",
                    msg: "Preview enrichment warning",
                    data: { operation: "Preview.Enrichment", count: 2 },
                }],
                changes: [{
                    id: 1, canonical: "https://example.test/pr/1",
                    ts: run.startedAt, type: "archived",
                    payload: { reason: "stale" }, repo: "Preview.Repository",
                    number: 1, title: "Preview archived change",
                }],
            };
            export function render(page, state = "data") {
                const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
                const key = page === "list" ? ["runs"] : ["run", 42];
                if (state !== "pending" && state !== "error")
                    client.setQueryData(key, page === "list" ? [run] : {
                        ...detail, run: state === "missing" ? null : detail.run,
                    });
                if (state === "error" || state === "cached-error")
                    client.getQueryCache().build(client, { queryKey: key }).setState({
                        status: "error", fetchStatus: "idle",
                        error: new Error("Synthetic activity load failure"),
                    });
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                DetailRoute.useParams = () => ({ runId: "42" });
                const child = h((page === "list" ? ListRoute : DetailRoute).options.component);
                return renderToStaticMarkup(h(MantineProvider, { theme: {
                    ...argusTheme,
                    components: {
                        ...argusTheme.components,
                        Accordion: { defaultProps: { keepMountedMode: "display-none" } },
                    },
                } },
                    h(QueryClientProvider, { client },
                        h(RouterContextProvider, { router }, child))));
            }
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
        const outDir = mkdtempSync(path.join(cacheDir, "argus-activity-test-"));
        try {
            const outFile = path.join(outDir, "activity.mjs");
            writeFileSync(outFile, result.outputFiles[0].text);
            const { render } = (await import(pathToFileURL(outFile).href)) as {
                render: (
                    page: "list" | "detail",
                    state?:
                        | "data"
                        | "pending"
                        | "error"
                        | "cached-error"
                        | "missing",
                ) => string;
            };
            for (const page of ["list", "detail"] as const) {
                const pending = render(page, "pending");
                assert.match(pending, /role="status"/);
                assert.match(pending, /Loading/);
                assert.doesNotMatch(pending, /No runs yet|Run not found/);
                const error = render(page, "error");
                assert.match(error, /role="alert"/);
                assert.match(error, /Synthetic activity load failure/);
                assert.doesNotMatch(error, /No runs yet|Run not found/);
                const cached = render(page, "cached-error");
                assert.match(cached, /Synthetic activity load failure/);
                assert.match(cached, /Run #42/);
            }
            const list = render("list");
            assert.match(list, /Failed/);
            assert.match(list, /0 added/);
            const detail = render("detail");
            assert.match(detail, /Failed/);
            assert.match(detail, /Preview enrichment warning/);
            assert.match(detail, /Preview\.Enrichment/);
            assert.match(detail, /Preview archived change/);
            assert.match(detail, /not recorded/i);
            assert.match(detail, /aria-label="Search trace"/);
            assert.match(render("detail", "missing"), /Run not found/);
        } finally {
            rmSync(outDir, { recursive: true, force: true });
        }
    });
});
