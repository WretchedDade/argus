import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        pool: "forks",
        testTimeout: 30_000,
        include: [
            "server/**/*.test.ts",
            "shared/**/*.test.ts",
            "src/**/*.test.ts",
            "scripts/**/*.test.ts",
            "packages/ado-client/src/**/*.test.ts",
        ],
        restoreMocks: true,
        // Bundles, subprocesses, and file reads bypass Vite's import graph.
        forceRerunTriggers: [
            ...configDefaults.forceRerunTriggers,
            "**/{src,server,shared,scripts}/**/*.{ts,tsx}",
            "**/skills/pr-review/SKILL.md",
        ],
        coverage: {
            provider: "v8",
            autoAttachSubprocess: true,
            include: [
                "server/**/*.ts",
                "shared/**/*.ts",
                "src/**/*.{ts,tsx}",
                "scripts/**/*.ts",
                "packages/ado-client/src/**/*.ts",
                "dist/test-bundles/**/*.mjs",
            ],
            exclude: [
                "**/*.test.ts",
                "src/routeTree.gen.ts",
                "scripts/test-bundle.ts",
            ],
            excludeAfterRemap: true,
            reporter: ["text", "json-summary", "lcov"],
        },
    },
});
