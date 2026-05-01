---
name: moosecloud-image-playground
description: "Work safely inside the MooseCloud Image Playground repo, a Vite + React + TypeScript app with two entrypoints: the image-first gallery (`index.html`) and the generation playground (`playground.html`). Use when adding or adjusting gallery browsing, prompt/task workflow, image generation API integration, local persistence, export/import, dev proxy behavior, gallery sync data, or the local Node preview server for this project."
---

# MooseCloud Image Playground

## Quick Start

- Read [`../../memories/MEMORY.md`](../../memories/MEMORY.md) before making substantial changes. It contains the current project map, stable behavior contracts, and validation guidance.
- Keep the repo's dual-entry structure intact: `index.html` is the gallery, `playground.html` is the creation workspace.
- Route the request to the smallest relevant surface first instead of editing broadly across the app.

## Route The Request

- For gallery browsing, filters, favorites, detail modal, or prompt-to-playground jumps:
  inspect `src/gallery/GalleryApp.tsx`, `src/gallery/GalleryImageLightbox.tsx`, `src/gallery/galleryFavorites.ts`, and `public/data/cases.json`.
- For prompt input, reference images, mask editing, task cards, detail modal, batch actions, or settings UX:
  inspect `src/App.tsx`, `src/components/InputBar.tsx`, `src/components/TaskGrid.tsx`, `src/components/TaskCard.tsx`, `src/components/DetailModal.tsx`, `src/components/MaskEditorModal.tsx`, and `src/components/SettingsModal.tsx`.
- For shared navigation and entrypoint handoff:
  inspect `src/RootApp.tsx`, `src/main.tsx`, `src/gallery-main.tsx`, `index.html`, and `playground.html`.
- For state, task lifecycle, image caching, export/import, and persistence:
  inspect `src/store.ts`, `src/lib/db.ts`, and `src/types.ts`.
- For API mode differences, request shaping, timeout behavior, or proxy logic:
  inspect `src/lib/api.ts`, `src/lib/devProxy.ts`, `vite.config.mjs`, and `dev-proxy.config.example.json`.
- For gallery source ingestion or `cases.json` schema changes:
  inspect `scripts/sync-gallery-data.mjs` and then the gallery normalization code in `src/gallery/GalleryApp.tsx`.
- For local preview serving or stored-image HTTP behavior:
  inspect `server.mjs`.

## Working Rules

- Preserve the current image-first gallery behavior. Prompt text belongs in the detail modal, not the gallery grid.
- Preserve the current query-param handoff into the playground. If URL-based prompt or settings overrides change, update `applyPlaygroundUrlState(...)` in `src/RootApp.tsx`.
- When changing task execution, trace the whole path: `submitTask(...)` -> queueing -> `executeTask(...)` -> IndexedDB persistence -> UI status updates.
- When changing API behavior, check both `images` and `responses` paths and re-check `codexCli` branches.
- When changing storage, keep ZIP export/import compatibility and do not break existing persisted task/image records.
- When changing gallery data shape, update both the sync script output and the gallery-side normalization code.
- Keep mobile and desktop behavior aligned. `InputBar.tsx` has separate layouts and interaction details for both.

## Validation

- Run `npm test` after logic changes in store, API, masks, viewport helpers, or proxy handling.
- Run `npm run sync-gallery` after changing gallery source ingestion or payload shape.
- Run `npm run build` before closing out changes that affect shipping behavior. Remember that this command runs `sync-gallery` first and can rewrite `public/data/cases.json`.
- Run `npm start` if you touched `server.mjs` or need to verify static serving behavior after build output changes.

## Notes

- Start from the memory file instead of rediscovering the repo every time.
- Prefer small, well-routed edits over cross-cutting rewrites.
- If a change appears to affect both gallery and playground, confirm whether the behavior is truly shared before editing both sides.
