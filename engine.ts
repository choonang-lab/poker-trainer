// Poker Trainer — shared engine (L1, L2, L3, L4). TypeScript port against
// contract.ts; runs directly under Node's type-stripping (`node engine.test.ts`)
// and type-checks with `tsc --noEmit`. Dependency-free ES module.
//
// Card encoding: integer 0..51 = rank*4 + suit
//   rank: 0..12  maps to 2..14 (14 = Ace)
//   suit: 0..3   (arbitrary; only equality and flush grouping matter)

import type {
  Card, Score, Board, Combo, Range, Villain, Abstraction, State,
  Action, NodeState, NodeStrategy, Terminal, TreeNode, Response, Result, Review,
  Drill, Session, GradeOutcome,
} from "./contract.ts";

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const SUITS = [0, 1, 2, 3];

export const card = (rank: number, suit: number): Card => (rank - 2) * 4 + suit;
export const rankOf = (c: Card): number => (c >> 2) + 2;      // c/4 + 2
export const suitOf = (c: Card): number => c & 3;             // c % 4
export const FULL_DECK: Card[] = Array.from({ length: 52 }, (_, i) => i);

// ---- L1: 5-card evaluator -------------------------------------------------
// Returns a comparable score array [category, ...tiebreakers], higher = better.
// Compare two scores with cmpScore(); lexicographic.
//
// categories: 8 SF, 7 quads, 6 full house, 5 flush, 4 straight,
//             3 trips, 2 two pair, 1 pair, 0 high card

function straightHigh(uniqDesc: number[]): number {
  // uniqDesc: distinct ranks, descending. Returns high card of a 5-run, else 0.
  // Handles the wheel A-2-3-4-5 (Ace plays low, high card = 5).
  const set = new Set(uniqDesc);
  for (let i = 0; i + 4 < uniqDesc.length; i++) {
    if (uniqDesc[i] - uniqDesc[i + 4] === 4) return uniqDesc[i];
  }
  if (set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5)) return 5;
  return 0;
}

export function score5(cards: Card[]): Score {
  const ranks = cards.map(rankOf).sort((a, b) => b - a); // desc
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  // rank -> count
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // groups: array of [rank, count], sorted by count desc then rank desc
  const groups: [number, number][] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0]
  );

  const uniqDesc = [...counts.keys()].sort((a, b) => b - a);
  const sHigh = straightHigh(uniqDesc);
  const isStraight = sHigh > 0;

  if (isStraight && isFlush) return [8, sHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2)
    return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...ranks];
  if (isStraight) return [4, sHigh];
  if (groups[0][1] === 3)
    return [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2)
    return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2)
    return [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...ranks];
}

export function cmpScore(a: Score, b: Score): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

// 7-card best: max over C(7,5)=21 five-card subsets.
const C75: number[][] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 5; c++)
        for (let d = c + 1; d < 6; d++)
          for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
  return out;
})();

export function score7(seven: Card[]): Score {
  let best: Score | null = null;
  for (const combo of C75) {
    const s = score5([seven[combo[0]], seven[combo[1]], seven[combo[2]], seven[combo[3]], seven[combo[4]]]);
    if (best === null || cmpScore(s, best) > 0) best = s;
  }
  return best!;
}

// ---- L2: equity by exact enumeration -------------------------------------
function* combinations<T>(arr: T[], k: number): Generator<T[], void, unknown> {
  const n = arr.length, idx = Array.from({ length: k }, (_, i) => i);
  if (k === 0) { yield []; return; }
  if (k > n) return;
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// equity of hero (2 cards) vs villain (2 cards) given board (0,3,4,5 cards).
// Returns hero equity in [0,1] (ties counted as half).
export function equity(hero: Combo, board: Board, villain: Combo): number {
  const known = new Set<Card>([...hero, ...board, ...villain]);
  const unseen = FULL_DECK.filter((c) => !known.has(c));
  const toCome = 5 - board.length;
  let wins = 0, ties = 0, total = 0;
  for (const draw of combinations(unseen, toCome)) {
    const full = [...board, ...draw];
    const h = score7([...hero, ...full]);
    const v = score7([...villain, ...full]);
    const c = cmpScore(h, v);
    if (c > 0) wins++; else if (c === 0) ties++;
    total++;
  }
  return (wins + ties / 2) / total;
}

// equity vs a weighted range: [{combo:[c1,c2], weight}], conflicts skipped.
export function equityVsRange(hero: Combo, board: Board, range: Range): number | null {
  const blocked = new Set<Card>([...hero, ...board]);
  let acc = 0, wsum = 0;
  for (const { combo, weight } of range) {
    if (combo.some((c) => blocked.has(c))) continue;
    acc += weight * equity(hero, board, combo);
    wsum += weight;
  }
  if (wsum === 0) return null;
  return acc / wsum;
}

// outs: count single next cards that make hero best vs a FIXED villain hand.
// Defined for one card to come from the current board (board length 3 or 4).
export function outs(hero: Combo, board: Board, villain: Combo): number {
  const known = new Set<Card>([...hero, ...board, ...villain]);
  const unseen = FULL_DECK.filter((c) => !known.has(c));
  let n = 0;
  for (const c of unseen) {
    const hScore = best([...hero, ...board, c]);
    const vScore = best([...villain, ...board, c]);
    if (cmpScore(hScore, vScore) > 0) n++;
  }
  return n;
}
function best(cards: Card[]): Score {
  // best hand from 5,6, or 7 cards
  if (cards.length === 5) return score5(cards);
  if (cards.length === 7) return score7(cards);
  // 6 cards: max over C(6,5)
  let bestS: Score | null = null;
  for (let skip = 0; skip < 6; skip++) {
    const five = cards.filter((_, i) => i !== skip);
    const s = score5(five);
    if (bestS === null || cmpScore(s, bestS) > 0) bestS = s;
  }
  return bestS!;
}

// ---- L4: grading primitives ----------------------------------------------
export const breakEven = (pot: number, call: number): number => call / (pot + call);

// pillar-1 decision EV (call vs fold), pot-relative in chips.
export const callEV = (eq: number, pot: number, call: number): number => eq * pot - (1 - eq) * call;

// regret of chosen action given EV-by-action map (bb or chips). 0 = optimal.
export function regret(evByAction: Record<string, number>, chosen: string): number {
  const best = Math.max(...Object.values(evByAction));
  return best - evByAction[chosen];
}

// pillar-1 convenience: regret of a call/fold decision.
export function decisionRegret(eq: number, pot: number, call: number, chosen: "call" | "fold"): number {
  return regret({ call: callEV(eq, pot, call), fold: 0 }, chosen);
}

export const estimateError = (estimate: number, truth: number): number => Math.abs(estimate - truth);
export const withinBand = (estimate: number, truth: number, band: number): boolean =>
  estimateError(estimate, truth) <= band;

// Brier-style score over samples of {estimate, truth} (continuous target).
export function brier(samples: { estimate: number; truth: number }[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((s, { estimate, truth }) => s + (estimate - truth) ** 2, 0) / samples.length;
}

// ---- L3: game tree (expectimax, villain fixed) ---------------------------
// EV convention: NET CHIPS from the current node, in bb.
//   EV = (expected chips hero collects at hand end) - (chips hero voluntarily
//        puts in after this node).
// Terminal payoffs (heroInvested = hero's post-node contribution on this line):
//   showdown      : fieldEquity(state) * pot - heroInvested
//   villain folds : pot - heroInvested      (villain's dead money is the profit)
//   hero folds    : -heroInvested           (0 if hero folds without first calling)
// INVARIANT: the showdown leaf IS the L2 evaluator. equityLeaf delegates the
// runout integration + per-combo blocking to equity()/equityVsRange(), so the
// builder never re-enumerates the board (that would double-count). A CHANCE node
// that fans out per-card showdowns equals the integrated leaf by the law of
// total expectation — proven exactly in the tests.

const NO_ABSTRACTION_CONST: Abstraction = { sizes: [], streets: [], players: 2 };
export const NO_ABSTRACTION: Abstraction = NO_ABSTRACTION_CONST;

// The leaf evaluator: hero's raw equity at a (possibly incomplete) board.
export function equityLeaf(state: NodeState): number | null {
  const { heroHand, heroRange, board, villain } = state;
  if (heroHand) return equityVsRange(heroHand, board, villain.range);
  if (heroRange) {
    let acc = 0, wsum = 0;
    for (const { combo, weight } of heroRange) {
      const e = equityVsRange(combo, board, villain.range);
      if (e === null) continue;
      acc += weight * e; wsum += weight;
    }
    return wsum === 0 ? null : acc / wsum;
  }
  return null;
}

// Multiway showdown leaf (aggregated-field APPROXIMATION, see CLAUDE.md P4).
//   players <= 2 : exact 2-player equity (reduces to equityLeaf).
//   players  > 2 : hero must beat the whole field; approximated as independence
//                  across (players-1) opponents drawn from the same range.
// This is NOT a true N-player tree — it is the labelled field approximation.
export function fieldEquity(state: NodeState): number | null {
  const base = equityLeaf(state);
  if (base === null) return null;
  const n = state.players ?? state.abstraction?.players ?? 2;
  return n <= 2 ? base : Math.pow(base, n - 1);
}

// Two Actions are the same legal option (bet sizes must match).
function sameAction(a: Action | undefined, b: Action | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "bet" && b.kind === "bet" ? a.size === b.size : true;
}

function terminalEV(node: TreeNode): number {
  const t: Terminal = node.terminal ?? { type: "showdown", heroInvested: 0 };
  const heroInvested = t.heroInvested || 0;
  if (t.type === "fold") {
    return t.folder === "villain" ? node.state.pot - heroInvested : -heroInvested;
  }
  return (fieldEquity(node.state) ?? 0) * node.state.pot - heroInvested;
}

// Best-response EV via expectimax. Pure walker over a built tree.
export function bestResponseEV(node: TreeNode): number {
  switch (node.kind) {
    case "TERM":
      return terminalEV(node);
    case "CHANCE": {
      const kids = node.children ?? [];
      const evs = kids.map((ch) => bestResponseEV(ch.node));
      return evs.reduce((a, b) => a + b, 0) / evs.length;
    }
    case "HERO":
      return Math.max(...(node.children ?? []).map((ch) => bestResponseEV(ch.node)));
    case "VILL": {
      // Villain follows its fixed declared strategy: EV = Σ p(a)·EV(child).
      const kids = node.children ?? [];
      const strat = node.state.villain.strategy;
      if (!strat) throw new Error("VILL node requires villain.strategy");
      const legal: Action[] = kids.map((ch) => ch.action!).filter(Boolean);
      const dist = strat(node.state, legal);
      let ev = 0;
      for (const { action, weight } of dist) {
        if (weight === 0) continue;
        const child = kids.find((ch) => sameAction(ch.action, action));
        if (child) ev += weight * bestResponseEV(child.node);
      }
      return ev;
    }
    default:
      throw new Error(`bestResponseEV: unhandled node kind ${node.kind}`);
  }
}

// Multi-street tree builder for pillar 2.
// Model: hero is the actor; villain follows a fixed declared call/fold strategy
// when facing a bet (villain leading/raising is a future extension). Each street
// is a betting round; between betting streets a CHANCE node deals the next card
// so hero's and villain's decisions can be card-dependent. The final showdown
// leaf delegates any remaining runout to the L2 evaluator (fieldEquity), so the
// builder only enumerates the cards that betting actually branches on — never
// double-counting the leaf's own integration.
//   HERO: { check -> advance, bet(s) -> VILL { fold -> TERM, call -> advance } }
//   advance: more streets -> CHANCE(next card) -> next HERO round; else showdown
// The abstraction budget is enforced at AUTHORING time (validateAbstraction).

const STREET_LEN: Record<"flop" | "turn" | "river", number> = { flop: 3, turn: 4, river: 5 };

// Authoring-time abstraction budget. Caps tree size (sizes × streets) so a drill
// can never build an intractable tree at runtime. Validate when content is
// authored, not when the user opens it.
export const ABSTRACTION_LIMITS = { maxSizes: 4, maxStreets: 3, maxSizeStreetProduct: 9 };

export function validateAbstraction(abstraction: Abstraction, board: Board = []): boolean {
  const { sizes, streets, players } = abstraction;
  if (!Number.isInteger(players) || players < 2)
    throw new Error(`abstraction.players must be an integer >= 2 (got ${players})`);
  if (sizes.length === 0) return true; // pillar 1: no tree to bound
  for (const s of sizes)
    if (!(s > 0)) throw new Error(`bet sizes must be > 0 (got ${s})`);
  if (sizes.length > ABSTRACTION_LIMITS.maxSizes)
    throw new Error(`too many bet sizes: ${sizes.length} > ${ABSTRACTION_LIMITS.maxSizes}`);
  if (streets.length === 0)
    throw new Error(`abstraction with bet sizes must declare at least one street`);
  if (streets.length > ABSTRACTION_LIMITS.maxStreets)
    throw new Error(`too many streets: ${streets.length} > ${ABSTRACTION_LIMITS.maxStreets}`);
  if (sizes.length * streets.length > ABSTRACTION_LIMITS.maxSizeStreetProduct)
    throw new Error(
      `abstraction too large: sizes×streets = ${sizes.length * streets.length} > ${ABSTRACTION_LIMITS.maxSizeStreetProduct}`);
  const order: ("flop" | "turn" | "river")[] = ["flop", "turn", "river"];
  for (const st of streets)
    if (!order.includes(st)) throw new Error(`unknown street: ${st}`);
  for (let i = 0; i + 1 < streets.length; i++)
    if (order.indexOf(streets[i + 1]) !== order.indexOf(streets[i]) + 1)
      throw new Error(`streets must be contiguous & ascending: ${streets.join(",")}`);
  if (board.length && STREET_LEN[streets[0]] !== board.length)
    throw new Error(
      `first street ${streets[0]} expects board length ${STREET_LEN[streets[0]]}, got ${board.length}`);
  return true;
}

interface Ctx {
  heroHand?: Combo;
  heroRange?: Range;
  board: Board;
  pot: number;
  villain: Villain;
  players: number;
  abstraction: Abstraction;
  sizes: number[];
  heroInvested: number;
}

function nodeState(ctx: Ctx, extra: Partial<NodeState>): NodeState {
  return {
    heroHand: ctx.heroHand, heroRange: ctx.heroRange,
    board: ctx.board, pot: ctx.pot, villain: ctx.villain,
    players: ctx.players, abstraction: ctx.abstraction,
    ...extra,
  };
}

function showdownLeaf(ctx: Ctx): TreeNode {
  return {
    kind: "TERM",
    terminal: { type: "showdown", heroInvested: ctx.heroInvested },
    state: nodeState(ctx, { toAct: "chance" }),
  };
}

// Cards removed from the chance deal: the board, hero's known cards, and — when
// villain is a single fixed hand — villain's cards (exact card removal). With a
// multi-combo range we exclude only board+hero and let the leaf block per combo.
function chanceExclusions(ctx: Ctx): Set<Card> {
  const ex = new Set<Card>(ctx.board);
  if (ctx.heroHand) for (const c of ctx.heroHand) ex.add(c);
  if (ctx.villain.range && ctx.villain.range.length === 1)
    for (const c of ctx.villain.range[0].combo) ex.add(c);
  return ex;
}

// After a betting round closes: deal the next street (CHANCE) or show down.
function advance(ctx: Ctx, rest: ("flop" | "turn" | "river")[]): TreeNode {
  if (rest.length === 0) return showdownLeaf(ctx);
  const ex = chanceExclusions(ctx);
  const unseen = FULL_DECK.filter((c) => !ex.has(c));
  const children = unseen.map((c) => ({
    node: buildStreet({ ...ctx, board: [...ctx.board, c] }, rest),
  }));
  return { kind: "CHANCE", state: nodeState(ctx, { toAct: "chance" }), children };
}

// One hero betting round on streets[0], then advance over streets.slice(1).
function buildStreet(ctx: Ctx, streets: ("flop" | "turn" | "river")[]): TreeNode {
  const rest = streets.slice(1);
  const children: { action?: Action; node: TreeNode }[] = [];

  // Check line: hero invests nothing; the round closes.
  children.push({ action: { kind: "check" }, node: advance(ctx, rest) });

  // Bet lines: one per declared pot-relative size.
  for (const s of ctx.sizes) {
    const bet = s * ctx.pot;
    const invAfterBet = ctx.heroInvested + bet;
    const villState = nodeState({ ...ctx, pot: ctx.pot + bet }, { toAct: "villain" });
    const calledCtx: Ctx = { ...ctx, pot: ctx.pot + 2 * bet, heroInvested: invAfterBet };
    const villNode: TreeNode = {
      kind: "VILL",
      state: villState,
      children: [
        { action: { kind: "fold" },
          node: { kind: "TERM", state: villState,
                  terminal: { type: "fold", folder: "villain", heroInvested: invAfterBet } } },
        { action: { kind: "call" }, node: advance(calledCtx, rest) },
      ],
    };
    children.push({ action: { kind: "bet", size: s }, node: villNode });
  }

  return { kind: "HERO", state: nodeState(ctx, { toAct: "hero" }), children };
}

export function buildTree(state: State): TreeNode {
  validateAbstraction(state.abstraction, state.board);
  const ctx: Ctx = {
    heroHand: state.heroHand, heroRange: state.heroRange,
    board: state.board, pot: state.pot, villain: state.villain,
    players: state.abstraction.players ?? 2,
    abstraction: state.abstraction,
    sizes: state.abstraction.sizes,
    heroInvested: 0,
  };
  return buildStreet(ctx, state.abstraction.streets);
}

// The single ground-truth entry point. UI/grading call ONLY this.
//   empty abstraction -> equity()/equityVsRange() leaf  (pillar 1, no tree)
//   otherwise         -> bestResponseEV(buildTree(state)) (pillar 2)
export function truth(state: State): number {
  // Degeneracy guard (both pillars): no villain combo possible ⇒ malformed drill.
  // Fail loud at the entry point rather than propagating a null into grading/UI.
  // fieldEquity is the leaf (reduces to heads-up equity for players <= 2, and is
  // the aggregated-field approximation for multiway estimate drills).
  const e = fieldEquity(state);
  if (e === null)
    throw new Error("truth: no valid villain combo for this spot (empty or fully blocked range)");
  if (state.abstraction.sizes.length === 0) return e;
  return bestResponseEV(buildTree(state));
}

// Equity realization, DERIVED (not hardcoded): tree-EV / raw all-in equity.
//   raw all-in EV = realize full equity at the current pot, no further chips in.
//   tree-EV       = what hero actually nets given the betting (fold equity, etc).
// Pillar 1 / depth-0 realizes exactly its equity, so the factor is 1. Fold
// equity pushes it above 1; poor realization (folding out equity) below 1.
export function realizationFactor(state: State): number {
  const fe = fieldEquity(state);
  if (fe === null)
    throw new Error("realizationFactor: no valid villain combo for this spot");
  const allInEV = fe * state.pot;
  if (allInEV === 0)
    throw new Error("realizationFactor: undefined when raw all-in equity is 0 (no equity/pot to realize)");
  const treeEV = state.abstraction.sizes.length === 0
    ? allInEV
    : bestResponseEV(buildTree(state));
  return treeEV / allInEV;
}

// Argmax over a HERO node's actions (deterministic first-max tiebreak).
export function bestAction(node: TreeNode): Action {
  let best: Action | null = null, bestEV = -Infinity;
  for (const ch of node.children ?? []) {
    const ev = bestResponseEV(ch.node);
    if (ev > bestEV) { bestEV = ev; best = ch.action ?? null; }
  }
  return best!;
}

// ---- Grading: (state, response) -> Result --------------------------------
// Estimates are graded by error vs true equity; decisions by regret vs the best
// line (invariant 4). One seam so L5/L6/L7 never branch on pillar — only on
// estimate-vs-action. leakTag is a minimal, STRUCTURAL classification; the real
// taxonomy belongs to L6 content (which can refine these tags).

const GRADE_BAND = 0.05; // equity tolerance for an estimate to count as "ok"

// Per-action EVs at a HERO node (expects a HERO node; children carry actions).
export function actionEVs(heroNode: TreeNode): { action: Action; ev: number }[] {
  return (heroNode.children ?? []).map((ch) => ({ action: ch.action!, ev: bestResponseEV(ch.node) }));
}

// The legal actions + EVs for a decision drill. Pillar 1 (empty abstraction) is
// a call/fold facing state.toCall; pillar 2 reads them off the built tree's root.
function decisionEVs(state: State): { action: Action; ev: number }[] {
  if (state.abstraction.sizes.length === 0) {
    const eq = equityLeaf(state);
    if (eq === null) throw new Error("grade: no valid villain combo for this spot");
    if (state.toCall === undefined)
      throw new Error("grade: a pillar-1 call/fold drill requires state.toCall");
    return [
      { action: { kind: "fold" }, ev: 0 },
      { action: { kind: "call" }, ev: callEV(eq, state.pot, state.toCall) },
    ];
  }
  return actionEVs(buildTree(state));
}

function estimateLeak(error: number): string {
  if (Math.abs(error) <= GRADE_BAND) return "p1.ok";
  return error > 0 ? "p1.overestimate" : "p1.underestimate";
}

function actionLeak(state: State, action: Action, regretBb: number): string {
  const p = state.abstraction.sizes.length === 0 ? "p1" : "p2";
  if (regretBb <= 1e-9) return `${p}.ok`;
  const tag: Record<Action["kind"], string> = {
    fold: "overfold", call: "spew", check: "missed_bet", bet: "overbet",
  };
  return `${p}.${tag[action.kind]}`;
}

export function grade(state: State, response: Response): Result {
  if (response.kind === "estimate") {
    const t = truth(state); // throws on a malformed spot
    const error = response.value - t;
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: estimateLeak(error) };
  }
  const evs = decisionEVs(state);
  const chosen = evs.find((e) => sameAction(e.action, response.action));
  if (!chosen) throw new Error(`grade: illegal action ${JSON.stringify(response.action)} for this spot`);
  const best = Math.max(...evs.map((e) => e.ev));
  const regretBb = best - chosen.ev;
  return { regretBb, leakTag: actionLeak(state, response.action, regretBb) };
}

// ==== L5: scheduling (spaced repetition over Result) ======================
// Pure, deterministic SM-2 over a continuous grade. `now` is an injected
// day-number (never Date.now()) so schedules are exactly testable. Consumes ONLY
// Result (never branches on pillar): estimate drills grade by estimateError,
// decision drills by regretBb (bb is already a normalized unit).

const EASE_MIN = 1.3;
const EASE_START = 2.5;
const Q_ESTIMATE: [number, number][] = [[0.02, 5], [0.05, 4], [0.10, 3], [0.20, 2]]; // err <= k -> q
const Q_ACTION: [number, number][] = [[0.001, 5], [0.25, 4], [0.5, 3], [1.0, 2]];     // regret <= k -> q

// Map a Result to an SM-2 quality 0..5 (q < 3 is a lapse).
export function resultQuality(result: Result): number {
  if (result.estimateError !== undefined) {
    for (const [k, q] of Q_ESTIMATE) if (result.estimateError <= k) return q;
    return 1;
  }
  for (const [k, q] of Q_ACTION) if (result.regretBb <= k) return q;
  return 1;
}

export function newReview(id: string, now = 0): Review {
  return { id, ease: EASE_START, reps: 0, intervalDays: 0, lapses: 0, due: now };
}

// SM-2 update. Success (q>=3) expands the interval by the ease factor; a lapse
// (q<3) resets to 1 day and bumps the lapse count. Ease always re-derives from q.
export function scheduleReview(item: Review, result: Result, now: number): Review {
  const q = resultQuality(result);
  const ease = Math.max(EASE_MIN, item.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (q < 3) {
    return { ...item, ease, reps: 0, intervalDays: 1, lapses: item.lapses + 1, due: now + 1 };
  }
  const reps = item.reps + 1;
  const intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(item.intervalDays * ease);
  return { ...item, ease, reps, intervalDays, due: now + intervalDays };
}

// Items due at `now`, most overdue first.
export function dueReviews(items: Review[], now: number): Review[] {
  return items.filter((i) => i.due <= now).sort((a, b) => a.due - b.due);
}

export function nextReview(items: Review[], now: number): Review | null {
  const due = dueReviews(items, now);
  return due.length ? due[0] : null;
}

// ==== L6: content model + session glue ====================================
// A Drill is an authored spot (a State) + presentation metadata + which response
// the user gives. A Session bundles a drill library with per-drill scheduling
// state. The loop is pure: nextDrill picks what to show, gradeDrill grades +
// reschedules and returns a NEW Session. No UI/persistence here (that's L7).

// STARTER_DRILLS is defined at the end of the file (it calls the card-authoring
// helpers `hand`/`parseCard`, which are declared in the helpers section below).

export function newSession(drills: Drill[]): Session {
  return { drills, reviews: {} };
}

// The next drill to show: due reviews first (most overdue), unseen drills treated
// as due at `now` so new content surfaces once nothing is overdue. null if idle.
export function nextDrill(session: Session, now: number): Drill | null {
  const due = session.drills
    .map((d) => ({ d, due: session.reviews[d.id]?.due ?? now }))
    .filter((x) => x.due <= now)
    .sort((a, b) => a.due - b.due);
  return due.length ? due[0].d : null;
}

// Named, module-specific leaks keyed by `${module}:${structural-suffix}`. Where a
// module isn't mapped, classifyLeak falls back to a module-scoped structural tag.
const LEAK_TABLE: Record<string, string> = {
  "M1:overestimate": "m1.overcounts_outs",
  "M1:underestimate": "m1.undercounts_outs",
  "M2:overestimate": "m2.overestimates_equity",
  "M2:underestimate": "m2.underestimates_equity",
  "M5:overestimate": "m5.overrates_vs_range",
  "M5:underestimate": "m5.underrates_vs_range",
  "M3:overfold": "m3.folds_when_priced_in",
  "M3:spew": "m3.calls_when_overpriced",
  "M3.5:missed_bet": "m35.gives_up_fold_equity",
  "M4:missed_bet": "m4.misses_street_sequence",
  "P2:missed_bet": "p2.misses_thin_value",
  "P2:overbet": "p2.bets_without_equity",
  "P3:missed_bet": "p3.misses_multistreet_value",
  "P3:overbet": "p3.overbets_multistreet",
  "P4:overestimate": "p4.overrates_field",
  "P4:underestimate": "p4.underrates_field",
  "P5:missed_bet": "p5.misses_exploit",
};

// Refine grade()'s structural tag (e.g. "p1.overfold") into a curriculum leak
// using the drill's module. Unmapped (module, suffix) -> "<module>.<suffix>".
export function classifyLeak(drill: Drill, result: Result): string {
  const dot = result.leakTag.indexOf(".");
  const suffix = dot >= 0 ? result.leakTag.slice(dot + 1) : result.leakTag;
  return LEAK_TABLE[`${drill.module}:${suffix}`] ?? `${drill.module.toLowerCase()}.${suffix}`;
}

// Grade a response to a drill and reschedule it. Returns a NEW session (pure).
// The Result's leakTag is the module-aware (L6) classification, not grade()'s
// raw structural tag — gradeDrill has the Drill, so it knows the module.
export function gradeDrill(session: Session, drillId: string, response: Response, now: number): GradeOutcome {
  const drill = session.drills.find((d) => d.id === drillId);
  if (!drill) throw new Error(`gradeDrill: unknown drill ${drillId}`);
  const base = grade(drill.state, response);
  const result: Result = { ...base, leakTag: classifyLeak(drill, base) };
  const prior = session.reviews[drillId] ?? newReview(drillId, now);
  const review = scheduleReview(prior, result, now);
  return { result, review, session: { ...session, reviews: { ...session.reviews, [drillId]: review } } };
}

// Persistence primitives (pure; the CLI does the actual file IO). A Session's
// drills carry villain `strategy` FUNCTIONS, which aren't JSON-serializable — so
// only the plain `reviews` data is persisted, then rehydrated against the
// in-code drill library. Reviews for ids no longer in the library are dropped
// (drill set changed); malformed/missing input yields a fresh session.
export function serializeSession(session: Session): string {
  return JSON.stringify({ version: 1, reviews: session.reviews }, null, 2);
}

export function loadSession(drills: Drill[], json?: string | null): Session {
  if (!json) return newSession(drills);
  let data: unknown;
  try { data = JSON.parse(json); } catch { return newSession(drills); }
  const raw = data && typeof data === "object" && "reviews" in data
    ? (data as { reviews?: unknown }).reviews : undefined;
  const reviews: Record<string, Review> = {};
  const ids = new Set(drills.map((d) => d.id));
  if (raw && typeof raw === "object") {
    for (const [id, r] of Object.entries(raw as Record<string, Review>)) {
      if (ids.has(id) && r && typeof r.due === "number" && typeof r.ease === "number") reviews[id] = r;
    }
  }
  return { drills, reviews };
}

// ---- helpers for authoring tests/drills ----------------------------------
export const RNAMES: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" };
export const SNAMES = ["s", "h", "d", "c"];
export function parseCard(str: string): Card {
  // "As", "Td", "9c"
  const rmap: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  const r = rmap[str[0]] ?? parseInt(str[0], 10);
  const s = SNAMES.indexOf(str[1]);
  return card(r, s);
}
// Authoring helper. A 2-card call types as a Combo (a holding); any other count
// types as a Card[] (a board). Boards are never length 2, so this is unambiguous.
export function hand(a: string, b: string): Combo;
export function hand(...strs: string[]): Card[];
export function hand(...strs: string[]): Card[] {
  return strs.map(parseCard);
}

// ---- L6 starter content (defined last so the helpers above are initialized) --
// A small starter set spanning estimate/action and pillar 1/pillar 2. The exact
// values are the same ones proven elsewhere (6/44 equity, the chop, the 9/44 tree).
export const STARTER_DRILLS: Drill[] = [
  {
    id: "m2-kqo-vs-aa",
    module: "M2",
    title: "Open-ender vs an overpair, one card to come",
    ask: "estimate",
    state: {
      heroHand: hand("Ks", "Qd"), board: hand("Jh", "Th", "2c", "3s"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-chop-potodds",
    module: "M3",
    title: "Pot odds facing a bet with a guaranteed chop",
    ask: "action",
    state: {
      heroHand: hand("3h", "4d"), board: hand("As", "Ks", "Qd", "Jc", "2h"),
      pot: 2, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("3c", "4s"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p2-bet-or-check",
    module: "P2",
    title: "Bet sizing with fold equity vs a 50/50 caller",
    ask: "action",
    state: {
      heroHand: hand("Ks", "Qd"), board: hand("Jh", "Th", "2c", "3s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Ad"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: 0.5 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "m1-flush-draw-outs",
    module: "M1",
    title: "Counting outs: a bare flush draw on the flop",
    ask: "estimate",
    state: {
      heroHand: hand("2s", "5s"), board: hand("As", "9s", "7h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kc"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-overcards-vs-pairs",
    module: "M5",
    title: "Equity vs a range: two overcards vs underpairs",
    ask: "estimate",
    state: {
      heroHand: hand("As", "Ks"), board: hand("Qh", "Jd", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Td", "Th"), weight: 1 }, { combo: hand("9c", "9h"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m35-semibluff-flushdraw",
    module: "M3.5",
    title: "Fold equity: semi-bluffing a flush draw on the flop",
    ask: "action",
    state: {
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.6 : 0.4 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "p3-value-two-streets",
    module: "P3",
    title: "Multi-street value: betting the nuts on flop and turn",
    ask: "action",
    state: {
      heroHand: hand("Js", "Ts"), board: hand("As", "Ks", "Qs"), // flopped royal flush
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("2h", "2d"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
    },
  },
  {
    id: "p4-multiway-field",
    module: "P4",
    title: "Multiway: realizing a chop against a two-opponent field",
    ask: "estimate",
    state: {
      heroHand: hand("3h", "4d"), board: hand("As", "Ks", "Qd", "Jc", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("3c", "4s"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "p5-exploit-overfolder",
    module: "P5",
    title: "Exploit: bluffing into a villain who over-folds",
    ask: "action",
    state: {
      heroHand: hand("7h", "2d"), board: hand("As", "Ks", "Qd", "4c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.8 : 0.2 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "m4-sequence-two-streets",
    module: "M4",
    title: "Street sequencing: betting a flopped straight flush across streets",
    ask: "action",
    state: {
      heroHand: hand("9s", "8s"), board: hand("7s", "6s", "5s"), // flopped straight flush
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("2h", "2d"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
    },
  },
];
