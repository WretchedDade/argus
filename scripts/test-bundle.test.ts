import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { buildTestModule } from "./test-bundle.ts";

describe("render test bundles", () => {
    it("keeps generated fixtures outside the released static files", async () => {
        const fixture = await buildTestModule("release-boundary", {
            stdin: { contents: "export const bundleUrl = import.meta.url;" },
            format: "esm",
            platform: "node",
        });
        assert.ok(
            fixture &&
                typeof fixture === "object" &&
                "bundleUrl" in fixture &&
                typeof fixture.bundleUrl === "string",
        );
        const relative = path.relative(
            path.resolve("dist"),
            fileURLToPath(fixture.bundleUrl),
        );
        assert.ok(
            relative.startsWith(`..${path.sep}`),
            "Test bundles must not be copied into releases or served as static files.",
        );
    });
});
