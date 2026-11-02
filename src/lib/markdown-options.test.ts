import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { markdownOptions, safeUrlTransform } from "./markdown-options.ts";

function render(text: string): string {
    return renderToStaticMarkup(
        createElement(ReactMarkdown, { ...markdownOptions, children: text }),
    );
}

const html = render(
    [
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
    ].join("\n"),
);

assert.doesNotMatch(html, /<img[^>]*onerror/i);
assert.doesNotMatch(html, /<iframe/i);
assert.doesNotMatch(html, /<script/i);
assert.doesNotMatch(html, /href="javascript:/i);
assert.doesNotMatch(html, /href="data:/i);
assert.doesNotMatch(html, /src="javascript:/i);

// Allowed schemes and relative URLs still work.
assert.match(
    render("[a](https://example.test/p)"),
    /href="https:\/\/example.test\/p"/,
);
assert.match(
    render("[a](http://example.test)"),
    /href="http:\/\/example.test"/,
);
assert.match(
    render("[a](mailto:a@example.test)"),
    /href="mailto:a@example.test"/,
);
assert.match(
    render("![a](https://example.test/i.png)"),
    /<img src="https:\/\/example.test\/i.png"/,
);
assert.match(render("[a](/relative)"), /href="\/relative"/);

// Obfuscated schemes are rejected.
assert.equal(safeUrlTransform("JaVaScRiPt:alert(1)"), "");
assert.equal(safeUrlTransform("java\tscript:alert(1)"), "");
assert.equal(safeUrlTransform("vbscript:x"), "");
assert.equal(safeUrlTransform("file:///c:/x"), "");

console.log("markdown-options tests passed");
