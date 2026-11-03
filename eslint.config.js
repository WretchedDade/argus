import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/",
            "release/",
            "extension.mjs",
            "src/routeTree.gen.ts",
            "data/",
            "node_modules/",
            "**/node_modules/",
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        "scripts/*.ts",
                        "packages/ado-client/src/*.test.ts",
                    ],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            // Async functions often satisfy an async interface without awaiting.
            "@typescript-eslint/require-await": "off",
            // Passing an async handler to a JSX attribute is fine; floating promises stay an error.
            "@typescript-eslint/no-misused-promises": [
                "error",
                { checksVoidReturn: { attributes: false, arguments: false } },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },
    {
        files: ["src/routes/pr.tsx", "src/routes/activity.$runId.tsx"],
        rules: {
            // Event payload values are untyped JSON; String() is the intended conversion.
            "@typescript-eslint/no-base-to-string": "off",
        },
    },
    {
        files: ["**/*.test.ts"],
        rules: {
            // Test files run as plain scripts with top-level promises.
            "@typescript-eslint/no-floating-promises": "off",
        },
    },
    {
        files: ["**/*.js"],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: { globals: globals.browser },
        plugins: { "react-hooks": reactHooks },
        rules: {
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "error",
        },
    },
    {
        files: ["server/**/*.ts", "scripts/**/*.ts", "vite.config.ts"],
        languageOptions: { globals: globals.node },
    },
    {
        files: ["src/**/*.{ts,tsx}", "server/**/*.ts"],
        plugins: { boundaries },
        settings: {
            "boundaries/elements": [
                { type: "client", pattern: "src/**" },
                { type: "server", pattern: "server/**" },
            ],
        },
        rules: {
            "boundaries/dependencies": [
                "error",
                {
                    default: "allow",
                    policies: [
                        {
                            from: { element: { type: "client" } },
                            disallow: { to: { element: { type: "server" } } },
                        },
                    ],
                },
            ],
        },
    },
);
