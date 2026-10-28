import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

// ADO attachment URLs are auth-gated, so route them through the server proxy
// (which adds the bearer token). Public images (GitHub, shields, etc.) load direct.
function imageSrc(src?: string): string | undefined {
    if (!src) return undefined;
    if (/visualstudio\.com|dev\.azure\.com/i.test(src))
        return `/api/img?url=${encodeURIComponent(src)}`;
    return src;
}

// Shared renderers: code is a subtle inline chip, tables get bordered cells with
// a shaded header row. `a` differs per context (see below).
const shared: Components = {
    img: ({ src, alt }) => (
        <img
            src={imageSrc(typeof src === "string" ? src : undefined)}
            alt={alt || ""}
            loading="lazy"
            className="border-line max-h-24 rounded border object-contain"
        />
    ),
    code: ({ children }) => (
        <code className="rounded bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)] px-1 py-0.5 text-[0.9em]">
            {children}
        </code>
    ),
    thead: ({ children }) => (
        <thead className="bg-[color-mix(in_srgb,var(--color-fg)_6%,transparent)]">
            {children}
        </thead>
    ),
    th: ({ children }) => (
        <th className="border-line border px-2 py-1 text-left font-semibold">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border-line border px-2 py-1 align-top">{children}</td>
    ),
};

// Compact renderers for a card-sized preview: headings shrink to inline weight
// and the wrapper margin-resets everything so it can't blow out the layout.
const compactComponents: Components = {
    ...shared,
    a: ({ children }) => (
        <span style={{ color: "var(--peacock-teal)" }}>{children}</span>
    ),
    h1: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    h2: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    h3: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    h4: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    h5: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    h6: ({ children }) => <p className="text-fg font-semibold">{children}</p>,
    ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
    pre: ({ children }) => (
        <pre className="overflow-hidden whitespace-pre-wrap">{children}</pre>
    ),
    table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
            <table className="border-line w-full border-collapse overflow-hidden rounded border text-xs">
                {children}
            </table>
        </div>
    ),
};

// Full renderers for the detail page: real heading hierarchy and sensible
// vertical margins around blocks (headings, tables, lists, code, quotes).
const fullComponents: Components = {
    ...shared,
    a: ({ href, children }) => (
        <a
            href={typeof href === "string" ? href : undefined}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
            style={{ color: "var(--peacock-teal)" }}
        >
            {children}
        </a>
    ),
    h1: ({ children }) => (
        <div className="text-fg mb-2 mt-7 text-lg font-semibold">
            {children}
        </div>
    ),
    h2: ({ children }) => (
        <div className="text-fg mb-2 mt-7 text-base font-semibold">
            {children}
        </div>
    ),
    h3: ({ children }) => (
        <div className="text-fg mb-2 mt-6 text-sm font-semibold">
            {children}
        </div>
    ),
    h4: ({ children }) => (
        <div className="text-fg mb-1.5 mt-5 text-sm font-semibold">
            {children}
        </div>
    ),
    h5: ({ children }) => (
        <div className="text-fg mb-1.5 mt-5 text-sm font-semibold">
            {children}
        </div>
    ),
    h6: ({ children }) => (
        <div className="text-muted mb-1.5 mt-5 text-sm font-semibold">
            {children}
        </div>
    ),
    p: ({ children }) => <p className="my-3">{children}</p>,
    ul: ({ children }) => (
        <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    blockquote: ({ children }) => (
        <blockquote className="border-line text-muted my-4 border-l-2 pl-3">
            {children}
        </blockquote>
    ),
    hr: () => <hr className="border-line my-6" />,
    pre: ({ children }) => (
        <pre className="my-5 overflow-x-auto whitespace-pre-wrap rounded bg-[color-mix(in_srgb,var(--color-fg)_6%,transparent)] p-3 text-xs">
            {children}
        </pre>
    ),
    table: ({ children }) => (
        <div className="my-6 overflow-x-auto">
            <table className="border-line w-full border-collapse overflow-hidden rounded border text-xs">
                {children}
            </table>
        </div>
    ),
};

// Renders a markdown preview. By default the block content is height-capped with
// a fade to the card background; pass clamp={false} for a full render (detail page).
export function MarkdownPreview({
    text,
    clamp = true,
}: {
    text: string;
    clamp?: boolean;
}) {
    if (!clamp) {
        return (
            <div className="text-fg text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={fullComponents}
                >
                    {text}
                </ReactMarkdown>
            </div>
        );
    }
    return <ClampedPreview text={text} />;
}

// Clamps to a max height and only shows the bottom fade when the content actually
// overflows — so a short 1-liner isn't obscured by a needless gradient.
function ClampedPreview({ text }: { text: string }) {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [overflowing, setOverflowing] = useState(false);

    useLayoutEffect(() => {
        const outer = outerRef.current;
        const inner = innerRef.current;
        if (!outer || !inner) return;
        const check = () =>
            setOverflowing(
                inner.getBoundingClientRect().height > outer.clientHeight + 1,
            );
        check();
        const ro = new ResizeObserver(check); // re-check as images/content settle
        ro.observe(inner);
        return () => ro.disconnect();
    }, [text]);

    return (
        <div ref={outerRef} className="relative max-h-[7.5rem] overflow-hidden">
            <div
                ref={innerRef}
                className="text-muted text-xs leading-relaxed [&>*+*]:mt-1 [&_*]:my-0"
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={compactComponents}
                >
                    {text}
                </ReactMarkdown>
            </div>
            {overflowing && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-b from-transparent to-[var(--card-bg)] group-hover:to-[var(--card-bg-hover)]" />
            )}
        </div>
    );
}
