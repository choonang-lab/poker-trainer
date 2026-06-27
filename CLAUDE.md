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
- DONE: L6 content model + session glue — `Drill`/`Session`/`GradeOutcome`, `STARTER_DRILLS`
  (27 drills covering the FULL map M0–M6 + P0–P6, incl. M0 hand-reading [`ask:"category"`], P1 preflop,
  both M5.6 implied-odds variants, P0 villain-leads, P5 value-vs-raiser / thin-value / check-raise-range,
  P2 sizing, P3 3-bet-the-nuts, and depth across M0/M1/M2/M3/M5/P1/P4), pure
  `newSession`/`nextDrill`/`gradeDrill` loop, and a module-scoped leak taxonomy `classifyLeak`
  (grade() emits structural tags; gradeDrill refines by module). `truth()` is field-aware
  (`fieldEquity`), so multiway (P4) estimate drills grade correctly. (Preflop grades enumerate a full
  runout ~3s — viable as content; the test suite pays it once, in the session-loop test.)
- DONE: L7 CLI trainer (`cli.ts`) — dependency-free (Node readline async-iterator); drives the L6
  session loop end-to-end. Run: `node cli.ts`.
  Smoke (grades the first few drills, then exits at EOF): `printf '0.14\ncall\nbet\n' | node cli.ts`.
  It is the IO boundary, so it's NOT in the `engine.test.ts` unit suite (importing it would read stdin).
- DONE: Persistence — pure `serializeSession`/`loadSession` (only the plain `reviews` are persisted;
  villain `strategy` is a function, so drills are supplied in-code and reviews rehydrate against them).
  `cli.ts` saves to `$POKER_SAVE` (default `.poker-trainer.json`, git-ignored) and uses a real
  day-number `now` (override with `$POKER_NOW` for scripted runs). Progress survives across runs.
- DONE: fast `score7` (direct evaluator, ~60-70x; preflop now ~3s). `score7slow` kept as oracle.
- DONE: P1 preflop drill (AA vs KK) — preflop content now in the curriculum.
- DONE: M6 calibration — pure `calibration(samples)` (Brier + per-bucket reliability) over estimate
  drills; `GradeOutcome.truth` exposes the equity so callers build samples without re-enumerating; CLI
  prints a calibration summary at end of session.
- DONE: P6 EV calibration — pure `leakReport(entries)` aggregates graded results into recurring leaks
  ranked by total regret (excludes `*.ok`); CLI prints a leak-trend summary at end of session.
- DONE: villain-action mechanics — `Abstraction.villainLeads` (villain bets after a hero check),
  `Abstraction.heroFacesBet` (tree roots at hero facing a bet), `Abstraction.raiseCap` (raises up to a
  cap via the recursive `raiseNode`, alternating actors; `villainRaises` = cap 1). All additive &
  flag-gated; default-off preserves hero-as-aggressor, so no existing drill/test changed. Enabled P0
  (IP/OOP), true multi-street implied odds, value-vs-raiser, and 3-bet/re-raise lines.
- DONE: M0 hand-reading — new `ask:"category"` response kind, graded by distance to the true made-hand
  category (`m0.misreads_hand`). Every module M0–M6 + P0–P6 now has at least one drill.
- DONE: added drill depth — M2 big-draw (2&4 correction), M5 wider range, P1 race.
- DONE: magnitude-aware leak tagger — the action tag compares the chosen action to the BEST action, so
  a too-small bet tags as `underbet`, and flatting when raising was best tags as `passive`. Unlocked a
  P2 sizing drill and the P3 3-bet drill.
- DONE: deeper raise trees — recursive `raiseNode` + `raiseCap` (re-raises up to a cap); P3 3-bet drill.
- DONE: range narrowing — `Villain.policy` (per-combo play); the showdown after a villain action reflects
  only the combos that took it, narrowing AGAIN on later streets (multi-street). Policy combos can also
  fold/call/RAISE: the range splits PER ACTION (call→callers, raise→raisers) and hero faces the raise
  via the raise chain. Mixed strategies & weighted ranges were already supported. P5 thin-value +
  check-raise-range drills showcase it. 27 drills.
- NOTE: tags are module+suffix keyed. Each preflop drill costs ~3s. Raises are pot-sized (raiseCap ≤ 4).
- NEXT options: optional web UI; more drills. The engine + curriculum are feature-complete.
- KNOWN L3 LIMIT: the builder models villain as a fixed call/fold responder (no villain lead/raise,
  so no hero-facing-bet nodes yet). `bestResponseEV` already supports those; extend the builder later.

## Known constraints (don't rediscover these)
- **Preflop is now feasible (~3s for AA vs KK).** The direct rank-count/suit-bitmask `score7` replaced
  the 21-subset scan (~60-70x faster, byte-identical results — see `validate-evaluator.ts`). The old
  scan is kept as `score7slow` (the cross-validation oracle). Preflop drills are now viable.
- `outs` is single-card-to-come, single-hand only. Against ranges, use equity, not outs.
- Multiway (Pillar 2 / P4) is an aggregated-field approximation, not a true N-player tree. Keep it labelled.
- L3 must enforce an abstraction budget (cap sizes × streets) at authoring time, not runtime.

## Pillar-1 module map (for context when building content)
M0 foundations · M1 outs+blockers · M2 rule of 2&4 + correction · M3 pot odds · M3.5 fold equity ·
M4 street sequencing · M5 equity vs range · M5.6 implied odds (pace slow) · M6 calibration.

## Pillar-2 module map
P0 position/realization · P1 preflop ranges · P2 sizing · P3 multi-street lines ·
P4 multiway (approx) · P5 exploit vs balance · P6 EV calibration.
