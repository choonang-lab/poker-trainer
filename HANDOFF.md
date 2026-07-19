# Handoff to Claude Code

## What exists and is proven
- **`engine.ts`** — the engine, ported to TypeScript against `contract.ts` (runs under Node's
  type-stripping; `tsc --noEmit` clean). Every layer whose correctness is pure math:
  - **L1** card model + 5/7-card hand evaluator (`score5`, `score7`, `cmpScore`). `score7` is a direct
    rank-count/suit-bitmask evaluator (~60-70x faster than the 21-subset scan, byte-identical results);
    the scan is retained as `score7slow`, the cross-validation oracle.
  - **L2** exact equity by enumeration (`equity`, `equityVsRange`, `outs`). Plus board-analysis
    helpers: `madeHand(cards)` returns the best-scoring 5 of 5–7 (UI highlights a made hand);
    `drawSuit(hero, board)` returns the suit of a 4-card flush draw (else null); `nutCategory(board)`
    returns the category (0–8) of the best hand a board allows (powers the M0 "name the nuts" drills).
  - **L3** game tree: `bestResponseEV` (expectimax), `bestAction`, `truth()` router, `equityLeaf`,
    multiway `fieldEquity` (labelled aggregated-field approx), `realizationFactor`, multi-street
    `buildTree`, and authoring-time `validateAbstraction` (`ABSTRACTION_LIMITS`)
  - **L4** grading primitives (`breakEven`, `callEV`, `regret`, `decisionRegret`, `estimateError`, `withinBand`, `brier`)
  - **M6 calibration** `calibration(samples)` — Brier + per-bucket reliability over estimate history;
    `gradeDrill` exposes `GradeOutcome.truth` so callers build sample sets without re-enumerating.
  - **P6 EV calibration** `leakReport(entries)` — aggregates graded results into recurring leaks ranked
    by total regret (excludes `*.ok`). The decision analogue of M6; CLI prints both at session end.
  - **Grading seam** `grade(state, response) → Result` + `actionEVs` — estimates graded by error,
    decisions by regret, with a structural `leakTag` (refined later by L6 content). This is the
    `Result`-producing glue L5/L6/L7 consume.
  - **L5** scheduling — pure deterministic SM-2 over `Result` (`resultQuality`, `newReview`,
    `scheduleReview`, `dueReviews`, `nextReview`); `now` is an injected day-number for exact tests.
  - **L6** content model + session glue — `Drill`/`Session`/`GradeOutcome`, a `STARTER_DRILLS`
    set of 101 covering the FULL map M0–M6 + P0–P6 (estimate + action + category + outs + nuts, preflop & postflop,
    pillar 1/2, single- & multi-street, multiway, exploit, implied odds, IP/OOP, hand-reading,
    value-vs-raiser, sizing, 3-bet/re-raise, range-narrowing [multi-street, policy raises], check-raise
    range, plus depth in M2/M5/P1), a pure `newSession`/`nextDrill`/`gradeDrill` loop, and a magnitude-aware module-scoped leak
    taxonomy `classifyLeak` (grade() emits structural tags; gradeDrill refines them into named
    curriculum leaks, e.g. `m5.overrates_vs_range`, with module-scoped fallbacks). `truth()` is
    field-aware (`fieldEquity`) so multiway (P4) estimate drills grade against the field, not heads-up.
- **`curriculum.ts`** — the guided "learn" path over the L6 drills (pure data + helpers; no engine
  logic). `MODULES` groups all 101 drills into 17 ordered modules (M0–M5.6 = Pillar 1, P0–P5 = Pillar 2),
  each with a preface, a **key-terms glossary** (`concepts: {term,def}[]`, defining the vocabulary that
  module's lessons use), 3 objectives, and a worked example. `PRIMER` is a 7-section, drill-free
  beginner orientation (how a hand plays out, pot/blinds, hand rankings, equity, how the trainer works)
  surfaced from a "Start here" card on the map. `moduleDone`/`moduleStatus` derive done/current/locked
  from the Session's reviews (a drill is "seen" once graded; modules unlock in array order, so Pillar 2
  gates behind Pillar 1); `currentStreak` counts consecutive active days. Tested in `engine.test.ts`
  (integrity: every drill in exactly one module; every module has well-formed concepts; primer + streak).
- **`web/app.ts`** — L7 web PWA SOURCE: a guided trainer over the same pure seam. Three tabs via a
  bottom nav: **Learn** (module map → intro with preface/objectives/worked example → gated lessons →
  recap; completing a module unlocks the next and drops its drills into review), **Review** (SM-2 over
  drills already learned and due today), **Stats** (modules-completed, streak, M6 calibration, P6 leaks).
  localStorage persistence (`pt-reviews`/`pt-history`/`pt-days`), 2-color cards (conventional red/black).
  After answering, the board + hole cards highlight the made hand's five cards (green ring, via
  `madeHand`) and any flush draw (blue ring, via `drawSuit`, flop/turn only), dimming the rest, with a
  small colour legend. The engine stays clean — `web/` only imports `engine.ts` + `curriculum.ts`.
- **`docs/`** — the DEPLOYED static site (GitHub Pages serves `main` /docs): app shell + PWA bits
  (`manifest.webmanifest`, `sw.js`, `icon.svg` + PNG `icon-180.png`/`icon-192.png` for iOS/Android home-screen) + the committed, minified `docs/app.js` (built from
  `web/app.ts` via esbuild). Installable + offline (the engine is fully client-side). See "Run it".
- **`cli.ts`** — L7 CLI trainer. Dependency-free (Node readline async-iterator); the IO boundary that
  drives the L6 session loop (present → read → grade → schedule → repeat). Type-checked by `tsc`
  (minimal ambient `node:readline`/`node:fs` decls in `globals.d.ts`); not in the unit suite (it reads stdin).
  Persists progress to `$POKER_SAVE` (default `.poker-trainer.json`, git-ignored) via the pure engine
  primitives `serializeSession`/`loadSession`; `now` is a real day-number (override with `$POKER_NOW`).
- **`engine.test.ts`** — 446 assertions, all passing. Exact/hand-checkable, not approximate:
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
node engine.test.ts            # expect: 446 passed, 0 failed (Node strips types at runtime)
npx -p typescript tsc --noEmit  # expect: exit 0 (type-check; uses npx cache, adds NO repo dependency)
node bench.ts                   # AA vs KK preflop = 82.64% in ~3s (was ~190s pre-fast-evaluator)
node validate-evaluator.ts      # deep cross-check (500k hands) + fast-vs-slow perf (~70x)
node cli.ts                     # smoke (grades a few drills, exits at EOF): printf '0.14\ncall\nbet\n' | node cli.ts

# Web PWA (source web/app.ts -> deployed site docs/):
npx -p esbuild esbuild web/app.ts --bundle --format=esm --minify --outfile=docs/app.js  # rebuild the bundle
npx -p typescript tsc -p web/tsconfig.json                                               # type-check the UI (DOM lib)
python -m http.server 5050 --directory docs   # preview; then open http://localhost:5050/

# Deploy (GitHub Pages): push the repo, then Settings -> Pages -> Source: "Deploy from a branch",
# branch=main, folder=/docs. Site appears at https://<user>.github.io/<repo>/ . Paths are relative,
# so the /<repo>/ subpath works. After any engine/UI change, rebuild docs/app.js and commit.
```

## What Claude Code builds next (in priority order)
Every module M0–M6 + P0–P6 has a drill; the engine spans the full betting-tree space (hero-aggressor,
villain-leads, hero-faces-bet, raises with hero re-raises, multi-street, multiway) and villain modeling
(fixed/mixed strategies, weighted ranges, per-combo policies that fold/call/raise with multi-street
range narrowing split per action). The engine is feature-complete.
1. **More L6 drills** — more P1 preflop ranges (~3s each — keep few in the unit suite). Multi-street ~1s each.
2. **Optional web UI** — adds a framework/build step (breaks dependency-free). The CLI already covers
   L7 end-to-end, with cross-run persistence + M6/P6 reports.

## Known issues / decisions to make (honest list)
- **PERFORMANCE: RESOLVED.** The direct `score7` made preflop feasible — AA vs KK is now ~3s (was
  ~190s on the old 21-subset scan). Cross-validated byte-identical to `score7slow` over 500k hands, so
  preflop drills now ship. A single preflop grade is still ~3s, so keep few preflop drills in the suite.
- **`outs` is single-card-to-come only**, by design (outs blur against ranges / two streets). Don't extend it to ranges — switch to `equity` there, per the pillar-1 spec.
- **The L3 abstraction budget is enforced at authoring time** — DONE via `validateAbstraction` /
  `ABSTRACTION_LIMITS` (caps sizes ≤ 4, streets ≤ 3, sizes × streets ≤ 9; rejects non-contiguous
  streets and board/street mismatches). `buildTree` calls it up front so an intractable tree can't be built.
- **Multiway (P4) is the aggregated-field approximation** (`fieldEquity`: independence across
  players−1 opponents, reduces to exact heads-up) — not a true N-player tree. Kept labelled in code.
- **The falsifiable architecture test:** pillar 1 must keep working with L3 deleted. Keep `truth()`'s empty-abstraction path independent of the tree code.

## The one invariant not to break
`truth()` is the only ground-truth entry point the UI and grading may call. Equity (L2) is the leaf of the tree (L3). If those two ever drift apart, the "one engine" design has leaked.
