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
   → bump `CACHE` in `docs/sw.js` (v19 as of this writing) → update
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

- **358 tests passing**, both type-checks clean, deployed bundle in sync.
- **Pillar 1 content complete** (57 drills): M0 hand reading (12 — full 0–8
  category ladder incl. misread traps), M1 counting outs (11 — gutshot/OESD/
  overcards/combo/double-gutshot/tainted, second instances of high-error
  types), M2 rule of 2&4 (8 — incl. same-draw flop ×4 vs turn ×2 contrast),
  M3 pot odds (6 — same flush draw call-vs-fold price contrast), M3.5 fold
  equity (5 — same draw bet-vs-check by villain fold%), M4 sequencing (4 —
  incl. way-behind check-back), M5 equity vs range (8 — weighted range,
  condensed vs polarized, domination), M5.6 implied odds (4 — incl. reverse
  implied). Pillar-2 drills exist (P0–P5, 15 drills) but have NOT had the
  coverage audit.
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

1. **Pillar 2 audit (P0–P5)** — same coverage lens as Pillar 1: verify each
   best action against the engine, add discrimination contrasts, add
   `read:` text to every strategy-dependent drill, write EXPLAIN entries for
   all P-drills (currently Pillar 1 only), de-spoil any leaky titles.
2. **Made-hand highlight** (medium): after answering, highlight which five
   cards form the made hand (M0) or tint the drawing suit (M1/M2). Needs a
   small engine helper to report the winning five cards.
3. Optional: M4 could take one more pot-control archetype; watermark/fan
   angles are one-line CSS tweaks if the user wants them dialed.

## Machine-specific notes for macOS

- Requires: git, Node ≥ 23 (or 22.7+ with `--experimental-strip-types`) for
  `node engine.test.ts` type-stripping, GitHub CLI (`brew install gh`,
  then `gh auth login` as choonang-lab), no npm install needed — typescript/
  esbuild run via `npx -p` from the npx cache.
- `.claude/launch.json` in this repo has **Windows** paths for the preview
  server; recreate it on Mac (e.g. `python3 -m http.server 5050 --directory
  <repo>/docs`) or just use `python3 -m http.server` directly.
- The Windows machine's Claude memory does not transfer; this file + 
  CLAUDE.md + HANDOFF.md are the full context. Keep SESSION.md updated at
  the end of significant sessions (state, decisions, next-up).
