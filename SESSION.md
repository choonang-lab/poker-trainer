# SESSION.md — continuation file for Claude Code

> **If you are Claude Code picking this project up on a new machine:** read
> `CLAUDE.md` (the constitution — non-negotiable invariants), `HANDOFF.md`
> (technical state: what exists, how to run it), then this file (the working
> relationship: conventions, history, and what's next). After reading all
> three you should be able to continue mid-conversation.

## What this project is

A beginner-to-intermediate **poker skill trainer**: a dependency-free
TypeScript engine (exact equity / game-tree / grading / SM-2 spaced
repetition) with a guided-curriculum PWA on top.

- **Live site:** https://choonang-lab.github.io/poker-trainer/
- **Repo:** https://github.com/choonang-lab/poker-trainer (Pages serves `main` /docs)
- **Owner:** GitHub user `choonang-lab`; the user is a beginner poker player
  building this to learn — explanations in app content should assume no
  poker vocabulary.

## Working conventions (established over the sessions — keep these)

1. **Plan first, then build.** For non-trivial features, propose a design for
   the user's review before writing code. The user says things like "for my
   review first" — respect that; otherwise, once a direction is agreed,
   proceed end-to-end without re-asking.
2. **Verify before authoring.** Every drill answer (out counts, equities, best
   actions) is computed against the engine (`outs()`, `equity()`,
   `bestAction()`, `callEV()`) in a throwaway script BEFORE the drill is
   written. Never author a "correct answer" from poker intuition.
3. **Tests are the guardrail.** Exact/hand-checkable numbers, never
   approximate. Suite must stay green; `tsc --noEmit` (engine) and
   `tsc -p web/tsconfig.json` (UI) must stay clean. If a tree change reddens
   a pillar-1 test, fix the leak, don't edit the test.
4. **Non-spoiling drill titles.** Titles describe the visible board/spot
   ("a paired board"), never the answer.
5. **The ship checklist** (after every approved change):
   `node engine.test.ts` → both tsc checks →
   `npx -p esbuild esbuild web/app.ts --bundle --format=esm --minify --outfile=docs/app.js`
   → bump `CACHE` in `docs/sw.js` (v31 as of this writing) → update
   HANDOFF.md counts → commit (message style: `feat(scope): ...` with body,
   end with the Claude co-author line) → push → poll the live site until
   `docs/app.js` byte-size matches. If GitHub Pages sticks in "building",
   force it: `gh api -X POST repos/choonang-lab/poker-trainer/pages/builds`.
6. **Commits are per logical unit** and the user directs when to push; in
   recent sessions "do X" implies ship X (commit+push+verify live) when done.
7. **Curriculum changes live in `curriculum.ts`** (modules, PRIMER, EXPLAIN);
   drills + engine in `engine.ts`; the engine stays pure (web/ and cli.ts
   only consume it). `Drill.read` carries villain-tendency text whenever a
   drill's answer depends on the villain's strategy.
8. **Pedagogy lens for content:** drill count per module is driven by
   pattern coverage, not repetition (SM-2 supplies the reps). Each drill must
   add a new archetype, a discrimination contrast (same hand, different
   price/read), or a second instance of a high-error pattern.

## State as of 2026-07 (commit 6b80618)

- **406 tests passing**, both type-checks clean, deployed bundle in sync.
- **Review fixes (2026-07-18, post-audit), cache v21:** (1) `m2-combo-draw`
  board was `9s 8h 2c` (an 8-out spot, 36.9%) but its title/EXPLAIN teach the
  15-out flush+open-ender combo — fixed to `9s 8s 2c` (56.3%); a learner who
  applied the taught lesson had been graded wrong. Test now pins ~0.563.
  (2) `bestResponseEV` VILL branch consumed villain `strategy` weights RAW
  (unnormalized) — a distribution summing to ≠1 silently scaled EV (2× weights
  → 2× EV). Now normalized by total weight (mirrors `villainPolicyNode`);
  all-zero dist throws. No-op for shipped content (all summed to 1), but closes
  an authoring landmine. Found via a 3-agent read-only review; remaining
  reviewer findings (EXPLAIN accuracy in m3-bad-odds-fold/m3-chop-potodds,
  4-color-deck-is-actually-2-color, double-`truth()` preflop freeze, SW caching
  error responses, a11y) are logged below as Tier 2/3 next-ups.
- **Pillar 1 content complete** (63 drills): M0 hand reading (16 — full 0–8
  category ladder incl. misread traps, a nut-recognition broadway, and 3
  board-only "name the nuts" drills), M1 counting
  outs (11 — gutshot/OESD/overcards/combo/double-gutshot/tainted, second
  instances of high-error types), M2 rule of 2&4 (8 — incl. same-draw flop ×4 vs
  turn ×2 contrast), M3 pot odds (6 — same flush draw call-vs-fold price
  contrast), M3.5 fold equity (6 — incl. the semi-bluff moved from P2 in Tier 2),
  M4 sequencing (4 —
  incl. way-behind check-back), M5 equity vs range (8 — weighted range,
  condensed vs polarized, domination), M5.6 implied odds (4 — now ALL genuine
  multi-street trees after the effective-pot fake was rebuilt as a real OESD
  implied-odds tree; a flush-draw real tree, a no-implied fold, and reverse
  implied). **Pillar 2 audited (2026-07-18):** 20 drills (P0 ×2, P1 ×3, P2 ×2,
  P3 ×3, P3.5 ×4, P4 ×2, P5 ×4) — P1 gained the AK-vs-AQ domination drill in Tier 5,
  P3 gained the `p3-pot-control` check-the-turn drill, a NEW P3.5 "River decisions"
  module (raise / call-thin / bluff-catch / multiway-fold) was added, and Tier-2
  moved the semi-bluff `p2-bet-or-check` to M3.5. Every best action /
  equity re-verified against the
  engine (all correct); de-spoiled the leaky action-drill titles; added a
  villain `read:` to all 10 action drills and EXPLAIN text to every P-drill;
  added a P0 in-position drill (`p0-ip-realize-equity`) — the free-card mirror
  of the OOP check-fold (same 9-out draw realizes 9/44 IP vs 0 OOP). Renamed
  the P0 bet leak to the position-neutral `p0.bets_without_fold_equity`.
  Integrity tests now require an EXPLAIN entry on EVERY drill and a `read:` on
  every Pillar-2 action drill, so the parity can't regress.
- **UI (web/app.ts → docs/):** guided Learn path (module map with lock/
  progress → intro with preface + key terms + objectives + worked example →
  gated lessons with progress bar → recap), Review tab (SM-2 due queue),
  Stats tab (M6 calibration + P6 leak report + streak). "Start here" primer
  (7 sections: rules, hand rankings, pot/blinds, equity). Post-answer
  EXPLAIN text on every Pillar-1 drill. Estimate input accepts 0.36 or 36
  (values >1 read as %). Card tiles: real-card corner index + faint center
  pip (opacity .14), red/black conventional colors, ten shows as "10" (not
  "T"), hole cards fanned, board 28px. Hover styles are wrapped in
  `@media (hover: hover)` (touch sticky-hover fix).
- **Engine notes:** `outs` question kind added for M1 (`Response {kind:
  "outs"}`); pillar-1 call/fold grades through field-aware `fieldEquity`
  (no-op at players=2, kept all pillar-1 drills at 1 villain by design —
  multiway belongs to P4 only).

## Recent decision log (why things are the way they are)

- "T" → "10" everywhere in the DISPLAY layer only; engine keeps "T"
  internally (parseCard, RNAMES, tests untouched).
- Watermark pip opacity was 0.3, user asked for fainter → 0.14.
- The "button stays highlighted on next drill" bug was touch sticky-hover
  (buttons are rebuilt each drill; CSS :hover re-applied at the same
  coordinates). Fixed via hover media queries — if a highlight is ever seen
  again, the next suspect is `:focus-visible`, deliberately left untouched.
- SVG/image card decks were rejected (asset weight, licensing, breaks the
  dependency-free ethos). Two corner indices were rejected (clutter at
  ~27px tiles).
- M1 "backdoor draw" stays concept-only: `outs()` is single-card-to-come by
  design; don't extend it.

## Next up (agreed or suggested, not started)

1. ~~**Pillar 2 audit (P0–P5)**~~ — DONE 2026-07-18 (see "State as of" above).
   Remaining thin spots if more P depth is wanted: P3 has only bet-bet value +
   3-bet lines — a "bet flop, check turn" pot-control contrast would round it
   out (verify a clean EV where the second barrel is −EV before authoring).
2. ~~**Review Tier 2 — EXPLAIN accuracy**~~ — DONE 2026-07-18 (cache v22).
   `m3-bad-odds-fold`: rewrote EXPLAIN — true equity is 1.5% (no straight/flush is
   even possible; only runner-runner two-pair or a set beats the aces), NOT the
   "~15%" it claimed (and not the A♥-flush mechanism a reviewer guessed — verified
   by full runout enumeration). `m3-chop-potodds`: EXPLAIN claimed a board straight
   that doesn't exist — corrected to "both play the identical A-K-Q-J-4."
   `m56-implied-odds-flushdraw`: retitled (it showed the EFFECTIVE pot, so the old
   title "the immediate price doesn't justify" contradicted its own numbers; the
   `read` already flags the pot includes future winnings). `p2-bet-or-check`: it's
   a single-size semi-bluff, so MOVED from P2 (sizing) → M3.5 (fold equity); this
   also fixed its leak label (`p2.misses_thin_value` → `m35.gives_up_fold_equity`).
   Id keeps its legacy "p2-" prefix (stable key). P2 now has 2 sizing drills, M3.5
   has 6. Deeper caveat (LATER RESOLVED — see item 8): the M5.6 `m56-implied-odds-
   flushdraw` faked implied odds via an inflated pot rather than a real tree.
3. ~~**Review Tier 3 — UX/mobile**~~ — DONE 2026-07-18 (cache v23). Fixed:
   estimate feedback reused `out.truth` (was re-enumerating — halved the preflop
   grade wait; browser-verified ~4s = one enumeration, not two) + a "Checking…"
   state on submit; service worker now guards `res.ok` before caching and only
   falls back to index.html for navigations; a11y — `role=status`/`aria-live` on
   feedback, input `aria-label`+`for`/`id`+`inputmode`, 44px nav tap targets,
   `:focus-visible` ring, raw leak tags hidden from per-drill feedback and
   humanized in Stats; iOS icon — added `icon-180.png` (apple-touch-icon) and
   `icon-192.png` (rasterized from icon.svg via canvas), wired into manifest +
   index.html + SW SHELL. All browser-verified on a mobile viewport.
   NOTE: the deck stays **2-color by choice** (owner prefers the traditional look;
   docs corrected — do NOT re-flag). Also DEFERRED by that choice: the red-suit
   contrast tweak (#d62b3a ~4.0:1) was intentionally NOT applied to avoid changing
   the card red. A 512px PNG icon was skipped (SVG covers Android maskable); add
   later if a splash icon is wanted.
4. ~~**Review Tier 4 — robustness**~~ — DONE 2026-07-18 (cache v24, 375 tests).
   Added the mid-equity "one engine" identity test (AK vs a set: a 2-street tree's
   check-line EV == equity() to float precision — NOTE it's `approx`, not `===`;
   the two summation orders differ by ~1e-17, so the reviewer's "===" was wrong).
   Added three authoring guards, each with a throws-test: `outs` rejects a board
   that isn't a flop/turn (3/4 cards — an 8-card `best()` was silently misbehaving);
   `validateAbstraction` rejects multiway (players > 2) with a betting tree (sizes);
   `grade` rejects an estimate response on a non-empty abstraction (would compare a
   [0,1] guess to a bb EV). All guards are no-ops for shipped content (nothing
   violates them) — engine.ts changed, so the bundle was rebuilt to stay in sync.
5. **Coverage (Tier 5) — PARTIALLY DONE 2026-07-18 (cache v25):** added
   `p1-ak-vs-aq` (AKo vs AQo, ~74% — the domination the P1 glossary/example teach;
   suite still ~2s total, the fast score7 makes preflop cheap) and `m0-nut-broadway`
   (hero's ten completes A-K-Q-J-T — a category-4 drill framed on nut recognition,
   serving M0's "spot the nuts" objective). 75 drills now.
   The nut-IDENTIFICATION idea below was later BUILT (see item 7). The pot-control
   idea below was ADDRESSED via a turn-rooted drill (see item 9).
   NOTE on the "bet flop, check turn" pot-control LINE: modelling the two-street line
   FAITHFULLY (engine computes bet-then-check as optimal) doesn't fit cleanly — the
   turn is a CHANCE average (no single scare card) and the per-combo `policy` is
   street-independent, so you can't make flop-bet +EV but turn-bet −EV without a
   street-aware villain + a pinned turn card (invasive core-seam surgery, big
   regression surface, low perceptible payoff). DECLINED — see item 9 for the cheap
   turn-rooted alternative that teaches the same decision without engine changes.
6. ~~**Made-hand highlight**~~ — DONE 2026-07-18 (cache v26, 384 tests). Added two
   pure engine helpers (in `contract.ts` + `engine.ts`, conformance-checked):
   `madeHand(cards)` (best-scoring 5 of 5–7; tested by `score5(madeHand)===score7`)
   and `drawSuit(hero,board)` (suit of a 4-card flush draw, else null). After
   answering, `web/app.ts` rings the made hand's five cards green (only when it's a
   pair+), tints a flush draw's cards blue (flop/turn ONLY — a 4-flush on a 5-card
   board has missed and is not tinted; caught this in browser testing on
   `m0-flush-trap`), dims the rest, and shows a colour legend. Browser-verified on
   mobile across flop/full-board/flush-draw/flush-trap cases.
7. ~~**"Name the nuts" question type**~~ — DONE 2026-07-18 (cache v27, 394 tests).
   New `nuts` response kind end-to-end: `contract.ts` (Response + `ask` + declare),
   `engine.ts` `nutCategory(board)` (enumerate all 2-card holdings, take the max
   category; board 3–5), a `grade()` nuts branch (distance to the nut category →
   `p1.misreads_nuts` → `m0.misreads_nuts`), and `web/app.ts` controls/feedback
   (board-only render, 0–8 buttons, "Best possible hand here?" prompt, feedback
   NAMES the nuts). 3 board-only M0 drills verified against the engine before
   authoring: flush (`As 9s 4s Kd 2c`→5), straight (`Js Td 9c 4h 2s`→4), quads
   (`Ks Kd 8c 5h 2s`→7). NOTE: dry boards are surprisingly straight-prone (A-low →
   wheel, connectors → straights), so verify `nutCategory` before adding any more.
   Watch-out fixed: three test loops graded EVERY M0 drill as `category` (throws on
   board-only nuts drills) — they now pick the response kind per `drill.ask`.
   Browser-verified: correct ("Correct — the nuts is a flush") and wrong ("The nuts
   is a straight · off by 1").
8. ~~**Real implied-odds tree**~~ — DONE 2026-07-18 (cache v28, 395 tests). Replaced
   the last faked drill: `m56-implied-odds-flushdraw` (effective-pot shortcut, a near
   duplicate of `m56-true-implied-odds`) → `m56-implied-odds-oesd`, a GENUINE
   multi-street `heroFacesBet` tree. Hero Th9c on Qd Jc 4h (open-ender, no flush — 3
   of the 4 M5.6 drills were flush draws, so a straight adds variety), villain AhQh
   with the pay-off `callStrat`, `heroFacesBet: 1.5`. Immediate price 37.5% > the
   ~31.5% draw (immediate odds reject), but the turn payoff makes calling +0.36 →
   best=call, fold leaks `m56.folds_with_implied_odds` (verified). No engine change
   was needed — the `heroFacesBet` + multi-street tree already models it; only the
   drill's data + a real-tree test assertion changed. Id renamed (content changed
   fundamentally). Browser-verified: call → "Optimal.".
9. ~~**Pot-control turn drill**~~ — DONE 2026-07-18 (cache v29, 397 tests). The cheap
   alternative to the declined "bet flop, check turn" engine work (item 5): a
   turn-rooted single-decision drill teaches the same lesson with ZERO engine change.
   `p3-pot-control` (P3, which had no check-line drill): hero KsQd = top pair, only a
   king kicker, on Qc 9h 5d 2s. Villain range {AcQh (better, calls), 8s8d (~2 outs,
   near-dead, folds)}, policy call-if-ace. Betting gets called only by the better
   hand and folds out the near-dead one → bets into strength for no value; checking
   realizes showdown value and keeps the pot small. Check (EV 0.511) beats bet
   (0.102); betting tags `p3.overbets_multistreet`. `read` supplies the flop-bet
   backstory. Distinct from `p5-thin-value-vs-range` (same check-is-best mechanic,
   but framed as a multi-street LINE in P3 vs an exploit in P5) and from
   `m4-way-behind-check` (give-up vs a medium hand with showdown value). Verified
   against the engine before authoring; browser-verified (check → "Optimal.", the
   made-hand highlight rings the pair). Only remaining idea: the faithful two-street
   pot-control LINE (item 5), DECLINED as not worth the engine surgery.
10. ~~**River decisions module (P3.5)**~~ — DONE 2026-07-18 (cache v30, 406 tests).
   NEW module inserted after P3 (decimal-insertion like M3.5/M5.6): river call/raise/
   fold, all heads-up `heroFacesBet` river trees (streets ["river"], raiseCap 1). 4
   drills, each verified against the engine before authoring, all on Ac 9d 4s 2c 7h:
   (1) `p35-river-value-raise` — 9h9s set vs a bettor with worse (AK); raise 5 > call
   2 → RAISE. (2) `p35-river-thin-value` — As9s two pair vs {7s7c set, AhKd TP}; a
   raise folds the worse hand and is called only by the set (−1) → CALL (0.5). (3)
   `p35-river-bluff-catch` — AsKd top pair vs a POLARIZED {set, busted KcQc}; CALL to
   catch the bluff. (4) `p35-river-multiway-fold` — SAME AsKd, but `read` = four-way
   so the range is condensed to value (no bluffs) → FOLD. Discrimination contrasts:
   (1 vs 2) raise vs call for value hands; (3 vs 4) same hand → call heads-up, fold
   multiway (THE multiway lesson, via a heads-up-vs-condensed-range tree — no true
   N-player tree needed, consistent with P4's labelled approximation). Added 4 P3.5
   leak mappings (`p35.flats_a_value_raise` / `raises_into_better` / `overfolds_the_
   river` / `pays_off_the_river`). Watch-out: in a heroFacesBet tree the raise action
   carries a CHAIN-COMPUTED size, NOT `{bet,size:1}` — grade the actual action from
   `actionEVs`, don't hardcode it. UI polish (cache v31): `actionLabel` now reads the
   drill's `heroFacesBet` flag and labels an aggressive action "raise" instead of
   "bet" when hero is facing a bet (so heroFacesBet drills read fold/call/raise);
   hero-opens drills still read "bet". Browser-verified both.
   Browser-verified on mobile: P3.5 shows on the map between P3 and P4; value-raise →
   raise "Optimal.", multiway → fold "Optimal.". This was the "4 villains + river"
   idea, delivered as the pragmatic heads-up-vs-condensed-range approximation (a true
   multiway betting tree stays engine-forbidden by the Tier-4 guard, by design).

## Machine-specific notes for macOS

- Requires: git, Node ≥ 23 (or 22.7+ with `--experimental-strip-types`) for
  `node engine.test.ts` type-stripping, GitHub CLI (`brew install gh`,
  then `gh auth login` as choonang-lab), no npm install needed — typescript/
  esbuild run via `npx -p` from the npx cache.
- On this Mac, Node **v24.18.0** lives at `~/.local/node/bin` but is NOT on the
  default PATH. Prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"`
  (there is no Homebrew / system node). `npx` resolves from the same dir.
- `.claude/launch.json` in this repo has **Windows** paths for the preview
  server; recreate it on Mac (e.g. `python3 -m http.server 5050 --directory
  <repo>/docs`) or just use `python3 -m http.server` directly.
- The Windows machine's Claude memory does not transfer; this file + 
  CLAUDE.md + HANDOFF.md are the full context. Keep SESSION.md updated at
  the end of significant sessions (state, decisions, next-up).
