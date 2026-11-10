import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { Pr } from "../lib/api.ts";
import { REVIEW_STATE_META } from "../lib/triage.ts";

// Bundle the real TSX component for Node, as in markdown-options.test.ts.
const result = await build({
    stdin: {
        contents: `
            import { createElement } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
            import { MantineProvider } from "@mantine/core";
            import { argusTheme } from "./src/theme.ts";
            import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
            import { ActionBar, PrCard } from "./src/components/PrCard.tsx";
            import { TriageQueue } from "./src/components/TriageQueue.tsx";
            const withProviders = (child, client = new QueryClient()) => createElement(MantineProvider, {
                theme: { ...argusTheme, components: { ...argusTheme.components, Tooltip: { defaultProps: {
                    withinPortal: false,
                    defaultOpened: true,
                } } } },
            },
                createElement(QueryClientProvider, { client },
                    child));
            export const render = (pr) => renderToStaticMarkup(
                withProviders(createElement(ActionBar, { pr })));
            export const renderCard = (pr) => {
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(
                    withProviders(
                        createElement(RouterContextProvider, { router },
                            createElement(PrCard, { pr, labels: {} }))));
            };
            export const renderQueue = (prs) => {
                const client = new QueryClient();
                client.setQueryData(["prs"], prs);
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(
                    withProviders(
                        createElement(RouterContextProvider, { router },
                            createElement(TriageQueue, { filters: {}, onFiltersChange: () => {} })),
                        client));
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
const outDir = mkdtempSync(path.join(cacheDir, "argus-review-actions-test-"));
try {
    const outFile = path.join(outDir, "review-actions.mjs");
    writeFileSync(outFile, result.outputFiles[0].text);
    const { render, renderCard, renderQueue } = (await import(
        pathToFileURL(outFile).href
    )) as {
        renderCard: (pr: Pr) => string;
        renderQueue: (prs: Pr[]) => string;
        render: (
            pr: Pick<
                Pr,
                | "canonical"
                | "lane"
                | "reviewSessionId"
                | "snoozeMode"
                | "snoozedUntil"
            >,
        ) => string;
    };
    const pr: Pr = {
        canonical: "https://example.test/pr/1",
        org: "org",
        project: "project",
        repo: "Repo",
        number: 1,
        title: "Keep review status visible",
        description: "",
        author: "Author",
        isVendor: false,
        role: "reviewer",
        teams: [],
        requiredApproverGroups: [],
        reviewState: null,
        otherVotes: [],
        lane: "review",
        state: "pending",
        isDraft: false,
        outOfScope: false,
        dismissed: false,
        dismissedReason: null,
        dismissedAt: null,
        snoozedUntil: null,
        snoozeMode: null,
        reviewSessionId: null,
        reviewedSha: null,
        reviewCount: 0,
        coveredAt: null,
        changedFiles: null,
        authorMeta: null,
        prCreatedAt: null,
        lastCommitSha: null,
        lastCommitAt: null,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    for (const reviewState of [
        "approved",
        "waiting",
        "suggestions",
        "rejected",
    ] as const) {
        const html = renderCard({ ...pr, reviewState });
        assert.ok(
            html.includes(REVIEW_STATE_META[reviewState].label),
            `Full cards show the ${reviewState} status.`,
        );
        const badge = html.match(/<div[^>]*mantine-Badge-root[^>]*>/)?.[0];
        assert.ok(
            badge?.includes("shrink-0"),
            `The ${reviewState} label stays readable when card metadata wraps.`,
        );
        assert.ok(
            badge?.includes(
                `color:color-mix(in srgb, var(${REVIEW_STATE_META[reviewState].anchor}) 20%, var(--argus-tag-text))`,
            ),
            `The ${reviewState} badge uses a muted theme color, not its bright tint.`,
        );
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(html.includes(label));
        const bodyLink = html.match(/<a\b[^]*?<\/a>/)?.[0];
        assert.ok(bodyLink);
        assert.ok(bodyLink.includes("<h3"));
        assert.ok(bodyLink.includes(pr.title));
        assert.doesNotMatch(
            bodyLink,
            /<button|Review for me|Review with me|Delegate|My reviews:/,
            "The card body link does not include footer controls or metadata.",
        );
    }
    for (const reviewState of [
        "approved",
        "waiting",
        "suggestions",
        "rejected",
    ] as const) {
        const html = renderQueue([{ ...pr, reviewState }]);
        assert.ok(html.includes(pr.title));
        assert.ok(html.includes(REVIEW_STATE_META[reviewState].label));
        assert.doesNotMatch(
            html,
            /Review for me|Review with me|Delegate|<h3/,
            `The queue uses a compact card for the ${reviewState} status.`,
        );
    }
    for (const reviewState of ["needs", null] as const) {
        const html = renderQueue([{ ...pr, reviewState }]);
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(
                html.includes(label),
                `The queue keeps review actions for the ${reviewState} status.`,
            );
    }
    for (const lane of ["quick", "review"] as const) {
        for (const reviewSessionId of [null, "existing-session"]) {
            const html = render({
                canonical: "https://example.test/pr/1",
                lane,
                reviewSessionId,
                snoozeMode: null,
                snoozedUntil: null,
            });
            assert.match(html, /Review for me/);
            assert.match(html, /Review with me/);
            assert.match(html, /Delegate/);
            assert.ok(
                html.indexOf("Review for me") < html.indexOf("Review with me"),
            );
            const reviewButtons = [...html.matchAll(/<button[^]*?<\/button>/g)]
                .map(([button]) => button)
                .filter((button) =>
                    /Review for me|Review with me|Delegate/.test(button),
                );
            assert.equal(reviewButtons.length, 3);
            for (const button of reviewButtons) {
                assert.match(button, /type="button"/);
                assert.match(button, /mantine-Button-root/);
                const descriptionId = /aria-describedby="([^"]+)"/.exec(
                    button,
                )?.[1];
                assert.ok(descriptionId);
                assert.ok(html.includes(`id="${descriptionId}"`));
            }
            assert.match(
                html,
                /Copilot reviews first\. You add findings and approve comments and the vote\./,
            );
            assert.match(
                html,
                /You lead step by step\. Copilot fills the gaps\./,
            );
            assert.match(
                html,
                /Copilot can approve without asking, but only with zero findings\./,
            );
            assert.match(reviewButtons[0], /data-variant="filled"/);
            assert.match(reviewButtons[1], /data-variant="default"/);
            assert.match(reviewButtons[2], /data-variant="default"/);
            assert.doesNotMatch(
                html,
                /Move to|Full review|Quick|Re-review|Start automatic review/,
            );
            assert.doesNotMatch(html, /About review modes|role="dialog"/);
        }
    }
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
