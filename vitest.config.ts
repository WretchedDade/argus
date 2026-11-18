import { defineConfig } from "vitest/config";

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
        coverage: {
            provider: "v8",
            include: [
                "server/**/*.ts",
                "shared/**/*.ts",
                "src/**/*.{ts,tsx}",
                "scripts/**/*.ts",
                "packages/ado-client/src/**/*.ts",
            ],
            exclude: ["**/*.test.ts", "src/routeTree.gen.ts"],
            reporter: ["text", "json-summary", "lcov"],
        },
    },
});
