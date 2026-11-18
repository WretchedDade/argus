import assert from "node:assert/strict";
import { buildTestModule } from "../../scripts/test-bundle.ts";
import { safeUrlTransform } from "./markdown-options.ts";
import { describe, it } from "vitest";

describe("src/lib/markdown-options", () => {
    it("renders markdown while rejecting unsafe link schemes", async () => {
        // Bundle render fixtures with source maps for coverage.
        const result = await buildTestModule("markdown-preview", {
            stdin: {
                contents: `
            import { createElement } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MantineProvider } from "@mantine/core";
            import { argusTheme } from "./src/theme.ts";
            import { MarkdownPreview } from "./src/components/MarkdownPreview.tsx";
            const render = (text, clamp) => renderToStaticMarkup(
                createElement(MantineProvider, { theme: argusTheme },
                    createElement(MarkdownPreview, { text, clamp })));
            export const renderFull = (text) =>
                render(text, false);
            export const renderClamped = (text) =>
                render(text, true);
        `,
                resolveDir: process.cwd(),
                loader: "js",
            },
            bundle: true,
            format: "esm",
            platform: "node",
            packages: "external",
            jsx: "automatic",
        });
        type Render = (text: string) => string;

        const { renderFull, renderClamped } = result as {
            renderFull: Render;
            renderClamped: Render;
        };

        // The clamped preview uses useLayoutEffect, which warns during server rendering.
        const quiet = (render: (text: string) => string) => (text: string) => {
            const original = console.error;
            console.error = () => {};
            try {
                return render(text);
            } finally {
                console.error = original;
            }
        };

        const renderers = {
            full: quiet(renderFull),
            clamped: quiet(renderClamped),
        };

        const payload = [
            "<img src=x onerror=alert(1)>",
            "",
            "<iframe src=https://evil.test></iframe>",
            "",
            "<script>alert(1)</script>",
            "",
            "[x](javascript:alert(1))",
            "",
            "[y](data:text/html;base64,AAAA)",
            "",
            "![z](javascript:alert(1))",
        ].join("\n");

        for (const [mode, render] of Object.entries(renderers)) {
            const html = render(payload);
            assert.doesNotMatch(html, /<img[^>]*onerror/i, mode);
            assert.doesNotMatch(html, /<iframe/i, mode);
            assert.doesNotMatch(html, /<script/i, mode);
            assert.doesNotMatch(html, /href="javascript:/i, mode);
            assert.doesNotMatch(html, /href="data:/i, mode);
            assert.doesNotMatch(html, /src="javascript:/i, mode);

            assert.match(
                render("![a](https://example.test/i.png)"),
                /<img src="https:\/\/example.test\/i.png"/,
                mode,
            );
        }

        // Allowed link schemes and relative URLs still work in the full render.
        assert.match(
            renderFull("[a](https://example.test/p)"),
            /href="https:\/\/example.test\/p"/,
        );
        assert.match(
            renderFull("[a](http://example.test)"),
            /href="http:\/\/example.test"/,
        );
        assert.match(
            renderFull("[a](mailto:a@example.test)"),
            /href="mailto:a@example.test"/,
        );
        assert.match(renderFull("[a](/relative)"), /href="\/relative"/);
        // Obfuscated schemes are rejected.
        assert.equal(safeUrlTransform("JaVaScRiPt:alert(1)"), "");
        assert.equal(safeUrlTransform("java\tscript:alert(1)"), "");
        assert.equal(safeUrlTransform("vbscript:x"), "");
        assert.equal(safeUrlTransform("file:///c:/x"), "");
    });
});
