# Handoff to Claude Code

## What exists and is proven
- **`engine.ts`** — the engine, ported to TypeScript against `contract.ts` (runs under Node's
  type-stripping; `tsc --noEmit` clean). Every layer whose correctness is pure math:
  - **L1** card model + 5/7-card hand evaluator (`score5`, `score7`, `cmpScore`)
  - **L2** exact equity by enumeration (`equity`, `equityVsRange`, `outs`)
  - **L3** game tree: `bestResponseEV` (expectimax), `bestAction`, `truth()` router, `equityLeaf`,
    multiway `fieldEquity` (labelled aggregated-field approx), `realizationFactor`, multi-street
    `buildTree`, and authoring-time `validateAbstraction` (`ABSTRACTION_LIMITS`)
  - **L4** grading primitives (`breakEven`, `callEV`, `regret`, `decisionRegret`, `estimateError`, `withinBand`, `brier`)
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
node bench.ts                   # optional: AA vs KK (~3 min, see perf note)
```

## What Claude Code builds next (in priority order)
1. **L5 scheduling / L6 content / L7 UI** — consume `Result` and `truth()` only; never branch on pillar.
2. **Richer L3 builder (optional):** the current `buildTree` models villain as a fixed call/fold
   responder (no villain lead/raise, hence no hero-facing-bet nodes yet). `bestResponseEV` already
   supports HERO fold nodes — extend the builder to emit villain bets + hero responses when needed.
3. **Performance:** a 3-street full-betting tree is ~seconds (chance fan-out); the abstraction budget
   caps this at authoring time. Preflop equity still needs a faster evaluator (see below).

## Known issues / decisions to make (honest list)
- **PERFORMANCE: preflop enumeration is slow (~190s for AA vs KK on this machine).** Postflop (flop/turn/river) is instant — that's the trainer's actual use case — but any preflop-equity feature needs either a faster evaluator (lookup-table 7-card evaluator instead of the 21-combo `score5` scan) or precomputed preflop tables. Don't ship preflop equity on the current evaluator.
- **`outs` is single-card-to-come only**, by design (outs blur against ranges / two streets). Don't extend it to ranges — switch to `equity` there, per the pillar-1 spec.
- **The L3 abstraction budget is enforced at authoring time** — DONE via `validateAbstraction` /
  `ABSTRACTION_LIMITS` (caps sizes ≤ 4, streets ≤ 3, sizes × streets ≤ 9; rejects non-contiguous
  streets and board/street mismatches). `buildTree` calls it up front so an intractable tree can't be built.
- **Multiway (P4) is the aggregated-field approximation** (`fieldEquity`: independence across
  players−1 opponents, reduces to exact heads-up) — not a true N-player tree. Kept labelled in code.
- **The falsifiable architecture test:** pillar 1 must keep working with L3 deleted. Keep `truth()`'s empty-abstraction path independent of the tree code.

## The one invariant not to break
`truth()` is the only ground-truth entry point the UI and grading may call. Equity (L2) is the leaf of the tree (L3). If those two ever drift apart, the "one engine" design has leaked.
