# Friction log

Real snags hit while finishing the build, and how they were resolved. Kept honest
so the next person (or the playtest) doesn't relearn them.

## Content / linter

- **case-018 `K11` had no doc line.** The shard was defined with `doc: E2` and
  `supports: [G03, G10]` but no `E2` line referenced it, so `npm run lint:cases`
  failed structural validation (`referenced by 0 doc lines (must be exactly 1)`).
  Fix: added `- shard: K11` to E2's lines. All 3 cases then lint `MC 1000/1000`.
  Lesson: the "exactly one doc line per shard" rule is the easiest authoring slip;
  the compiler catches it before the linter even runs.

## Platform surface (verified, not assumed)

- **`onComment` payload shape is runtime-only.** `triggers.md` confirms the
  `onCommentCreate` trigger and shows `input.comment` / `input.author`, but the
  exact `CommentV2` fields (`body`, `author`, `id`) are only guaranteed at runtime.
  The handler is a **defensive adapter** (`routes/internal.ts`): it reads every
  field optionally, no-ops on anything unrecognised, and reconciles idempotently
  (first-write-wins), so at-least-once trigger delivery is harmless. Probe one real
  payload during playtest before tightening.
- **Menu action responses use `UiResponse`.** The type lives in `@devvit/shared`
  and is re-exported from `@devvit/web/shared`; the deep path
  `@devvit/shared/types/ui-response` is **not** an allowed import (no export map
  entry) — import from `@devvit/web/shared`.
- **`BoardTileMessage` lives in `shared/api.ts`, not `shared/case.ts`.** Trivial,
  but cost a tsc round-trip.
- **Server entry wiring.** `@devvit/start/vite` bundles `src/server/index.ts` →
  `dist/server/index.cjs`. The clean Hono bridge is
  `createServer(getRequestListener(app.fetch)).listen(getServerPort())` using
  `getRequestListener` from `@hono/node-server` + `createServer`/`getServerPort`
  from `@devvit/server` — this sidesteps the `serve()` `createServer`-option type
  friction with the Devvit server shim.
- **Client entry layout.** With `src/client/` present, the devvit vite plugin sets
  the client root there and builds `splash.html` / `game.html` as *direct*
  children of `dist/client/` (the entrypoint names in `devvit.json` resolve
  relative to `src/client`). `main.tsx` is referenced with a relative `./main.tsx`.
- **CSS side-effect import needs a module declaration.** `import './styles.css'`
  fails `tsc` without `declare module '*.css'` (added in `src/client/vite-env.d.ts`).
- **Vite build warnings are benign.** vite 8 + the devvit plugin emit
  `sourcemapFileNames`/`inlineDynamicImports` warnings; the build still completes
  and emits both bundles. Not worth chasing before the platform plugin catches up.

## Ops landmine (carried from VERIFIED.md, restated because it will bite)

- **New hackathon subreddits are being auto-banned**, and **re-banned right after
  a Devvit app install.** Create r/RedactedGame from an aged account on day one,
  add a normal pinned post before installing, keep the unban forum thread handy,
  and expect the second ban at install time. This is an account/ops problem, not a
  code problem — front-load it.

## Deliberately deferred (honest scope)

- **Case Forge intake** (community YAML → same linter → mod queue) is stubbed: the
  approve/hide menu actions pop `forge:queue` / `reports:{case}` zsets, but the
  full YAML-upload-and-lint path is a post-launch lane (SPEC §3).
- **Realtime rate limits** are unpublished; the client re-reads `/api/board` as the
  source of truth and treats realtime tiles as best-effort, so a dropped tile never
  corrupts state.
- **Flair / sticky / submitComment** are wired against the verified `.d.ts` surface
  but only *run* under `devvit playtest` — they are best-effort and wrapped, so a
  platform hiccup can't corrupt the authoritative board in Redis.
