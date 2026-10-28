import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// The client is a plain SPA. extension.mjs serves dist/ and the /api routes,
// so there is no dev server here: `npm run dev` is a watch build and you
// reload the canvas to see changes.
export default defineConfig({
    plugins: [
        // Generates src/routeTree.gen.ts from files in src/routes; must precede react().
        tanstackRouter({ target: "react", autoCodeSplitting: true }),
        react(),
        tailwindcss(),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
