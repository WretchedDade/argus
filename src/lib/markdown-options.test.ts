import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { safeUrlTransform } from "./markdown-options.ts";

// Node cannot import .tsx, so bundle the real component. Packages stay external.
const result = await build({
    stdin: {
        contents: `
            import { createElement } from "react";
            import { renderToStaticMarkup } from "react-dom/server";
            import { MarkdownPreview } from "./src/components/MarkdownPreview.tsx";
            export const renderFull = (text) =>
                renderToStaticMarkup(createElement(MarkdownPreview, { text, clamp: false }));
            export const renderClamped = (text) =>
                renderToStaticMarkup(createElement(MarkdownPreview, { text }));
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
// Stay inside the repo so package imports resolve. Each run gets its own directory.
const cacheDir = "node_modules/.cache";
type Render = (text: string) => string;
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(`${cacheDir}/argus-markdown-test-`);
const outFile = `${outDir}/markdown-preview.mjs`;
writeFileSync(outFile, result.outputFiles[0].text);
const { renderFull, renderClamped } = (await import(
    pathToFileURL(outFile).href
)) as { renderFull: Render; renderClamped: Render };
rmSync(outDir, { recursive: true, force: true });

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

const renderers = { full: quiet(renderFull), clamped: quiet(renderClamped) };

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

console.log("markdown-options tests passed");
