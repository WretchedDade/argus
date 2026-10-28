import type { ServerResponse } from "node:http";
import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

async function exists(target: string): Promise<boolean> {
    try {
        await access(target, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

// Serve a built asset from distDir; fall back to index.html so client-side
// routing works for unknown paths.
export async function serveStatic(
    res: ServerResponse,
    distDir: string,
    route: string,
): Promise<void> {
    const rel = route === "/" ? "index.html" : route.replace(/^\/+/, "");
    const target = path.join(distDir, rel);
    if (!target.startsWith(distDir) || !(await exists(target))) {
        return serveIndex(res, distDir);
    }
    const body = await readFile(target);
    res.statusCode = 200;
    res.setHeader(
        "Content-Type",
        CONTENT_TYPES[path.extname(target)] || "application/octet-stream",
    );
    res.end(body);
}

async function serveIndex(res: ServerResponse, distDir: string): Promise<void> {
    try {
        const html = await readFile(path.join(distDir, "index.html"));
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
    } catch {
        res.statusCode = 500;
        res.end("Argus client not built. Run `npm run build`.");
    }
}
