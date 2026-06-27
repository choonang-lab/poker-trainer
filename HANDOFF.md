# Handoff to Claude Code

## What exists and is proven
- **`engine.ts`** — the engine, ported to TypeScript against `contract.ts` (runs under Node's
  type-stripping; `tsc --noEmit` clean). Every layer whose correctness is pure math:
  - **L1** card model + 5/7-card hand evaluator (`score5`, `score7`, `cmpScore`). `score7` is a direct
    rank-count/suit-bitmask evaluator (~60-70x faster than the 21-subset scan, byte-identical results);
    the scan is retained as `score7slow`, the cross-validation oracle.
  - **L2** exact equity by enumeration (`equity`, `equityVsRange`, `outs`)
  - **L3** game tree: `bestResponseEV` (expectimax), `bestAction`, `truth()` router, `equityLeaf`,
    multiway `fieldEquity` (labelled aggregated-field approx), `realizationFactor`, multi-street
    `buildTree`, and authoring-time `validateAbstraction` (`ABSTRACTION_LIMITS`)
  - **L4** grading primitives (`breakEven`, `callEV`, `regret`, `decisionRegret`, `estimateError`, `withinBand`, `brier`)
  - **M6 calibration** `calibration(samples)` — Brier + per-bucket reliability over estimate history;
    `gradeDrill` exposes `GradeOutcome.truth` so callers build sample sets without re-enumerating.
  - **Grading seam** `grade(state, response) → Result` + `actionEVs` — estimates graded by error,
    decisions by regret, with a structural `leakTag` (refined later by L6 content). This is the
    `Result`-producing glue L5/L6/L7 consume.
  - **L5** scheduling — pure deterministic SM-2 over `Result` (`resultQuality`, `newReview`,
    `scheduleReview`, `dueReviews`, `nextReview`); `now` is an injected day-number for exact tests.
  - **L6** content model + session glue — `Drill`/`Session`/`GradeOutcome`, a `STARTER_DRILLS`
    set of 12 spanning M1/M2/M3/M3.5/M4/M5/M5.6/P1/P2/P3/P4/P5 (estimate + action, preflop & postflop,
    pillar 1/2, single- & multi-street, multiway, exploit, implied odds), a pure
    `newSession`/`nextDrill`/`gradeDrill` loop, and a module-scoped leak
    taxonomy `classifyLeak` (grade() emits structural tags; gradeDrill refines them into named
    curriculum leaks, e.g. `m5.overrates_vs_range`, with module-scoped fallbacks). `truth()` is
    field-aware (`fieldEquity`) so multiway (P4) estimate drills grade against the field, not heads-up.
- **`cli.ts`** — L7 CLI trainer. Dependency-free (Node readline async-iterator); the IO boundary that
  drives the L6 session loop (present → read → grade → schedule → repeat). Type-checked by `tsc`
  (minimal ambient `node:readline`/`node:fs` decls in `globals.d.ts`); not in the unit suite (it reads stdin).
  Persists progress to `$POKER_SAVE` (default `.poker-trainer.json`, git-ignored) via the pure engine
  primitives `serializeSession`/`loadSession`; `now` is a real day-number (override with `$POKER_NOW`).
- **`engine.test.ts`** — 70 assertions, all passing. Exact/hand-checkable, not approximate:
  - full category ladder (high card → royal), wheel straight, kicker tiebreaks
  - `equity` against exact rationals: straight draw = **6/44**, drawing dead = **0**, chop = **0.5**, made hand = **1.0**
  - L3 identities: CHANCE-of-showdowns **==** `equity` (one-engine), cross-street tree **==** `equity`,
    3-street nuts value-bet **== 14**, fold-equity realization **== 1.5**, multiway field **== 0.25**
  - `outs` flush draw = **9**; pot-odds, regret, and abstraction-budget validation
- **Benchmark:** AA vs KK preflop enumerates to **82.64%** — matches the published ~82%, so the whole pipeline (evaluator + enumeration + tie handling) is validated against reality, not just self-consistency.
- **`contract.ts`** — the type seam, now the implemented interface. `contract.conformance.ts` proves
  at compile time that `engine.ts` matches every declared signature.

## Run it
```
node engine.test.ts            # expect: 70 passed, 0 failed (Node strips types at runtime)
npx -p typescript tsc --noEmit  # expect: exit 0 (type-check; uses npx cache, adds NO repo dependency)
node bench.ts                   # AA vs KK preflop = 82.64% in ~3s (was ~190s pre-fast-evaluator)
node validate-evaluator.ts      # deep cross-check (500k hands) + fast-vs-slow perf (~70x)
node cli.ts                     # smoke: printf '0.14\ncall\nbet\n0.35\n0.95\nbet\nbet\n0.5\nbet\nbet\ncall\n0.83\n' | node cli.ts
```

## What Claude Code builds next (in priority order)
1. **Villain-leads builder extension** — lets villain lead/bet so hero can FACE a bet. Unlocks P0
   realization (IP vs OOP) and a true multi-street implied-odds drill (M5.6 is currently modeled via an
   effective pot, not a real future-street payoff). This is the biggest remaining mechanic; note it will
   change the EVs of existing pillar-2 drills (their check line currently goes straight to showdown).
2. **More L6 drills** — more P1 preflop ranges (~3s each; keep few in the unit suite); M0 needs a new
   (non-equity) drill type for hand-reading. The taxonomy `LEAK_TABLE` grows alongside.
3. **Optional web UI** — adds a framework/build step (breaks dependency-free). The CLI already covers
   L7 end-to-end, with cross-run persistence + calibration.
3. **Optional web UI** — if a browser front-end is wanted later (would add a framework/build step and
   break the dependency-free property). The CLI (`cli.ts`) already covers L7 end-to-end.
   NOTE: the full vertical slice L1–L7 now runs end-to-end (engine → grading → scheduling → session → CLI).
2. **Richer L3 builder (optional):** the current `buildTree` models villain as a fixed call/fold
   responder (no villain lead/raise, hence no hero-facing-bet nodes yet). `bestResponseEV` already
   supports HERO fold nodes — extend the builder to emit villain bets + hero responses when needed.
3. **Performance:** a 3-street full-betting tree is ~seconds (chance fan-out); the abstraction budget
   caps this at authoring time. Preflop equity still needs a faster evaluator (see below).

## Known issues / decisions to make (honest list)
- **PERFORMANCE: RESOLVED.** The direct `score7` made preflop feasible — AA vs KK is now ~3s (was
  ~190s). Cross-validated byte-identical to the old scan (`score7slow`) over 500k hands. Original note:
  preflop enumeration on the 21-combo scan was ~190s for AA vs KK. Postflop (flop/turn/river) is instant — that's the trainer's actual use case — but any preflop-equity feature needs either a faster evaluator (lookup-table 7-card evaluator instead of the 21-combo `score5` scan) or precomputed preflop tables. Don't ship preflop equity on the current evaluator.
- **`outs` is single-card-to-come only**, by design (outs blur against ranges / two streets). Don't extend it to ranges — switch to `equity` there, per the pillar-1 spec.
- **The L3 abstraction budget is enforced at authoring time** — DONE via `validateAbstraction` /
  `ABSTRACTION_LIMITS` (caps sizes ≤ 4, streets ≤ 3, sizes × streets ≤ 9; rejects non-contiguous
  streets and board/street mismatches). `buildTree` calls it up front so an intractable tree can't be built.
- **Multiway (P4) is the aggregated-field approximation** (`fieldEquity`: independence across
  players−1 opponents, reduces to exact heads-up) — not a true N-player tree. Kept labelled in code.
- **The falsifiable architecture test:** pillar 1 must keep working with L3 deleted. Keep `truth()`'s empty-abstraction path independent of the tree code.

## The one invariant not to break
`truth()` is the only ground-truth entry point the UI and grading may call. Equity (L2) is the leaf of the tree (L3). If those two ever drift apart, the "one engine" design has leaked.
