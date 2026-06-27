# CLAUDE.md — Poker Trainer

A poker skill-trainer. **Pillar 1**: estimate equity / outs / pot-odds from flop to river.
**Pillar 2**: position, bet sizing, multi-street lines. One engine, two pillars — see below.

Detailed docs live in the repo; this file is the standing constitution. Read these once at session start:
- `HANDOFF.md` — full status, what's built/proven, next steps.
- `contract.ts` — the type seam and all function signatures.

## The core idea (don't lose this)
Pillar 1 is the **depth-zero case of Pillar 2**. Equity-vs-a-hand is the terminal payoff of a
betting tree. So there is ONE engine: the equity calculator (L2) is the **leaf evaluator** of the
game tree (L3). Build once, configure twice.

## Invariants (non-negotiable)
1. `truth(state)` is the ONLY ground-truth entry point the UI and grading may call. It routes:
   empty abstraction → `equity()` (pillar 1); otherwise → `bestResponseEV()` (pillar 2).
2. L2 equity is the leaf of the L3 tree. If they ever diverge, the "one engine" design has leaked.
3. **Villain is always app-declared** (a fixed hand/range, and for pillar 2 a fixed strategy).
   Never infer ground truth from a real or guessed opponent — that's what makes it auto-gradeable.
4. **Grade on EV, never on the dealt result.** A correct call loses ~35% by design. Decisions are
   graded by regret (chips left vs. best line); estimates by error vs. true equity.

## Working discipline
- The test suite is the guardrail. `node engine.test.ts` must stay green
  (currently **70 passing, 0 failing**). Run it before changing anything and after every change.
- Types are also enforced: `npx -p typescript tsc --noEmit` must stay clean (exit 0). This uses
  npx's cache — it adds NO dependency to the repo, keeping the engine a dependency-free ES module.
  `contract.conformance.ts` proves engine.ts matches every signature in contract.ts at compile time.
- The engine runs directly under Node's type-stripping (`node engine.test.ts`); avoid TS features
  stripping can't erase (enums, namespaces, parameter properties) — `erasableSyntaxOnly` guards this.
- Tests assert EXACT, hand-checkable numbers (e.g. 6/44, 0, 0.5). Keep new tests that way.
- Add tests for each new piece BEFORE moving to the next. No untested L3 nodes.
- Plan first on anything non-trivial; once I approve, proceed and check in at real decision points.

## The falsifiable architecture test
**Pillar 1 must keep working with all L3 code deleted.** If a change to the tree turns an L2/pillar-1
test red, stop and fix the leak — do NOT edit the test to make it pass.

## Build order (current → next)
- DONE, proven: L1 (cards + evaluator), L2 (equity/outs), L4 (grading) + AA/KK benchmark.
- DONE, proven: L3 — `bestResponseEV` (expectimax), `bestAction`, `truth()` router, multi-street
  `buildTree`, multiway `fieldEquity` (labelled field approx), authoring-time `validateAbstraction`.
- DONE: TypeScript port against `contract.ts` (strip-only; `tsc --noEmit` clean; conformance-checked).
- DONE: grading seam — `grade(state, response) → Result` + `actionEVs` (estimates by error, decisions
  by regret, structural `leakTag`). This is the `Result`-producing glue the upper layers consume.
- DONE: L5 scheduling — pure SM-2 over `Result` (`resultQuality`, `newReview`, `scheduleReview`,
  `dueReviews`, `nextReview`); injected day-number `now`, no `Date.now()`.
- DONE: L6 content model + session glue — `Drill`/`Session`/`GradeOutcome`, `STARTER_DRILLS`,
  pure `newSession`/`nextDrill`/`gradeDrill` loop. (Fuller curriculum + richer `leakTag` taxonomy TBD.)
- NEXT: L7 UI (CLI vs web — a product fork) + expand L6 content. Consume `truth`/`grade`/`nextDrill` only.
- KNOWN L3 LIMIT: the builder models villain as a fixed call/fold responder (no villain lead/raise,
  so no hero-facing-bet nodes yet). `bestResponseEV` already supports those; extend the builder later.

## Known constraints (don't rediscover these)
- **Preflop enumeration is slow (~123s).** Postflop is instant and is the actual use case. Don't ship
  preflop equity on the current 21-combo evaluator — needs a lookup-table evaluator or precompute.
- `outs` is single-card-to-come, single-hand only. Against ranges, use equity, not outs.
- Multiway (Pillar 2 / P4) is an aggregated-field approximation, not a true N-player tree. Keep it labelled.
- L3 must enforce an abstraction budget (cap sizes × streets) at authoring time, not runtime.

## Pillar-1 module map (for context when building content)
M0 foundations · M1 outs+blockers · M2 rule of 2&4 + correction · M3 pot odds · M3.5 fold equity ·
M4 street sequencing · M5 equity vs range · M5.6 implied odds (pace slow) · M6 calibration.

## Pillar-2 module map
P0 position/realization · P1 preflop ranges · P2 sizing · P3 multi-street lines ·
P4 multiway (approx) · P5 exploit vs balance · P6 EV calibration.
