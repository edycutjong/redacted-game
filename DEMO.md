# DEMO — the 30-second judge path

The whole pitch lands in one interaction: a judge opens the post and within 30
seconds is personally holding a line the crowd has been arguing about since dawn.

## Setup (once, by the mod)

1. Install the app on r/RedactedGame and open the subreddit menu.
2. Run **REDACTED: Seed Demo Case**. This deterministically restores **Case #17 —
   The Larchmont Fire** to its exact mid-solve state:
   - meter at **~61% UNREDACTED**,
   - the first contradiction pair already lit **red** (teaches the mechanic on
     sight),
   - the **pivot pool full** — the pawn-ticket shard `SH31` is reserved for the
     next fresh account, i.e. every judge.
   It is idempotent: run it again any time to reset to the identical state.

## The path a judge walks (record this for the ≤1:00 video)

| t | what they see / do |
|---|---|
| 0–5s | The coffee-stained case folder: `CASE #17 · DAY 3 · 61% UNREDACTED`, amber meter, suspect blurbs. |
| 5–12s | One black bar on their dossier **pulses**. They tap it — the redaction **peels off** with a paper-drag ease and reveals *their* line: "the pawn ticket was dated the 14th — two days AFTER the fire." |
| 12–20s | They switch to the **EVIDENCE BOARD**: ~30 filed cards from founder accounts, and two shards joined by glowing **red string** with the contradiction note. The whole board is stuck arguing about **Dale Moran, the watchman**. |
| **20–24s** | **THE MAGIC MOMENT.** **FILE MY EVIDENCE →** opens the card preview + consent toggle (post as me / via app). One tap **stamps FILED** and the receipt drops in: **CASE METER 61% → 63% · ⚡ YOUR LINE STRUCK DALE MORAN — the board's favorite is off the list · 🔴 RED STRING LIT.** A cold stranger just knocked out the suspect 400 people were fighting over, in one tap. |
| 24–30s | On **ACCUSE**, the suspect lean bars have **shifted** — Moran's bar is struck through; only Ivo Brandt is left standing. "Verdict at 21:00 UTC." |

The realization: *the crowd has been arguing about exactly this line, and the judge
was the one holding it — and filing it visibly struck the suspect by name.*

> This beat is not a hope: the named strike is computed server-side
> (`store.fileCard` → `eliminatedSuspectIds`, rendered at `src/client/main.tsx:356`),
> guaranteed at build time by lint level **LD**, and locked in `tests/store.test.ts`.
> The reserve-aware seed (`core/demoSeed.ts`) leaves Moran standing at exactly 61%
> so *every* fresh judge's reserved pawn-ticket shard strikes him.

## Also worth showing

- **VERDICT / ARCHIVE tab** — the Cold Case Archive replays closed cases against
  their solve timeline, so the ceremony and citation ladder (Beat Cop → Detective →
  Inspector) are demonstrable even with no live case running.
- **Launch Bonus Case** (mod menu) — drops the next case immediately for a live
  0→100% time-lapse.

## If you can only show one thing

Peel → file → **"⚡ YOUR LINE STRUCK DALE MORAN"** → suspect-bar shift. That
four-beat loop, from a fresh account, is the entire game — and the named strike is
the "oh."

## Reproducibility notes

- The seed is deterministic and idempotent (asserted in `tests/store.test.ts`):
  seeding twice yields byte-identical board + meter.
- Every judge account is "first-seen", so the pivot guarantee holds for all of
  them at once — the traffic spike of judging makes the board *better*, not worse.
