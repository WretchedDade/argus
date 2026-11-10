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
            import { createRootRoute, createRouter, createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
            import { ActionBar, PrCard } from "./src/components/PrCard.tsx";
            export const render = (pr) => renderToStaticMarkup(
                createElement(QueryClientProvider, { client: new QueryClient() },
                    createElement(ActionBar, { pr })));
            export const renderCard = (pr) => {
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(
                    createElement(QueryClientProvider, { client: new QueryClient() },
                        createElement(RouterContextProvider, { router },
                            createElement(PrCard, { pr, labels: {} }))));
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
    const { render, renderCard } = (await import(
        pathToFileURL(outFile).href
    )) as {
        renderCard: (pr: Pr) => string;
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
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(html.includes(`${label}</button>`));
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
            assert.match(html, /Review for me<\/button>/);
            assert.match(html, /Review with me<\/button>/);
            assert.match(html, /Delegate<\/button>/);
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
                assert.match(button, /data-hover:/);
                assert.match(button, /data-active:/);
                assert.match(button, /focus-visible:outline/);
                assert.match(button, /data-headlessui-state/);
                const descriptionId = /aria-describedby="([^"]+)"/.exec(
                    button,
                )?.[1];
                assert.ok(descriptionId);
                assert.ok(
                    html.includes(`id="${descriptionId}" role="tooltip"`),
                );
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
            assert.match(html, /group-focus-within\/tip:opacity-100/);
            assert.match(
                reviewButtons[0],
                /bg-\[color-mix\(in_srgb,var\(--peacock-teal\)_80%,black\)\]/,
            );
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
