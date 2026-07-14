# AUDIO — REDACTED (IMPLEMENTED 2026-07-14)

Status: **shipped (SFX)**. Procedural Web Audio one-shots are wired into the
client — no asset files, no external fetch, so it respects `http.enable:false`
and works offline. Implementation: `src/client/audio.ts`; cues fire from
`src/client/main.tsx` (peel / strike / file / lit-string / accuse). A mute
toggle sits top-right and audio unlocks on the first tap (autoplay policy).
Background music is deliberately **not** shipped this pass (SFX-only) — it
remains optional per the sections below. The cue table below is now the wired
map, not a draft.

## Feasibility (verified so far, audited)

- Devvit's client is a real Chromium webview (full `lib.dom.d.ts` available
  in the build — `HTMLAudioElement`, `AudioContext`, etc.). `devvit.json`'s
  config schema has no CSP field — that means this repo doesn't set one, not
  that none applies. **The real Content-Security-Policy is set by Reddit's
  host page at runtime and is not verifiable from this repo.**
- **Not officially confirmed** by any crawled Devvit doc: whether Reddit's
  mobile-app embedded webview wrapper has its own autoplay/audio quirks on
  top of standard browser autoplay policy. Treat the first `devvit playtest`
  as the real test, not this doc.
- Hard constraints regardless of source:
  - This project's `devvit.json` has `"http": {"enable": false}` (confirmed) —
    every audio file must be bundled into `dist/client/` at build time,
    never fetched from an external CDN.
  - Browser autoplay policy — sound can't start until after a user gesture
    (the first tap to peel a redaction bar satisfies this).
  - `localStorage` wiped on app updates is asserted for Grudgeball's own
    architecture doc but **not independently documented anywhere in this
    project** — treat it as inherited platform behavior (very likely true
    across all Devvit apps), not a REDACTED-specific verified fact. Either
    way, a persistent mute preference needs a session-only flag or a Redis
    field to be safe.
  - **Splash (`inline: true`) vs expanded game view are different UX
    surfaces** (same as the other two games in this hackathon) — scope
    audio to the expanded view a player explicitly opened, not the inline
    feed splash.
  - Not addressed yet: pausing `AudioContext` on `visibilitychange` and
    `.resume()` inside the gesture handler (iOS). No accessibility fallback
    planned for cues (e.g. a visual pulse alongside the peel sound).

## SFX cue map

| Trigger | File location | Cue | Notes |
|---|---|---|---|
| Redaction bar peels back (reveals your line) | `src/client/main.tsx` (peel interaction — everything client-side lives in this one file, no separate `components/`/`hooks/` split) | Paper-tear / peel sound | The core interaction, happens every session — highest-frequency cue |
| Filing an evidence card | `/api/file` success handler | Typewriter clack / stamp thud | Matches the typeset evidence-card aesthetic |
| Contradiction pair lights up (red string) | evidence-board render | Short tension sting | Rewards spotting a contradiction |
| Accusation locked in | `/api/accuse` success handler | Low "lock/seal" click | One-shot per case, weight it heavier than the file-card sound |
| Verdict ceremony reveal (culprit named) | verdict/archive view | Rising reveal sting + resolve chord | The magic-moment beat — highest-value single cue |

## Background music (optional, separate from SFX)

- **Loop**: low, tense noir-detective ambience under the dossier/board view,
  ducked during the verdict reveal so the resolve chord reads clearly.
- **Mute control required** if music ships — visible toggle in the client
  header.

## Generation approach (pick one before implementing)

1. **Web Audio synthesis (no asset files)** — paper-tear/peel and
   typewriter-clack sounds are well-suited to short noise-burst + filtered
   oscillator synthesis. Zero generation cost, zero extra files.
2. **ElevenLabs sound-effects generation** — if the dedicated SFX endpoint
   (separate from TTS) is confirmed available, generates more organic
   textures (real paper-tear, real stamp thud). Costs API credits; output
   files need to be committed and bundled by Vite.

Background music (if pursued) would use the `suno-music` skill regardless of
which SFX path is chosen.

## Open decision

Confirm before any implementation work starts:
1. SFX generation method (Web Audio synthesis vs ElevenLabs).
2. Whether background music ships at all, or SFX-only for this pass.
3. Priority order if time runs short — the redaction-peel and the verdict
   reveal are the two cues with real "magic moment" payoff; contradiction/file
   sounds are lower-priority polish.
