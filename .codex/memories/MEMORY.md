# Task Group: MooseCloud Image Playground project memory
scope: Current architecture, stable UX decisions, core data flows, and safe modification guidance for the MooseCloud Image Playground repo.
applies_to: cwd=F:\code\AICode\gpt-image-2-prompt; reuse_rule=safe for this checkout and close forks of the same app, but re-check live API behavior and external gallery source availability before reusing network assumptions.

## Project snapshot

- This repo is a Vite + React + TypeScript app for image generation workflows.
- It has two HTML entrypoints:
  `index.html` -> gallery
  `playground.html` -> creation workspace
- `src/RootApp.tsx` is the shared router-like shell. It decides which view to render, intercepts internal navigation, and applies URL-driven playground state.
- State is split between:
  lightweight UI/settings persistence in Zustand local storage
  durable task/image storage in IndexedDB

## Run and validate

- `npm run dev`
  Start the Vite dev server on `127.0.0.1:4173`.
- `npm test`
  Run the Vitest suite.
- `npm run sync-gallery`
  Rebuild `public/data/cases.json` from upstream sources.
- `npm run build`
  Run gallery sync first, then TypeScript build and Vite build. This command can rewrite `public/data/cases.json`.
- `npm start`
  Start `server.mjs`, which serves `dist/` if it exists, otherwise serves the project root.

## Entrypoints and file ownership

- `index.html`
  Gallery page entry; loads `src/gallery-main.tsx`.
- `playground.html`
  Playground page entry; loads `src/main.tsx`.
- `src/gallery-main.tsx`
  Initializes theme and viewport guards for the gallery entrypoint.
- `src/main.tsx`
  Initializes theme and viewport guards for the playground entrypoint and registers/unregisters the service worker depending on build mode.
- `src/RootApp.tsx`
  Shared view switching, internal link interception, URL-state handoff, and same-tab task resume marker handling.
- `src/App.tsx`
  Playground composition shell.
- `src/gallery/GalleryApp.tsx`
  Gallery page state, data loading, filtering, favorites, lazy loading, detail modal, and prompt handoff into the playground.
- `src/store.ts`
  Main task workflow, caches, submit/retry/remove/export/import actions, and resume logic.
- `src/lib/api.ts`
  API request construction for both `images` and `responses` modes, including `codexCli`-specific behavior.
- `src/lib/db.ts`
  IndexedDB task/image storage, image dedup, preview generation, and legacy migration helpers.
- `src/lib/devProxy.ts`
  Base URL normalization and dev-proxy resolution.
- `scripts/sync-gallery-data.mjs`
  External source aggregation for gallery cases.
- `server.mjs`
  Local static server plus image persistence endpoints.

## Playground behavior contracts

- Prompt, reference images, mask editing, task cards, settings, modals, and batch actions are all mounted from the playground side.
- `src/components/InputBar.tsx` is the main submission surface. It owns prompt entry, reference-image upload, parameter controls, desktop/mobile layout differences, and batch actions for selected tasks.
- The current UX allows up to 16 reference images.
- Tasks are created by `submitTask(...)`, queued, then executed by `executeTask(...)`.
- Running tasks are not serialized through a single worker. New submissions can start while other tasks are already running.
- Same-tab refresh resume is intentional:
  `sessionStorage` key `gpt-image-playground:resume-active-tasks` marks whether running tasks should be resumed on reload.
- Cold start behavior is also intentional:
  old running tasks are marked interrupted unless the same-tab resume flag is present.
- Mask behavior is tightly coupled to image ordering:
  the mask target image is kept first in the ordered input image list
  removing the mask target clears the mask draft
- ZIP export/import is a supported feature, not a debug tool. Keep compatibility when changing stored task/image shapes.

## Persistence and storage contracts

- Zustand `persist(...)` only stores:
  `settings`
  `params`
  `dismissedCodexCliPrompts`
- Tasks and images live in IndexedDB under database `gpt-image-playground`.
- Images are deduplicated by content hash.
- Stored image records prefer `blob` plus `previewBlob`; legacy `dataUrl` and `src` forms are still migrated forward by `migrateStoredImageRecord(...)`.
- `src/lib/db.ts` creates downsized preview blobs for faster grid rendering.
- `src/store.ts` also keeps in-memory caches for full image URLs, preview URLs, data URLs, and width/height metadata.

## API and proxy contracts

- `src/types.ts` defines two API modes:
  `images`
  `responses`
- `src/lib/api.ts` contains two distinct request paths. Any API-related change should be checked in both paths.
- `codexCli` mode is special behavior, not just a label:
  it wraps prompts with a "do not rewrite" instruction
  it disables quality selection in places where it is not meaningful
  it turns multi-image generation into concurrent single-image requests for the `images` API path
- `normalizeBaseUrl(...)` appends `/v1` when needed. If base URL behavior changes, update both runtime and Vite-side normalization logic.
- Dev proxy behavior only exists in dev-related paths:
  `vite.config.mjs` reads `dev-proxy.config.json` when serving
  `src/lib/devProxy.ts` reads `__DEV_PROXY_CONFIG__` and `VITE_API_PROXY_AVAILABLE`
- If proxy behavior changes, check both:
  request URL generation
  UI behavior in `SettingsModal.tsx`

## Gallery data contracts

- The gallery is intentionally image-first:
  cards show images
  prompt text is shown in the detail modal
- Gallery favorites are local-only state stored in `src/gallery/galleryFavorites.ts`.
- `public/data/cases.json` is generated data and should not be hand-maintained as source of truth.
- `scripts/sync-gallery-data.mjs` currently merges two upstream sources:
  `awesome-gpt-image-2-prompts` from GitHub
  OpenNana prompt gallery
- If the gallery payload schema changes, update both:
  sync output generation
  `normalizePayload(...)` and related normalization helpers in `src/gallery/GalleryApp.tsx`
- The gallery can open the playground with a prompt in the query string. If that handoff changes, update both the gallery link builder and the RootApp URL-state application logic.

## Local server behavior

- `server.mjs` serves `dist/` when it exists, otherwise it serves files directly from the repo root.
- The server also exposes:
  `POST /api/storage/save`
  `/stored-images/...`
- Even if the current UI mostly relies on IndexedDB, do not remove these endpoints casually; they are part of the repo's local serving capabilities.

## Stable UX decisions

- Shared floating page actions are intentionally rendered through `src/components/FloatingPageActions.tsx`.
- `src/components/ThemeToggle.tsx` uses a body-level portal for stable placement across pages.
- Gallery and playground should feel like two views of one app, not two unrelated sites.
- Internal link navigation between the two entrypoints is intentionally intercepted by `RootApp.tsx` instead of always doing full-page navigation.
- `TaskGrid.tsx` supports drag selection, multi-select, batch favorite, and batch delete. These are user-facing features, not temporary admin tools.
- `InputBar.tsx` has separate mobile and desktop interaction design. Do not assume a change in one layout automatically fits the other.

## High-value tests

- `src/store.test.ts`
  Mask draft lifecycle around quick edit/reuse behavior.
- `src/store.resume.test.ts`
  Resume and interruption behavior for running tasks.
- `src/lib/api.test.ts`
  API request/response behavior.
- `src/lib/devProxy.test.ts`
  Proxy normalization and URL generation.
- `src/lib/mask.test.ts`
  Mask-related helpers.
- `src/lib/maskPreprocess.test.ts`
  Mask preprocessing behavior.
- `src/lib/viewportTransform.test.ts`
  Viewport transform helpers.

## Change guardrails

- If changing task counters or final states, preserve the invariants around:
  `requestedCount`
  `completedCount`
  `failedCount`
  resume of partially finished tasks
- If changing storage or export/import, preserve backward compatibility for existing IndexedDB data and ZIP manifests.
- If changing API parameters, check:
  `images` path
  `responses` path
  `codexCli` mode
  proxy mode
- If changing gallery sync/build behavior, remember that `npm run build` will execute the sync script and may change generated data.
- If changing external downloads in `scripts/sync-gallery-data.mjs`, keep the Windows fallback path in mind. The script includes a PowerShell fallback when fetch fails on Windows.
- If changing shared navigation or query-param behavior, update `RootApp.tsx` rather than patching only one entrypoint.
