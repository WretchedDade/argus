import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, type BuildOptions } from "esbuild";

export async function buildTestModule(
    name: string,
    options: Omit<BuildOptions, "outfile" | "sourcemap" | "write">,
): Promise<unknown> {
    const outfile = path.resolve("dist", "test-bundles", `${name}.mjs`);
    // Keep the bundle and its source map available until coverage is reported.
    await build({ ...options, outfile, sourcemap: "inline", write: true });
    return import(pathToFileURL(outfile).href);
}
