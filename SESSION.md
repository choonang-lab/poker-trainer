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
   → bump `CACHE` in `docs/sw.js` (v39 as of this writing) → update
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

- **532 tests passing**, both type-checks clean, deployed bundle in sync.
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
  implied). **Pillar 2 audited (2026-07-18):** 38 drills (P0 ×2, P1 ×3, P2 ×7, P2.5 ×3,
  P3 ×3, P3.4 ×5, P3.5 ×6, P4 ×2, P5 ×7) — P1 gained the AK-vs-AQ domination drill in
  Tier 5, P2 gained 4 sizing-depth drills (bet small / bet big to deny equity / overbet
  a capped range / raise-sizing), a NEW P2.5 "Taking the lead" module (c-bet / donk /
  check-raise), a NEW P3.4 "Barreling" module (value / bluff / give-up), P3 gained the
  `p3-pot-control` drill, a NEW P3.5 "River decisions" module, and Tier-2 moved the
  semi-bluff `p2-bet-or-check` to M3.5. Every best action /
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

## Outstanding for next session (consolidated 2026-07-19)

Single scan of everything still open after 19 shipped items. The numbered "Next up"
log below is a DONE-history with declines interleaved; this section is the live to-do.
Baseline right now: **152 drills, 19 modules, 532 tests, cache v49**, live & in sync.

### A. Addable now — content-only, no engine change (pick any, each ~1 commit)
- **More depth in any module.** The engine supports far more than is authored; every
  new drill is content + an EXPLAIN + a leak mapping. No known gaps in *coverage*, so
  this is polish/volume, not a hole. Good candidates if wanted: a 2nd M4.5 blocker
  drill (board blocker vs hand blocker), more M5 range spots, more P3.4 barrel runouts.
- **Single-combo preflop all-in (jam/fold).** The ONE tractable preflop *decision*
  shape: `streets:["river"]` → one betting round → showdown, no CHANCE (~1s/grade,
  verified AA vs KK → 3-bet). Owner previously SKIPPED a push/fold module as too narrow
  (item 12) — revisit only if a preflop-decision drill is specifically wanted.
- **512px PNG splash icon.** Skipped (SVG covers Android maskable); add only if an
  iOS/splash icon is wanted (item 3).

### B. Declined — do NOT re-investigate (engine-infeasible or a different engine)
The fixed, app-declared villain is what makes every drill auto-gradeable; these all
break that or need a fundamentally different solver. Logged so they aren't re-scoped.
- **Faithful "bet flop, check turn" pot-control LINE** — needs a street-aware villain
  + a pinned turn card; invasive core-seam surgery, big regression surface, low payoff.
  DECLINED (item 5). The *decision* is already taught via a turn-rooted drill
  (`p3-pot-control`), so the content exists — only the faithful two-street line is out.
- **Preflop 3-bet MODULE (cash, with postflop play)** — a 3-bet builds a full
  flop→turn→river tree over an unpruned preflop runout (~1.7M boards); one grade timed
  out >2 min. Intractable → all preflop content stays estimate-only. DECLINED (item 12).
- **Scare-card PINNING** (deterministic CHANCE node in a multi-street tree) — only adds
  fidelity (deriving villain's turn range from flop action vs. declaring it),
  imperceptible to a beginner. DECLINED (item 18). Scare-card *reactions* already ship
  as turn-rooted content (`p34-scare-card-shutdown`).
- **GTO / balance, ICM, true multiway N-player tree** — different engines. P4 multiway
  stays a labelled field approximation on purpose (items 11–14). NOTE: the *balance
  MATH* slice (MDF / bluff frequency) WAS built — see item #20. What stays declined is
  full equilibrium SOLVING: a CFR solver over the existing tree is computable, but it
  breaks Invariant #3 (no fixed villain) AND can't be graded one-click — equilibrium
  play is mixed frequencies whose actions are EV-indifferent, so a deviation loses ≈0
  vs the equilibrium opponent, and the real metric (exploitability) is a property of a
  whole strategy over many hands, not a single decision. Don't re-scope it.
- **Effective-stack / SPR as an engine feature** — engine work, out of scope; SPR-framed
  *content* on existing trees is fine, but a stack-depth solver is not.

### C. Deferred by owner choice — do NOT re-flag
- **2-color deck** — owner prefers the traditional red/black look (item 3). Not a bug.
- **Red-suit contrast tweak (#d62b3a ~4.0:1)** — intentionally NOT applied to preserve
  the card red (item 3).

### D. Platform / infra (from CLAUDE.md "NEXT options")
- **Push notifications** — iOS-limited; not started. App is otherwise feature-complete.
- `.claude/launch.json` still has Windows paths — recreate on Mac if using the launch
  config (a plain `python3 -m http.server` in `docs/` also works — see machine notes).

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
11. ~~**Bet-sizing depth (expand P2)**~~ — DONE 2026-07-18 (cache v32, 412 tests).
   P2 had only ONE real size-choice drill (size-up-nuts). Added 3, all verified,
   each teaching a distinct sizing MOTIVE via a SIZE-DEPENDENT villain (the `policy`
   reads `baseState.pot`, which reflects hero's bet — a supported, realistic use, not
   a hack; real opponents play size-sensitively): (1) `p2-bet-small-thin-value` —
   AsKd top pair; worse aces (weight 3) call small / fold big, a set (weight 1) calls
   anything → bet ⅓ (0.83) > pot (0.50) > check (0.70): size DOWN for thin value.
   (2) `p2-bet-big-deny-equity` — KsKd overpair (73%) vs a flush draw that calls small
   / folds big → bet 1.5× (1.00) > half (0.955) > check (0.73): size UP to deny a
   draw's equity. (3) `p2-overbet-capped-range` — AsTs royal vs a set that calls a pot
   bet and a 2× overbet but folds a 3× → bet 2× (3.0) is best, NOT the 3× (folds him):
   overbet as much as they'll pay, no more (an interior optimum, not "biggest wins").
   Renamed the `P2:overbet` leak `p2.bets_without_equity` → `p2.bets_too_big` so
   sizing leaks read coherently (too_small / too_big / misses_thin_value); updated the
   one test that pinned the old label. KEY ENABLER for future sizing/exploit content:
   a size-dependent villain IS expressible — `policy(combo, state)` gets `state.pot`,
   so "calls small, folds big" is authorable. Browser-verified on mobile.
   FROM the "what decisions are missing" analysis: raise-SIZING choice is now DONE
   (see item 12); c-bet/check-raise/donk drills remain addable (engine supports them —
   content only). GTO/balance, ICM, true multiway = different engines, out of scope by
   design (the fixed app-declared villain is what makes everything auto-gradeable).
12. **Raise sizing — DONE; preflop 3-bet module — DECLINED (infeasible), 2026-07-18.**
   RAISE SIZING (cache v33, 417 tests): added `Abstraction.raiseSizes` (hero's
   raise-size choices as multipliers on the pot-sized raise; default [1.0] is
   byte-identical, so backward-compatible — all raise/re-raise drills unchanged).
   `raiseNode` loops over them for hero; villain raises stay pot-sized. Drill
   `p2-raise-sizing` (AsTs royal facing a pot bet, choose the 3-bet size: 1.5/3.0/6.0
   → best 3.0, the biggest the villain calls; 6.0 folds him). This is a REUSABLE
   engine capability for any "how big to raise" content.
   PREFLOP 3-BET MODULE: DECLINED as engine-infeasible. A 3-bet has postflop play, so
   the engine builds a full flop→turn→river tree; over a PREFLOP runout (no board to
   prune ~1.7M boards) it is intractable — a single grade TIMED OUT at >2 min. This is
   WHY all preflop content is estimate-only (single equity enums). What IS tractable:
   call-or-fold a SHOVE vs a range (~5s/grade — balloons the suite) or single-combo
   jam/fold all-in (~1s/grade, verified: AA vs KK → 3-bet). Owner chose to SKIP the
   push/fold module (too narrow vs the cash 3-bet lines that can't be built). So the
   preflop 3-bet tree joins GTO/ICM/true-multiway on the "different engine, out of
   scope" list. If ever revisited, the only cheap preflop-decision shape is
   single-combo all-in (streets:["river"] → one betting round → showdown, no CHANCE).
13. ~~**Addable named-play drills (c-bet / donk / check-raise)**~~ — DONE 2026-07-18
   (cache v34, 423 tests). NEW module **P2.5 "Taking the lead"** (postflop initiative),
   inserted after P2. All content-only (no engine change — the engine already supports
   these), each verified: (1) `p25-cbet` — AsKs TPTK on Ah8c3d, villain calls a worse
   ace / folds a miss → BET (1.22 > check 0.91): continuation bet. (2) `p25-donk-lead`
   — 9s8s flopped straight on 7h6d5c, lead OOP → BET (0.94 > 0.80): donk a board that
   smashes your hand. (3) `p25-check-raise` — 7s7d bottom set on 7hKc2d facing a c-bet
   (heroFacesBet 0.75) → RAISE (2.80 > call 1.59): check-raise the monster. Added P2.5
   leak mappings (checks_instead_of_betting / flats_instead_of_raising / overfolds).
   Browser-verified: P2.5 on the map after P2; c-bet → "bet 0.75" Optimal, check-raise
   → "raise 2.5" Optimal (the raise-label polish makes the check-raise read cleanly).
   (This was one addable item; barreling followed — see item 14.)
14. ~~**Barreling content**~~ — DONE 2026-07-18 (cache v35, 429 tests). NEW module
   **P3.4 "Barreling"**, inserted BETWEEN P3 and P3.5 (order: P3 → P3.4 → P3.5 → P4).
   Content-only (multi-street postflop trees already work; only PREFLOP multi-street
   is intractable). Turn-rooted bet/check drills, each verified: (1) `p34-value-barrel`
   — AsAd overpair (80%) → BET (1.24 > check 0.80): second barrel for value.
   (2) `p34-bluff-barrel` — KcQc air (14%, BEHIND the pair) but villain FOLDS → BET
   (1.00 > check 0.14): fold equity wins when your hand can't. (3) `p34-give-up` — SAME
   KcQc air, but villain CALLS → CHECK (bet is −0.41). The bluff↔give-up pair is the
   centerpiece discrimination: same hand, barrel when they fold / give up when they
   don't. Added P3.4 leaks (misses_a_barrel / barrels_without_fold_equity). Browser-
   verified on mobile. NOTE from the gap analysis: the villain `policy` CAN be
   street-aware (it receives `state.board`, so `board.length` = street) — so multi-
   street villain lines are authorable without engine work; I'd earlier understated
   this. Remaining gaps (true multiway, GTO, ICM, preflop 3-bet trees, scare-card
   pinning, combo-count question, effective-stack/SPR) are engine work or
   different-engine — see the "what else is missing" outline (chat) for the full map.
15. ~~**Size-response drills (read the bet size)**~~ — DONE 2026-07-18 (cache v36,
   434 tests). From the "addable content" tier. NOTE: M3 already teaches the POT-ODDS
   size response for a DRAW (m3-flush-draw-call pot5/call1 → call; m3-flush-draw-fold
   pot2/call2 → fold). The NEW part is the RANGE-driven version for a BLUFF-CATCHER,
   added to P3.5: `p35-call-small-bet` (KcQd top pair, ⅓ bet from a bluffy range {set +
   busted draw} → CALL 0.50) and `p35-fold-an-overbet` (SAME KcQd, 1.5× overbet from a
   value-heavy range {2 sets + 1 bluff} → FOLD; calling is −0.17). Discrimination pair:
   same hand, the SIZE reads the range — small = bluffy (call), big = value (fold).
   Reuses P3.5 leaks (overfolds_the_river / pays_off_the_river). P3.5 now 6 drills.
   ALSO fixed a UI blemish surfaced here: a chain-computed raise size rendered as
   "raise 1.6600000000000001"; `actionLabel` now does `parseFloat(size.toFixed(2))`
   → "raise 1.66". Browser-verified both.
16. ~~**Street-dependent villain-line drill**~~ — DONE 2026-07-18 (cache v37, 436
   tests). The first drill to USE the street-aware villain (`policy` switches on
   `state.board.length`: 3 = flop, 4 = turn). `p5-exploit-floater` (added to P5): a
   villain that FLOATS the flop (calls, board.length 3) but FOLDS the turn (board.length
   4). Hero KcQc air on 8h 5d 2c, streets [flop, turn] — a genuine multi-street tree.
   Bet the flop AND barrel the turn: he pays the flop while floating, folds the turn,
   you take it. Bet (1.75) > check-then-barrel (1.00); checking misses the exploit
   (p5.misses_exploit). Proves item #2 is content-only — no engine change. P5 now 5
   drills. Browser-verified.
17. ~~**Archetype grab-bag (item #3)**~~ — DONE 2026-07-18 (cache v38, 442 tests).
   3 new archetype drills, content-only: (1) `p2-overbet-bluff` (P2) — KhQh air on the
   river overbets to fold out a bluff-catcher (calls ½, folds 1.5×) -> bet 1.5 (1.0):
   the BLUFF mirror of the value overbet (polarized: overbet nuts AND air). (2/3) a
   PLAYER-TYPE pair in P5: `p5-exploit-maniac` — 8h8d THIRD pair (a normal fold) vs a
   maniac betting 2:1 bluffs -> CALL (raiseCap 0, fold/call); `p5-exploit-nit` — As9s
   two pair (a normal call) vs a nit who only bets the nuts (sets) -> FOLD. The read
   overrides hand strength: call weak vs a maniac, fold strong vs a nit. Added P5 leaks
   (overfolds_vs_a_bluffer / pays_off_a_nit). P2 now 7, P5 now 7. Browser-verified.
   (Skipped from item #3 as too marginal/overlapping: hero-floats, delayed c-bets.)
   All three "addable now" gaps (bet-size read, street-aware line, archetypes) are now
   DONE. Everything remaining (multiway, GTO, ICM, preflop trees, scare-card pinning,
   effective-stack/SPR) is engine work / different-engine, out of scope by
   design — see the "what else is missing" outline in chat for the full map.
   (combo-count was subsequently built — see item #19; it needed only a tiny pure
   helper, not a new engine.)
18. ~~**Scare-card reactions**~~ — DONE 2026-07-18 (cache v39, 446 tests). KEY finding:
   scare-card REACTIONS are CONTENT-only (turn-rooted: the scare card just lives in the
   4-card board). The "scare-card PINNING" engine feature (deterministic CHANCE in a
   multi-street tree) was DECLINED — it only adds fidelity (deriving the villain's turn
   range from the flop action instead of declaring it), imperceptible to a beginner and
   not worth touching the core advance/CHANCE logic. Added 2 drills to P3.4 as a
   discrimination pair: SAME KsKd overpair on Qh 8h 4c — `p34-barrel-a-blank` (turn 2c,
   a brick → BET 1.27) vs `p34-scare-card-shutdown` (turn Ah completes the flush + an
   overcard → CHECK; barreling is −0.69). The turn CARD flips barrel into give-up.
   Browser-verified. So "scare-card pinning" on the remaining-gaps list = declined-engine
   / content-done; the reactions ship without it.
19. ~~**Combo count (combinatorics)**~~ — DONE 2026-07-19 (cache v40, 454 tests, 104
   drills, 18 modules). New `ask:"combos"` response kind + a small PURE helper
   `comboCount(combo, known)` — NOT a new engine, just card-removal counting: a pocket
   pair is C(availA,2), an unpaired hand is availA×availB, where `known` = hero hand +
   board removes cards. grade() compares to the true count (estimate-error style, like
   outs), refined to `m45.overcounts_combos` / `m45.undercounts_combos`. New module
   **M4.5 · Counting combos** (before M5) with 3 drills, all hand-checkable: `m45-combos-
   unpaired` (A-K, no blockers → 16), `m45-combos-pair` (AA, no blockers → 6),
   `m45-combos-blocker` (AA but hero holds the A♠ → 3 — a discrimination pair with the
   prior teaching "your blocker halves their combos"). UI: numeric input, villain render
   suppressed (the target holding is named in the title, not shown as a card). Spot-checks
   pin 16/6/3 and AK-with-A+K-visible=9. Browser-verified all three drills incl. the
   wrong-answer path ("True count: 3 combos · off by 3"). KEY: combinatorics is depth-zero
   pure card-removal — it never touches the L3 tree, so it cost one helper + a Response
   variant, echoing the outs/nuts pattern.
20. ~~**Balance math (the feasible GTO slice)**~~ — DONE 2026-07-20 (cache v41, 464
   tests, 108 drills, 19 modules). Asked "is GTO/balance feasible"; answer was: the
   SOLVER is computable (CFR over the existing tree) but full equilibrium play can't be
   graded one-click (mixed frequencies, EV-indifferent actions, exploitability is a
   whole-strategy property) AND it breaks the fixed-villain invariant — so full GTO stays
   declined (see section B). What IS feasible is the equilibrium CONSTANTS, which are
   pure functions of bet size — the depth-zero slice, exactly like pot odds and combos.
   Built 2 helpers, `minDefenseFreq(pot,bet) = pot/(pot+bet)` and
   `bluffFrequency(pot,bet) = bet/(pot+2*bet)`, plus 2 response kinds (`mdf`, `bluffs`)
   graded by distance to the target. NEW module **M5.7 · Balanced frequencies** (after
   M5.6) with 4 drills forming two discrimination pairs: MDF pot-bet → 50% vs quarter-pot
   → 80% (smaller bet, defend MORE); bluff pot-bet → 33.3% vs half-pot → 25% (smaller bet,
   bluff LESS). Alpha is taught as a concept (= 1 − MDF), NOT a separate drill — it's
   numerically redundant and inviting "which formula do I use" confusion.
   THREE gotchas worth remembering: (1) the two formulas live in ONE module but
   LEAK_TABLE is keyed `MODULE:suffix`, so grade() emits DISTINCT suffixes
   (overdefends/underdefends vs overbluffs/underbluffs) — a shared "overestimate" would
   have conflated them. (2) 33.3% can't be typed exactly, so the mdf/bluffs grade
   branches use a 0.5-point tolerance for the `.ok` tag, and the UI feedback reuses the
   `.ok` tag (not its own threshold) so UI and grading can never disagree. (3) These
   drills have NO board/hero/villain — playDrill got a `freqAsk` branch rendering just
   the scenario ("Villain bets 1 into a pot of 1."), and the empty board would otherwise
   have tripped the preflop "Checking…" defer, so that condition now excludes freqAsk.
   `state.pot` here is the pot BEFORE the bet and `state.toCall` is the bet (differs from
   M3's offered-pot convention — safe because these never reach truth()/the tree).
   Browser-verified all 4 drills incl. the wrong-answer path ("True defend: 80% · off by
   30 pts") and the 33% tolerance case.

21. ~~**Content-quality pass (action-drill EV margins)**~~ — DONE 2026-07-20 (cache
   v42, 466 tests). First guardrail on CONTENT quality rather than engine
   correctness. Audited all 45 action drills for the EV gap between the best action
   and the runner-up — that gap IS the regret a learner eats for picking the sensible
   alternative, so a ~0 gap means the drill grades a coin-flip as a leak and schedules
   reps for guessing. 41 of 45 were clear (>=0.15bb); ONE was a real defect:
   `p2-bet-big-deny-equity` left **0.0455bb** between its two bet sizes while "which
   size?" was the entire lesson (bet 1.5 = 1.0000 vs bet 0.5 = 0.9545).
   FIX: re-authored the spot — hero KsKd on **9h 8h 4s 2c** vs **JhTh**, a 15-out COMBO
   draw (9 hearts + 6 non-heart straight cards, 34.1%) instead of the old 12-out flush
   draw. Now bet 1.5 = 1.0000 / bet 0.5 = 0.8182 / check = 0.6591 → margin **0.1818bb**.
   Bonus: villain's policy is now pot-odds-RATIONAL, which makes the lesson honest —
   facing 0.5 into 1 it needs 25% and has 34.1% (calling correct); facing 1.5 into 1 it
   needs 37.5% and has 34.1% (folding correct). The old villain folded a hand it was
   priced in to call.
   NEW STANDING TESTS (two guards, because a sizing drill's lesson is the SIZE, not
   "bet vs check"): (1) every action drill's best beats the runner-up by >=0.05bb;
   (2) sizing drills (best is a bet, >1 size offered) — best size beats the next-best
   SIZE by >=0.15bb. Guard (2) is the one that catches this failure mode.
   THRESHOLD NOTE: I first proposed 0.15 for guard (1) too, but the data killed it —
   `p2-bet-or-check` (0.068), `p2-bet-small-thin-value` (0.131) and `p25-donk-lead`
   (0.138) are all pedagogically fine, so 0.15 would have forced pointless re-authoring.
   0.05 is the honest floor for "indistinguishable". Also note `p2-bet-small-thin-value`
   looks thin by guard (1) only because its runner-up is CHECK — its actual size
   contrast is 0.33bb, which is why guard (2) is measured over bets only.
   Both guards were PROVEN to fire: temporarily restoring the old spot turned the suite
   red with exactly `p2-bet-big-deny-equity 0.0455` on both, then reverted.

22. ~~**Content batch: +4 drills (combos board-blockers, draw-vs-range, semi-bluff barrel)**~~
   — DONE 2026-07-22 (cache v43, 472 tests, 112 drills, 19 modules — module COUNT
   unchanged, all 4 slot into existing modules). Picked from the SESSION.md "addable now"
   candidates; every value engine-verified BEFORE authoring, no engine change.
   - **M4.5** `m45-combos-board-blocker` (A-K, an ace on the BOARD → 12) and
     `m45-combos-stacked-blockers` (hero holds an ace AND a king is on the board → 9).
     These extend the combos gradient 16→12→9 and, critically, teach that a BOARD card
     blocks combos exactly like one in your hand (the existing blocker drill only showed a
     hand blocker). All exact card-removal, no tree. GOTCHA fixed mid-build: the target
     holding lives in `villain.range` as a rank TEMPLATE — I first wrote `hand("Kh","Qh")`
     (K-Q) so the board ace didn't block it (grade → 16, test caught it); the target must be
     the A-K being counted (`hand("As","Ks")`). comboCount uses only ranks + hero/board as
     `known`, so pick any A/K cards that don't collide with the board.
   - **M5** `m5-flushdraw-vs-toppair` (A♥5♥ nut flush draw vs a top-pair range on Kh 7h 2c →
     45.9%). A draw-vs-made-hand estimate — nine flush + three ace outs over TWO cards make a
     bare draw nearly a coin flip, the complement lesson to the made-hand M5 spots.
   - **P3.4** `p34-semibluff-barrel` (A♥K♥ nut-flush-draw + overs on Qh 8h 3c 2s; villain top
     pair Qc Jd, MIXED policy folds 0.4 / calls 0.6 → bet 0.46 > check 0.34, margin 0.12).
     Distinct from the module's pure bluff (no equity) and value (already ahead) barrels: the
     barrel wins TWO ways — fold equity now + ~15 outs when called. The mixed policy is what
     makes equity-when-called matter (a fold-weight-1 villain would collapse it into the
     existing bluff barrel). Passes both content-quality guards.
   Browser-verified the P3.4 (bet → "Optimal.", flush-draw highlight) and M4.5 board-blocker
   (12 → "Correct — 12 combos") end-to-end via the Review tab; the other two share identical
   UI shapes. Added exact assertions for all four + updated the 108→112 count guard. Also
   corrected `.claude/launch.json` from `python` to `python3` (Mac has no `python`).

23. ~~**Content batch: +5 drills (M5 range depth, a RIVER barrel, a station exploit, set-mining)**~~
   — DONE 2026-07-22 (cache v44, 481 tests, 117 drills, 19 modules — module count unchanged).
   Owner picked "build everything" from a menu spanning P0 / M5 / new-shapes / volume; every
   value engine-verified before authoring, no engine change.
   - **M5** `m5-set-vs-draws` (top set 7c7d on 7h6h2s vs a draw-heavy range → **0.678**) and
     `m5-dominated-flushdraw` (8h9h vs a HIGHER flush draw + a made top pair → **0.295**, vs the
     ~0.35 a clean draw runs). Two distinct textures: "ahead of draws ≠ a lock" and "not all
     draws are equal."
   - **P3.4** `p34-river-barrel` — the NEW SHAPE: a third barrel rooted at the RIVER
     (`streets:["river"]`, one betting round, no CHANCE). Busted JhTh with no showdown value on
     As Kd 5c 2h 3s; villain QQ folds 55% → bet 0.10 > check 0. All prior barrels were turn spots.
   - **P5** `p5-thin-value-station` — exploit a calling station by WIDENING value (bet a hand
     you'd check vs a thinker): As4d weak top pair on Ah9c5d2s vs a no-fold villain → bet 0.75
     (1.61) ≫ check (0.94). The value mirror of the fold-happy exploits.
   - **M1** `m1-set-mining` (6c6d vs two pair → **2 outs**) — the smallest draw, motivating why
     set-mining needs implied odds (links forward to [[M5.6]]).
   - **DROPPED P0** (the menu's top rec): the engine's single-street realization model doesn't
     cleanly express the classic "same draw: call IP / fold OOP" flip — a bare draw realizes the
     SAME either way, and the made-hand variant flips the OTHER way (induce OOP / value-bet IP),
     which would muddy the module's "you realize MORE equity in position" message. The existing
     two P0 drills already teach realization at the level the engine supports. Verified this
     empirically (both directions) before dropping. Also dropped an ace-high-vs-polarized M5 idea
     as too close to the existing `m5-polarized-range`.
   - **CACHE GOTCHA (cost real time):** the in-app preview browser HTTP-caches the bare `app.js`
     URL so hard, that after rebuild + SW-unregister + caches.delete + reload it STILL served the
     old bundle for the bare URL — while a `fetch("app.js?bust="+n)` returned the NEW one (proving
     disk+server+bundle all correct; `curl localhost:5050/app.js` = 123129 bytes with the new id).
     So live browser-verification of the new drills was blocked THIS round by a preview-env cache
     artifact, NOT a code issue. Shipped on: 481 green tests (grading of all 5 verified) + all 5
     reuse UI ask-kinds already screenshotted last round (outs numeric, estimate slider, action
     buttons). Production is unaffected — the SW CACHE bump (v43→v44) is the real invalidation and
     has shipped 40+ times. If future preview verification needs the fresh bundle, load a
     cache-busted URL or accept the fetch-verification.

24. ~~**Thin-module build-out: +9 drills across P4 / P2.5 / P3 / M4**~~ — DONE 2026-07-22
   (cache v45, 496 tests, 126 drills, 19 modules — module count unchanged). After a
   capacity analysis (owner asked "how many more can we add?"; answer: no engine ceiling,
   ~40–60 pedagogically-additive drills left, thinnest modules first), owner said "build out
   the thin modules." Targeted the four thinnest; every value engine-verified before authoring.
   - **P4 multiway** (2→5, all estimates — multiway is field-approx, estimate-ONLY, no tree):
     `p4-tptk-4way` (same TPTK as `p4-strong-multiway` but players=4 → 0.766 vs the 3-way 0.838),
     `p4-overpair-diluted` (AA 3-way → 0.606 from ~0.778 HU), `p4-flushdraw-diluted` (bare FD
     3-way → **0.090** from ~0.299 HU — draws collapse hardest). NOTE: the field model is
     hero_HU_equity^(players−1), so single weak villain combos barely dilute; used realistic
     multi-combo ranges to get instructive numbers.
   - **P2.5 taking the lead** (3→5): added the SEMI-BLUFF twin of the c-bet and the check-raise —
     `p25-cbet-semibluff` (c-bet a flush draw, bet 0.59 > check 0.45) and
     `p25-check-raise-semibluff` (check-raise an OESD+FD, raise 0.57 > flat 0.31). Elegant
     symmetry: each made-hand lead now has a draw counterpart. DROPPED a donk-semibluff — a big
     combo draw realizes too much by checking, so betting only gained ~0.08 (a coin-flip drill).
   - **P3 multi-street lines** (3→5): `p3-value-raise-turn` (raise top two pair for value — the
     NON-nut discrimination with `p3-3bet-the-nuts`) and `p3-3bet-semibluff` (3-bet a big draw,
     villain overpair folds 50%, raise 0.53 > flat 0.02).
   - **M4 street sequencing** (4→6): `m4-three-street-value` (top set, bet flop+turn+river — the
     first THREE-street build; all prior M4 were 2-street) and `m4-thin-value-toppair` (TPTK bets
     two streets thin vs a station). Both vs calling stations (Pillar-1 style, no read needed).
   - VERIFICATION: the magnitude tagger auto-mapped the raise drills' flat→`*.flats_instead_of_
     raising` and the bet drills' check→`*.checks_instead_of_betting`/`misses_street_sequence`;
     confirmed via the 496-green suite (added exact assertions for all 9). Did NOT browser-verify
     live (same preview HTTP-cache artifact as §23) — grading is test-proven and all 9 reuse
     already-screenshotted UI shapes (estimate slider, action buttons incl. raise). Live-site
     byte-sync is the end-to-end proof.
   - REMAINING thin-ish after this: P0 (engine-capped, see §23), M5.7 (2 formulas only), P1
     (~3s/grade, keep few). Everything else is deep; further adds are volume, not coverage.

25. ~~**Volume batch: +8 drills across M1 / M2 / M3 / M5 (deep modules)**~~ — DONE 2026-07-22
   (cache v46, 508 tests, 134 drills). Owner said "let's add volume anyway" after being told the
   thin modules were filled and further adds are variety-not-coverage. Deliberately targeted the
   EXACT / low-risk modules (outs, rule-2&4 equity, pot odds, range equity) so each is trivially
   verifiable and second-instance-of-a-pattern is acceptable here (SM-2 supplies reps; more spots
   = more review variety). All values engine-verified first; no engine change.
   - **M1 outs** (2): `m1-oesd-behind-a-set` (open-ender vs a set = **8**, overcards don't count) and
     `m1-pair-plus-flush-draw` (middle pair + flush draw vs an overpair = **14** = 9 flush + 2 trips
     + 3 two-pair). GOTCHA re-learned: `outs()` is for when hero is BEHIND — a two-pair/set "drawing
     to a boat" spot returns ~40 (it counts cards that KEEP a leading hand ahead), so pick spots
     where hero trails. Also villain cards BLOCK outs (an AA villain removes 2 of your ace outs), so
     choose villain holdings out of the way of the draw for clean teaching numbers.
   - **M2 rule of 2&4** (2): `m2-oesd-flop` (8 outs ×4 ≈ 0.342) and `m2-flushdraw-overcard-turn`
     (flush + a live overcard = 12 outs ×2 ≈ 0.273 — count overcard outs, halve them on the turn).
   - **M3 pot odds** (2): `m3-oesd-call` / `m3-oesd-fold` — the SAME 8-out open-ender (~18%) is a
     call at 6:1 (need ~14%) and a fold at 3:2 (need ~40%). A new draw type for the module's
     price-flip pair (existing pairs were flush-draw and gutshot). NOTE: M3 drills use turn boards
     (4 cards, one card to come), empty abstraction, pot+toCall — grade() compares callEV to fold;
     they're SKIPPED by the action-margin content guard (buildTree on empty-abstraction yields <2
     actions), so no margin tuning needed, just the correct call/fold side.
   - **M5 equity vs range** (2): `m5-overpair-vs-overcards` (TT vs {AK,QJ} ≈ 0.753) and
     `m5-two-pair-vs-draws` (top two on a wet board ≈ 0.702).
   - Added exact assertions for all 8; 508 green. Not browser-verified live (preview HTTP-cache
     artifact, §23) — all reuse screenshotted shapes (outs numeric, estimate slider, call/fold
     buttons); live byte-sync is the proof. This is pure volume — the modules had no coverage gaps.

26. ~~**Volume batch #2: +8 more drills across M1 / M2 / M5**~~ — DONE 2026-07-22 (cache v47,
   518 tests, 142 drills). Owner: "add more volume." Same exact/estimate-only approach; skipped M0
   (16 drills — every nuts/category spot is a near-duplicate now) and M3 (the price-flip pairs are
   covered). All engine-verified first.
   - **M1 outs** (2, both NEW out-counts): `m1-overcards-plus-gutshot` = **10** (a king for the
     straight + BOTH an ace and a ten beat a pair of eights: 4+3+3 — I first mis-counted this as 7,
     forgetting the ten is also an overcard to 88; the engine caught it) and `m1-pair-plus-oesd` =
     **13** (pair of tens + open-ender vs AA: 4+4 straight + 2 trips + 3 two-pair).
   - **M2 rule of 2&4** (3): `m2-gutshot-turn` (0.091), `m2-two-overcards-turn` (0.136), and
     `m2-flushdraw-overcard-flop` (0.481) — the ×4 flop TWIN of last batch's ×2 turn version (0.273),
     a nice flop/turn contrast on the same 12-out draw type.
   - **M5 equity vs range** (3): `m5-set-vs-overpair-range` (bottom set ≈ 0.947 — sets are monsters),
     `m5-nut-flush-vs-two-pair` (≈ 0.909 — even the nuts isn't 100% while the board can pair for a
     boat), `m5-combo-draw-vs-made` (15-out combo draw ≈ 0.519 — 'behind' ≠ 'worse than even money').
   - Running tally: this session added 30 drills (112 → 142) across 4 batches. Out-counts now used in
     M1: 2,3,4,6,8,9,10,12,13,14,15 (missing 5,7,11 — no clean unblocked spot found yet). Deep-module
     volume can continue but is now purely review variety; each new drill still costs suite time +
     an EXPLAIN, so there's a soft practical ceiling around "when the review queue feels rich enough."

27. ~~**Volume batch #3 "where sensible": +7 drills (M5 ×5, M1 ×1, M2 ×1)**~~ — DONE 2026-07-22
   (cache v48, 526 tests, 149 drills). Owner: "more volume where sensible." The sensible read: M5
   (equity vs range) is the one module with large remaining TEXTURE variety, so concentrate there;
   don't force contrived blocker spots elsewhere. All engine-verified first.
   - **M5** (16→21, spread across the equity spectrum): `m5-tptk-vs-mixed-range` (0.860, well ahead),
     `m5-ace-high-vs-wide-range` (0.551, bluff-catcher vs air), `m5-straight-vs-wet-range` (0.955, a
     made hand that still isn't 100%), `m5-middle-pair-vs-range` (0.362, marginal made hand behind),
     `m5-set-vs-big-draw` (0.575, even a set is vulnerable on the wettest board). Deliberately picked
     one spot per equity band so the review queue samples the whole range, not five similar numbers.
   - **M1** `m1-middle-pair-behind` = **5 outs** (finally a CLEAN 5: middle pair vs an overpair →
     2 trips + 3 two-pair, no blocker tricks). Missing M1 out-counts now just 7 and 11.
   - **M2** `m2-flushdraw-gutshot-flop` (0.418) — a flush-draw-plus-gutshot combo, ~a dozen outs ×4.
   - Session total now 37 drills (112 → 149). M5 is still the most extensible for future volume;
     M0/M3/M4/M4.5 are saturated (adding there = near-duplicates). Same live-verification caveat as
     §23–26 (preview HTTP-cache); 526 green + live byte-sync are the proof.

28. ~~**P2 (bet sizing) depth: +3 distinct sizing concepts**~~ — DONE 2026-07-24 (cache v49,
   532 tests, 152 drills). Owner: "P2 drills seem thin." Diagnosis first: P2's sizing AXES were
   actually well-covered (up/down for value, deny equity, overbet value+bluff, raise sizing), so the
   fix was distinct concepts, NOT padding with near-duplicates (which is what makes a module feel
   thin). Verified 5 candidates, shipped the 3 that were both clean AND genuinely new:
   - `p2-bluff-small` — bluff sizing DOWN: villain folds a SIZE-INDEPENDENT fraction, so a 1/3 bet
     (0.47) beats a pot bet (0.20) — bluff the minimum. The explicit mirror of `p2-overbet-bluff`.
   - `p2-protect-flop` — protection sizing on the FLOP (2 cards → draw has the most equity): overpair
     vs a ~15-out combo draw, big (1.0) denies, small (0.375) prices it in. A deliberate flop/turn
     CONTRAST with the turn's `p2-bet-big-deny-equity` (same pattern as M2's flop×4/turn×2 pairs).
   - `p2-small-cbet-dry` — small c-bet / range bet on a dry board: nothing to charge, so 1/3 (1.20)
     beats pot (1.00); worse pairs + floats pay small, fold big.
   - DROPPED (logged so they aren't re-tried): a block-bet (check comes out BETTER than the block in
     a fixed-villain model — the block bet's real value is denying villain's future big bet, which one
     fixed villain hand can't express); a non-nut value overbet and a merge-small value bet (both
     near-duplicates of existing P2 drills, and merge-small also failed the 0.15 sizing-margin guard).
   - Updated the P2 module preface/concepts/objectives to cover the fuller curriculum (added "Range /
     small bet" and "Bluff sizing" concepts). P2 is now 10 drills and conceptually complete for a
     beginner module — further P2 adds would be near-duplicates.

## Machine-specific notes for macOS

- Requires: git, Node ≥ 23 (or 22.7+ with `--experimental-strip-types`) for
  `node engine.test.ts` type-stripping, GitHub CLI (`brew install gh`,
  then `gh auth login` as choonang-lab), no npm install needed — typescript/
  esbuild run via `npx -p` from the npx cache.
- On this Mac, Node **v24.18.0** lives at `~/.local/node/bin` and **is already on
  the login-shell PATH** — run `node` / `npx` bare, with NO prefix. (There is no
  Homebrew / system node; `npx` resolves from the same dir.)
  CORRECTED 2026-07-20: this file previously said Node was NOT on PATH and that
  every command needed `export PATH="$HOME/.local/node/bin:$PATH" && …`. That was
  wrong and it was expensive — the prefix made every command a COMPOUND, which
  defeats exact-match permission allowlisting, so every test/build step prompted
  for approval. Verify with `node -v` before ever re-adding a prefix.
- **Permission allowlist:** `.claude/settings.json` in this repo allows the
  ENTIRE ship checklist to run unattended — `node engine.test.ts`, both `tsc`
  checks, the esbuild bundle build, `git add -A` / `git commit` / `git push
  origin main`, and live-site `curl` polling. Owner opted into full hands-off
  shipping on 2026-07-20 (incl. push to the live public site).
  It only loads when Claude Code has this repo in scope — **start sessions from
  `~/poker-trainer`, not `~`**, or the allowlist is ignored and every step
  prompts again.
  Note the entries are EXACT-match, so they only work with commands run bare
  (no `export PATH=…` prefix — see the Node note above) and with the canonical
  ship-checklist forms. If you change a build flag, update the entry too.
  Still NOT allowlisted by design: `node -e` inline scripts (arbitrary code),
  `rm`, force-push, and pushes to any branch other than `main`.
  `"defaultMode": "auto"` is also set (owner opted in 2026-07-20, upgrading from
  `acceptEdits`): file edits apply without prompting and Bash commands are routed
  through a classifier that allows safe operations and blocks destructive ones,
  instead of every command needing an allowlist entry.
  The `allow` list above is still worth keeping — it's a fast path for the exact
  ship-checklist commands and documents the intended workflow, and it keeps
  working if the mode is ever dialled back.
  WHY NOT `bypassPermissions`: it removes every check, including the one that
  would stop a destructive mistake (`rm -rf`, force-push, a bad path in a
  generated script). `auto` gets ~the same quiet with a backstop.
  NOTE: `auto` has a one-time opt-in dialog the first time it's used on a
  machine (schema field `skipAutoPermissionPrompt` records acceptance) — it was
  deliberately NOT pre-accepted in settings, so accept it yourself once.
- `.claude/launch.json` in this repo has **Windows** paths for the preview
  server; recreate it on Mac (e.g. `python3 -m http.server 5050 --directory
  <repo>/docs`) or just use `python3 -m http.server` directly.
- The Windows machine's Claude memory does not transfer; this file + 
  CLAUDE.md + HANDOFF.md are the full context. Keep SESSION.md updated at
  the end of significant sessions (state, decisions, next-up).
