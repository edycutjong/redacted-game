# Authoring a REDACTED case (the Forge guide)

A case is one YAML file in `cases/`. The compiler
(`tools/case-compiler`) turns it into a sealed bundle and the linter proves it is
solvable *before* it can ship. This is the same pipeline a community-authored
**Case Forge** submission passes through, so this file is both the internal
authoring guide and the public Forge spec.

```
npm run lint:cases      # validate + lint every cases/*.yaml (no output written)
npm run compile:cases   # lint, then emit cases/compiled/*.bundle.json + registry.ts
```

## Golden rules

1. **Closed world.** Everything needed to solve the case is inside the file. No
   outside knowledge, no real people, no real places. (This is what keeps it out
   of the "trivia" ban bucket.)
2. **One ground truth, one culprit.** The culprit is the only suspect with **no**
   elimination entry — the deduction engine strikes everyone else, and whoever is
   left standing is guilty.
3. **Redundancy is mandatory.** Every non-culprit must be eliminable ≥2 ways using
   **disjoint** shards, so the case still closes when the crowd only holds a random
   subset. The Monte-Carlo lint (1,000 random 60% deals) enforces this — a case
   that "works if you have all the clues" will fail.

## File skeleton

```yaml
format: 1
id: case-020            # must match /^case-\d{3}$/
number: 20
title: The Something
tagline: A one-line hook.
author: your_handle
era: "Month, Year"
question: Who did the thing?

suspects:               # >= 3
  - { id: S1, name: ..., blurb: ... }

docs:                   # >= 2 — the dossier pages
  - id: E1
    title: EXAMINER'S REPORT
    lines:
      - text: "Public narration the whole crowd can read."
      - shard: SH01     # a censored slot; each shard appears in EXACTLY one line

shards:                 # >= 20 — the dealt clue lines
  - id: SH01
    doc: E1             # must reference a real doc
    text: "The line a player un-redacts. >= 8 chars."
    supports: [G01]     # factIds this shard establishes (optional but usually set)

facts:                  # >= 4 — atomic truths
  - { id: G01, text: "What this fact asserts." }

eliminations:          # one entry per NON-culprit suspect
  - suspect: S1
    paths:              # >= 2 paths; a path is a conjunction of factIds
      - [G01, G07]      # ALL facts on a path must hold to strike the suspect
      - [G03, G08]

contradictions:        # >= 2 annotated shard pairs (the red string)
  - { a: SH38, b: SH39, note: "Why these two cannot both be true." }

pivots: [SH31, ...]    # >= 1 — reserved for first-seen accounts (judges)

reserve: [S2]          # optional (demo cases only) — the crowd-favorite to leave
                       # STANDING at the ~61% seed, so a judge's pivot strikes on
                       # file. Non-culprit ids only. Enforced by the LD lint below.

truth:                 # SERVER-ONLY — split off at compile time, never serialized
  culprit: S4
  motive: "..."
  summary: "..."
  reveal: ["beat one", "beat two"]   # >= 2 ceremony beats
```

## What the linter checks (and how to satisfy it)

**L1 — solvability**
- The culprit must have no `eliminations` entry; every other suspect must have one
  with `paths.length >= 2`.
- Across a suspect's paths there must be **two shard-disjoint completions** — pick
  supports so two independent shard sets can each strike the suspect. Sharing a
  single linchpin shard across all paths fails.
- `MC 1000/1000` must hold: give each fact **multiple supporting shards** and give
  suspects **multiple short paths** so a random 60% of shards still finishes. If MC
  reports `only N/1000`, the sample failure lines name which suspects stayed alive.

**L2 — drama / no orphans**
- ≥2 distinct contradiction pairs, each with a non-empty `note`.
- Every shard must support ≥1 fact that appears on ≥1 elimination path. A shard
  that supports nothing (or a fact no path uses) is an **orphan** — either wire it
  into a fact/path or cut it.

**L3 — safety**
- No profanity, no links/URLs, no `u/name` or `r/name` patterns anywhere in case
  text (titles, blurbs, doc lines, shard text, notes, reveal beats).
- The compiled bundle must be ≤ 200KB.

**LD — demo magic moment** (only when `reserve:` is set)
- On the planned ~61% demo seed (`core/demoSeed.ts`), every reserved suspect must
  still be **standing** (not yet eliminated by the crowd), and at least one
  **pivot** shard must strike each reserved suspect when filed. This proves the
  lone-judge "I am needed" beat at build time — a case whose seed already solves
  itself, or whose pivots are deductively inert, **fails LD**. See case-017 for a
  worked example (`reserve: [S2]`, the watchman the pawn-ticket pivot strikes).

## Structural rules the compiler enforces first

- Unique ids for suspects / docs / shards / facts.
- Each shard is referenced by **exactly one** doc line (this was the real bug that
  broke case-018 during the build — shard `K11` had a definition but no doc line).
- Every `shard.doc`, `shard.supports`, `elimination.suspect`, path factId,
  `contradiction.a/b` and `pivot` references an existing id.
- `truth.culprit` is a real suspect and is **not** in `eliminations`.

## Tips for a case that feels good

- Put the most satisfying clue (the one that completes a crowd-favorite suspect's
  elimination) in `pivots` — it is guaranteed to deal to fresh accounts, so a judge
  who opens the post always holds a line that matters.
- Make one contradiction resolvable by a pivot shard: the crowd argues, the judge
  files the pivot, the red string un-lights. That is the demo moment.
- Keep shard text to a single vivid sentence — it renders as one typeset card.
