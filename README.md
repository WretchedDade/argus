# Argus

Empty React + TanStack canvas extension scaffold.

## Stack
- React 18 + TanStack Router (code-based SPA) + TanStack Query
- Tailwind v4 (theme-aware, follows the app's light/dark mode via host Primer variables)
- Vite
- `server/extension.ts` (TypeScript) compiled to `extension.mjs` (the loadable entry)

## Build
```
npm install
npm run build      # vite build -> dist/, esbuild server -> extension.mjs
```
Dev loop: `npm run dev` (watch build) then reload the canvas.

## Layout
- `server/extension.ts` — canvas registration + HTTP server (serves `dist/`, plus `/api/health`)
- `src/` — React client (`routes/root.tsx` layout, `routes/home.tsx` placeholder)
- `extension.mjs`, `dist/` — build artifacts (gitignored)
