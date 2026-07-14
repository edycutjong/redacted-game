# Contributing

Thanks for your interest in improving REDACTED! 🎉

REDACTED is a Devvit Web app (Hono server + React/DOM client, bundled by Vite) —
there is no Next.js/browser dev server here; the client is served by the Reddit
runtime inside a webview.

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install`
3. Log in to Devvit: `npm run login` (`devvit login`)
4. Start a live playtest against your own test subreddit: `npm run dev`
   (`devvit playtest r/<your-test-subreddit>`) — see the **First playtest
   checklist** in `README.md` before you do this the first time.

## Before You Open a PR
- `npm run type-check` passes (`tsc --noEmit`).
- `npm test` passes (158 vitest tests over the pure cores + in-memory Redis stub).
- `npm run lint:cases` passes — every case must clear the solvability linter
  (L1 Monte-Carlo 1000/1000, L2 drama, L3 safety, LD demo-magic-moment where
  applicable). This is the content-quality gate, not just code style.
- `npm run build` succeeds (`dist/client/*.html` + `dist/server/index.cjs`).
- Add or update tests for any behavior change, especially anything touching the
  four core invariants (I1–I4) documented in `README.md`.
- Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:`).

## Adding or Editing a Case
Cases are authored as YAML under `cases/*.yaml` (schema:
`tools/case-compiler/types.ts`, guide: `cases/README.md`) and compiled with
`npm run compile:cases`. A case is not mergeable until `npm run lint:cases`
reports it green.

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include repro steps, expected vs.
actual behavior, and environment details (Node version, whether you saw it in
`devvit playtest` or in the compiled build).
