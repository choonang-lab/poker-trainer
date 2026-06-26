// Poker Trainer — shared engine (L1, L2, L3, L4). TypeScript port against
// contract.ts; runs directly under Node's type-stripping (`node engine.test.ts`)
// and type-checks with `tsc --noEmit`. Dependency-free ES module.
//
// Card encoding: integer 0..51 = rank*4 + suit
//   rank: 0..12  maps to 2..14 (14 = Ace)
//   suit: 0..3   (arbitrary; only equality and flush grouping matter)

import type {
  Card, Score, Board, Combo, Range, Villain, Abstraction, State,
  Action, NodeState, NodeStrategy, Terminal, TreeNode,
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
  const e = equityLeaf(state);
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
