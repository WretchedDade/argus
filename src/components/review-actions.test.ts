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
            import { ActionBar, AuthoredPrCard, PrCard, PrDetailCard, VoteAvatars } from "./src/components/PrCard.tsx";
            import { TriageQueue } from "./src/components/TriageQueue.tsx";
            import { Route as DetailRoute } from "./src/routes/pr.tsx";
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
            export const renderVotes = (votes) => renderToStaticMarkup(
                withProviders(createElement(VoteAvatars, { votes })));
            export const renderDetailCard = (pr) => renderToStaticMarkup(
                withProviders(createElement(PrDetailCard, { pr, labels: {} })));
            export const renderDetailPage = (pr, state) => {
                const client = new QueryClient({ defaultOptions: { queries: {
                    retry: false, retryOnMount: false,
                } } });
                const key = ["pr", pr.canonical];
                client.setQueryData(["config"], { teamLabels: {} });
                if (state === "missing" || state === "cached-error")
                    client.setQueryData(key, {
                        pr: state === "missing" ? null : pr, events: [],
                    });
                if (state === "error" || state === "cached-error")
                    client.getQueryCache().build(client, { queryKey: key }).setState({
                        status: "error", fetchStatus: "idle",
                        error: new Error("Synthetic PR load failure"),
                    });
                const router = createRouter({
                    routeTree: createRootRoute(), history: createMemoryHistory(),
                });
                DetailRoute.useSearch = () => ({ c: pr.canonical });
                return renderToStaticMarkup(withProviders(
                    createElement(RouterContextProvider, { router },
                        createElement(DetailRoute.options.component)), client));
            };
            export const renderCard = (pr, options = {}) => {
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(
                    withProviders(
                        createElement(RouterContextProvider, { router },
                            createElement(PrCard, { pr, labels: {}, ...options }))));
            };
            export const renderAuthoredCard = (pr) => {
                const router = createRouter({
                    routeTree: createRootRoute(),
                    history: createMemoryHistory(),
                });
                return renderToStaticMarkup(
                    withProviders(
                        createElement(RouterContextProvider, { router },
                            createElement(AuthoredPrCard, { pr, labels: {} }))));
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
    const {
        render,
        renderAuthoredCard,
        renderCard,
        renderDetailCard,
        renderDetailPage,
        renderQueue,
        renderVotes,
    } = (await import(pathToFileURL(outFile).href)) as {
        renderCard: (
            pr: Pr,
            options?: {
                variant?: "full" | "compact";
                onRestore?: () => void;
            },
        ) => string;
        renderQueue: (prs: Pr[]) => string;
        renderAuthoredCard: (pr: Pr) => string;
        renderDetailCard: (pr: Pr) => string;
        renderDetailPage: (
            pr: Pr,
            state: "pending" | "error" | "cached-error" | "missing",
        ) => string;
        renderVotes: (votes: Pr["otherVotes"]) => string;
        render: (pr: Pr) => string;
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
    const pendingDetail = renderDetailPage(pr, "pending");
    assert.match(pendingDetail, /role="status"/);
    assert.match(pendingDetail, /Loading/);
    assert.doesNotMatch(pendingDetail, /PR not found/);
    const failedDetail = renderDetailPage(pr, "error");
    assert.match(failedDetail, /role="alert"/);
    assert.match(failedDetail, /Synthetic PR load failure/);
    assert.doesNotMatch(failedDetail, /PR not found/);
    const cachedDetail = renderDetailPage(pr, "cached-error");
    assert.match(cachedDetail, /Synthetic PR load failure/);
    assert.match(cachedDetail, /Keep review status visible/);
    assert.match(renderDetailPage(pr, "missing"), /PR not found/);
    for (const variant of ["compact", "full"] as const) {
        const html = renderCard(
            {
                ...pr,
                isDraft: true,
                isVendor: true,
                changedFiles: 12,
                author: "Synthetic Author",
                teams: ["Synthetic team"],
                description:
                    "## Synthetic description stays visible\n\nExample description body.",
                otherVotes: [{ name: "Synthetic reviewer", vote: 10 }],
            },
            { variant, onRestore: () => {} },
        );
        const titleLink = html.match(/<a\b[^]*?<\/a>/)?.[0];
        assert.ok(titleLink);
        assert.ok(titleLink.includes(pr.title));
        assert.doesNotMatch(
            titleLink,
            /<button|Synthetic reviewer|My reviews:|draft|vendor|mantine-Badge-root/i,
        );
        assert.doesNotMatch(html, /Show details|Loading review history/);
        const header = html.match(/<header\b[^]*?<\/header>/)?.[0];
        assert.ok(header);
        assert.match(
            header,
            /<p\b[^>]*>Synthetic Author<\/p>/,
            "The author name is visible text, not just an avatar label.",
        );
        assert.match(
            renderCard({ ...pr, author: "" }, { variant }),
            /<p\b[^>]*>Unknown author<\/p>/,
        );
        const avatar = header.match(
            /<div\b[^>]*\bmantine-Avatar-root\b[^>]*>/,
        )?.[0];
        assert.ok(avatar, "PR titles have a native author avatar.");
        assert.match(avatar, /role="img"/);
        assert.match(avatar, /aria-label="Synthetic Author"/);
        assert.match(html, />SA<\/span>/);
        assert.ok(
            html.indexOf(avatar) < html.indexOf("<h3"),
            "The author avatar comes before the title.",
        );
        assert.equal(
            [...header.matchAll(/\bmantine-Avatar-root\b/g)].length,
            1,
            "The author is not repeated in metadata.",
        );
        assert.doesNotMatch(html, />by Synthetic Author<\/p>/);
        if (variant === "compact") {
            assert.doesNotMatch(
                html,
                /mantine-Badge-root|Review history:|My reviews:|Updated |>Draft<|Vendor|Synthetic team|12 files changed|Synthetic description|Synthetic reviewer|Reviewer votes/,
                "Compact cards omit tags, age, size, history, and review details.",
            );
            assert.doesNotMatch(html, />Repo<\/p>/);
            assert.match(
                html,
                /aria-description="Draft\. Review status: Needs Review"/,
            );
            assert.match(html, /aria-label="Expand PR card"/);
            assert.match(html, /aria-expanded="false"/);
            assert.match(html, /aria-label="Refresh"/);
            assert.match(html, /aria-label="Open in Azure DevOps"/);
            assert.match(html, /mantine-ActionIconGroup-group/);
        } else {
            assert.match(html, /Review history: 0 completed reviews"/);
            assert.match(html, /0 reviews/);
            assert.match(html, /aria-label="PR description"/);
            assert.doesNotMatch(
                html,
                /mantine-Spoiler-root|Show full description|Show less/,
            );
            assert.match(html, /Synthetic description stays visible/);
            assert.doesNotMatch(html, />Reviewer votes</);
            assert.match(html, /Synthetic reviewer/);
            const body = html.match(/<section\b[^]*?<\/section>/)?.[0];
            const footer = html.match(/<footer\b[^]*?<\/footer>/)?.[0];
            assert.ok(header);
            assert.ok(
                body,
                "The card body holds description and review context.",
            );
            assert.ok(footer);
            assert.ok(header.includes(pr.title));
            assert.match(header, /mantine-OverflowList-root/);
            for (const label of ["Draft", "Vendor", "Synthetic team"])
                assert.match(
                    header,
                    new RegExp(
                        `<span\\b[^>]*data-variant="filled"[^>]*>[^]*?<span\\b[^>]*>${label}</span>`,
                    ),
                    `${label} uses a native filled badge.`,
                );
            assert.match(
                header,
                /<\/h3><p\b[^>]*>Synthetic Author<\/p><\/div><\/div><span\b[^>]*title="12 files changed"/,
                "Size sits beside the title.",
            );
            assert.doesNotMatch(header, /Needs Review/);
            assert.match(body, /Needs Review/);
            assert.equal(
                [...html.matchAll(/title="12 files changed"/g)].length,
                1,
                "Size appears once in the expanded card header.",
            );
            assert.doesNotMatch(
                header,
                /Synthetic description|Synthetic reviewer/,
            );
            assert.ok(body.includes("Synthetic description stays visible"));
            assert.ok(body.includes("Synthetic reviewer"));
            assert.ok(body.includes("0 reviews"));
            assert.ok(
                body.indexOf("0 reviews") <
                    body.indexOf('aria-label="Reviewer votes"'),
                "The bottom row places review history before reviewer avatars.",
            );
            assert.doesNotMatch(
                footer,
                /Synthetic description|Synthetic reviewer|Review history:/,
                "The footer holds actions, not review context.",
            );
            assert.match(footer, /Review for me/);
            assert.match(
                footer,
                /aria-label="PR actions"/,
                "Secondary actions have a separate, named group.",
            );
            assert.match(footer, /mantine-ActionIconGroup-group/);
            for (const label of [
                "Snooze",
                "Refresh",
                "Open in Azure DevOps",
                "Out of scope",
            ])
                assert.ok(footer.includes(`aria-label="${label}"`));
            assert.match(html, /<article\b[^>]*data-with-border="true"/);
            for (const section of [header, body, footer])
                assert.match(section, /data-inherit-padding="true"/);
            assert.match(footer, /data-with-border="true"/);
            assert.match(body, /data-with-border="true"/);
            assert.equal(
                [...html.matchAll(/\bmantine-Card-section\b/g)].length,
                3,
                "The card separates its header, details body, and action footer.",
            );
            assert.ok(
                html.indexOf("Synthetic description stays visible") <
                    html.indexOf("Synthetic reviewer"),
                "Votes follow the clamped description.",
            );
            const actionsStart = html.indexOf("Review for me");
            assert.ok(
                html.indexOf("Synthetic reviewer") < actionsStart &&
                    html.indexOf("0 reviews") < actionsStart,
                "The description, votes, and review count come before the action footer.",
            );
        }
        assert.match(html, /aria-label="Back to review"/);
    }
    for (const render of [renderAuthoredCard, renderDetailCard]) {
        const header = render({ ...pr, author: "Synthetic Author" }).match(
            /<header\b[^]*?<\/header>/,
        )?.[0];
        assert.ok(header);
        assert.match(header, /<p\b[^>]*>Synthetic Author<\/p>/);
    }
    const detailPr: Pr = {
        ...pr,
        isDraft: true,
        isVendor: true,
        outOfScope: true,
        snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
        reviewState: "waiting",
        changedFiles: 12,
        teams: ["Synthetic team"],
        description:
            "## Full description\n\n" + "Description paragraph.\n\n".repeat(20),
        otherVotes: [{ name: "Synthetic reviewer", vote: -5 }],
    };
    const detailCard = renderDetailCard(detailPr);
    const detailTitle = detailCard.match(/<h1\b[^]*?<\/h1>/)?.[0];
    assert.ok(detailTitle);
    assert.ok(detailTitle.includes(pr.title));
    assert.doesNotMatch(
        detailTitle,
        /<a\b/,
        "The page title does not link to itself.",
    );
    const detailHeader = detailCard.match(/<header\b[^]*?<\/header>/)?.[0];
    const detailBody = detailCard.match(/<section\b[^]*?<\/section>/)?.[0];
    const detailFooter = detailCard.match(/<footer\b[^]*?<\/footer>/)?.[0];
    assert.ok(detailHeader);
    assert.ok(detailBody);
    assert.ok(detailFooter);
    for (const label of [
        "Draft",
        "Vendor",
        "Out of scope",
        "Synthetic team",
        "Snoozed",
    ])
        assert.ok(
            detailHeader.includes(label),
            `${label} remains visible on the detail page.`,
        );
    assert.match(detailHeader, /title="12 files changed"/);
    assert.match(detailBody, /mantine-Spoiler-root/);
    assert.equal(
        [...detailBody.matchAll(/Description paragraph\./g)].length,
        20,
        "The Spoiler keeps the full description available.",
    );
    assert.doesNotMatch(detailBody, /mantine-Text-root[^>]*data-line-clamp/);
    assert.match(detailBody, /Waiting on Author/);
    assert.match(detailBody, /Review history: 0 completed reviews/);
    assert.match(detailBody, /Synthetic reviewer/);
    assert.match(detailFooter, /Review for me/);
    assert.match(detailFooter, /mantine-ActionIconGroup-group/);
    assert.doesNotMatch(
        renderCard(detailPr),
        /mantine-Spoiler-root/,
        "Board cards keep their clamped description.",
    );
    assert.doesNotMatch(
        renderDetailCard({ ...pr, description: "" }),
        /mantine-Spoiler-root|aria-label="PR description"/,
        "An empty description does not create an empty Spoiler.",
    );
    for (const reviewState of [
        null,
        "needs",
        "covered",
        "approved",
        "suggestions",
        "waiting",
        "rejected",
    ] as const) {
        const html = renderDetailCard({
            ...detailPr,
            isDraft: false,
            reviewState,
        });
        assert.doesNotMatch(
            html,
            /pr-card-compact|aria-label="(?:Expand|Collapse) PR card"/,
            `The ${reviewState} detail card cannot collapse.`,
        );
        assert.equal(
            [...html.matchAll(/\bmantine-Card-section\b/g)].length,
            3,
            `The ${reviewState} detail card keeps its full layout.`,
        );
        assert.match(html, /mantine-Spoiler-root/);
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(
                html.includes(label),
                `The ${reviewState} detail card keeps the same review actions.`,
            );
    }
    const authoredMeta = {
        completable: false,
        blockers: ["Build validation"],
        activeComments: 2,
        resolvedComments: 3,
        mergeStatus: "succeeded",
    };
    const authoredPr: Pr = {
        ...pr,
        role: "author",
        changedFiles: 8,
        teams: ["Synthetic team"],
        otherVotes: [
            { name: "Synthetic approved", vote: 10 },
            { name: "Synthetic waiting", vote: -5 },
        ],
        authorMeta: authoredMeta,
    };
    const authored = renderAuthoredCard(authoredPr);
    const authoredHeader = authored.match(/<header\b[^]*?<\/header>/)?.[0];
    const authoredFooter = authored.match(/<footer\b[^]*?<\/footer>/)?.[0];
    assert.ok(authoredHeader);
    assert.doesNotMatch(authored, /<section\b/);
    assert.ok(authoredFooter);
    assert.match(authoredHeader, /mantine-Avatar-root/);
    assert.match(authoredHeader, /href="\/pr\?/);
    assert.match(authoredHeader, /title="8 files changed"/);
    assert.match(authoredHeader, /Synthetic team/);
    assert.equal(
        [...authored.matchAll(/\bmantine-Card-section\b/g)].length,
        2,
        "Authored cards have a header and footer, without a body.",
    );
    assert.doesNotMatch(authored, /Waiting on you|Needs:|Build validation/);
    assert.match(authoredFooter, /2 active/);
    assert.match(authoredFooter, /3 resolved/);
    assert.match(authoredFooter, /aria-label="Reviewer votes"/);
    assert.match(authoredFooter, /Synthetic waiting: Waiting on author/);
    assert.match(authoredFooter, /mantine-ActionIconGroup-group/);
    assert.match(authoredFooter, /aria-label="Refresh"/);
    assert.match(authoredFooter, /aria-label="Open in Azure DevOps"/);
    assert.doesNotMatch(
        authored,
        /Review for me|Review with me|Delegate|Review history:|aria-label="Snooze"|aria-label="Out of scope"/,
        "Authored cards do not offer review-queue actions.",
    );
    const noAuthorVotes = renderAuthoredCard({
        ...authoredPr,
        otherVotes: [{ name: "Synthetic no vote", vote: 0 }],
        authorMeta: null,
    });
    assert.match(noAuthorVotes, /No reviewers have voted yet/);
    assert.doesNotMatch(noAuthorVotes, /aria-label="Reviewer votes"/);
    const approvedDraft = renderCard(
        { ...pr, isDraft: true, reviewState: "approved" },
        { variant: "compact" },
    ).match(/<article\b[^>]*>/)?.[0];
    assert.ok(approvedDraft);
    assert.match(
        approvedDraft,
        /background:color-mix\(in srgb, var\(--mantine-color-gray-6\)/,
        "Drafts stay neutral even when they have an approval.",
    );
    assert.match(
        approvedDraft,
        /aria-description="Draft\. Review status: Approved"/,
    );
    assert.match(
        renderCard({ ...pr, author: null }),
        /aria-label="Unknown author"/,
        "Missing authors retain a labeled native avatar fallback.",
    );
    const withoutDescription = renderCard({
        ...pr,
        description: "",
        otherVotes: [{ name: "Synthetic reviewer", vote: 10 }],
    });
    const details = withoutDescription.match(/<section\b[^]*?<\/section>/)?.[0];
    assert.ok(details);
    assert.match(details, /Synthetic reviewer/);
    assert.match(details, /0 reviews/);
    assert.doesNotMatch(details, /aria-label="PR description"/);
    const votes = renderVotes([
        { name: "Synthetic approved", vote: 10 },
        { name: "Synthetic waiting", vote: -5 },
        { name: "Synthetic no vote", vote: 0 },
        { name: "Synthetic rejected", vote: -10 },
        { name: "Synthetic suggestions", vote: 5 },
    ]);
    assert.match(votes, /aria-label="Reviewer votes"/);
    const voteLabels = [
        "Synthetic rejected: Rejected",
        "Synthetic waiting: Waiting on author",
        "Synthetic suggestions: Approved with suggestions",
        "Synthetic approved: Approved",
    ];
    let previousVote = -1;
    for (const label of voteLabels) {
        const avatar = votes.match(
            new RegExp(`<div\\b[^>]*aria-label="${label}"[^>]*>`),
        )?.[0];
        assert.ok(avatar, `${label} has an accessible vote avatar.`);
        assert.match(avatar, /tabindex="0"/);
        assert.ok(votes.indexOf(avatar) > previousVote);
        previousVote = votes.indexOf(avatar);
    }
    assert.doesNotMatch(
        votes,
        /Synthetic no vote|mantine-Badge-root|mantine-Indicator-root/,
    );
    assert.doesNotMatch(
        renderVotes([{ name: "No vote", vote: 0 }]),
        /Reviewer votes/,
    );
    for (const reviewState of [
        "needs",
        "covered",
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
        const header = html.match(/<header\b[^]*?<\/header>/)?.[0];
        const body = html.match(/<section\b[^]*?<\/section>/)?.[0];
        assert.ok(header);
        assert.ok(body);
        assert.ok(!header.includes(REVIEW_STATE_META[reviewState].label));
        assert.ok(body.includes(REVIEW_STATE_META[reviewState].label));
        const summaryButtons = [...body.matchAll(/<button\b[^]*?<\/button>/g)]
            .map(([button]) => button)
            .filter((button) => button.includes("Review history:"));
        assert.equal(
            summaryButtons.length,
            1,
            "One dropdown combines review state and history.",
        );
        assert.ok(
            summaryButtons[0].includes(REVIEW_STATE_META[reviewState].label),
        );
        assert.match(summaryButtons[0], /0 reviews/);
        assert.doesNotMatch(body, /mantine-Badge-root/);
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(html.includes(label));
        const bodyLink = html.match(/<a\b[^]*?<\/a>/)?.[0];
        assert.ok(bodyLink);
        assert.match(html, /<h3\b[^>]*><a\b/);
        assert.ok(bodyLink.includes(pr.title));
        assert.doesNotMatch(
            bodyLink,
            /<button|Review for me|Review with me|Delegate|My reviews:/,
            "The title link does not include controls or metadata.",
        );
    }
    for (const count of [1, 2]) {
        const html = renderCard({
            ...pr,
            reviewState: "approved",
            reviewCount: count,
        });
        const countLabel = `${count} review${count === 1 ? "" : "s"}`;
        assert.ok(html.includes(`· ${countLabel}</span>`));
        assert.ok(
            html.includes(
                `aria-label="Approved. Review history: ${count} completed review${count === 1 ? "" : "s"}"`,
            ),
        );
    }
    for (const reviewState of [
        "covered",
        "approved",
        "waiting",
        "suggestions",
        "rejected",
    ] as const) {
        const html = renderQueue([
            {
                ...pr,
                reviewState,
                description: "Hidden queue description",
                otherVotes: [{ name: "Hidden queue reviewer", vote: 10 }],
            },
        ]);
        assert.ok(html.includes(pr.title));
        assert.ok(html.includes(REVIEW_STATE_META[reviewState].label));
        assert.doesNotMatch(
            html,
            /Review for me|Review with me|Delegate/,
            `The queue uses a compact card for the ${reviewState} status.`,
        );
        assert.ok(
            html.includes(
                `aria-description="Review status: ${REVIEW_STATE_META[reviewState].label}"`,
            ),
        );
        const card = html.match(/<article\b[^>]*>/)?.[0];
        assert.ok(
            card?.includes(
                `background:color-mix(in srgb, var(${REVIEW_STATE_META[reviewState].anchor})`,
            ),
            `The compact ${reviewState} card uses its review-state tint.`,
        );
        assert.match(html, /aria-label="Refresh"/);
        assert.match(html, /aria-label="Open in Azure DevOps"/);
        assert.match(html, /aria-label="Expand PR card"/);
        assert.doesNotMatch(
            html,
            /Show details|Review history:|My reviews:|mantine-Badge-root|Hidden queue description|Hidden queue reviewer/,
        );
    }
    for (const reviewState of ["needs", null] as const) {
        const html = renderQueue([{ ...pr, reviewState }]);
        assert.ok(html.includes(REVIEW_STATE_META.needs.label));
        for (const label of ["Review for me", "Review with me", "Delegate"])
            assert.ok(
                html.includes(label),
                `The queue keeps review actions for the ${reviewState} status.`,
            );
    }
    for (const lane of ["quick", "review"] as const) {
        for (const [reviewedSha, lastCommitSha, label] of [
            ["old-head", "new-head", "Review updates"],
            ["same-head", "same-head", "Re-review"],
            [null, "new-head", "Re-review"],
            ["old-head", null, "Re-review"],
            [null, null, "Re-review"],
        ] as const) {
            const linkedPr = {
                ...pr,
                lane,
                reviewSessionId: "existing-session",
                reviewedSha,
                lastCommitSha,
            };
            for (const renderLinked of [render, renderCard, renderDetailCard]) {
                const html = renderLinked(linkedPr);
                const buttons = [...html.matchAll(/<button[^]*?<\/button>/g)]
                    .map(([button]) => button)
                    .filter((button) =>
                        /Review updates|Re-review/.test(button),
                    );
                assert.equal(buttons.length, 1);
                assert.ok(buttons[0].includes(label));
                assert.match(buttons[0], /data-variant="filled"/);
                assert.match(buttons[0], /type="button"/);
                assert.match(html, /existing review session/);
                assert.match(
                    html,
                    lane === "quick" ? /Review for me/ : /Review with me/,
                );
                assert.doesNotMatch(
                    html,
                    />\s*(?:Review for me|Review with me|Delegate)\s*</,
                );
            }
        }
        const html = render({
            ...pr,
            lane,
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
        assert.match(html, /You lead step by step\. Copilot fills the gaps\./);
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
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
