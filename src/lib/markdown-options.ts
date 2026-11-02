import remarkGfm from "remark-gfm";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Allows only http, https, and mailto links and images. Relative URLs pass.
// Raw HTML is not parsed: react-markdown shows it as text.
export function safeUrlTransform(url: string): string {
    const trimmed = url.trim();
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(
        // Browsers ignore tabs, newlines, and control characters inside a scheme.
        // eslint-disable-next-line no-control-regex
        trimmed.replace(/[\u0000-\u001f\u007f]/g, ""),
    );
    if (!scheme) return trimmed;
    return ALLOWED_PROTOCOLS.has(`${scheme[1].toLowerCase()}:`) ? trimmed : "";
}

export const markdownOptions = {
    remarkPlugins: [remarkGfm],
    urlTransform: safeUrlTransform,
};
