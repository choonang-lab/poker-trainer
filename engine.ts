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
  Drill, Session, GradeOutcome, CalibrationBucket, CalibrationReport, LeakStat, LeakReport,
  RangePolicy,
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

// Reference 7-card evaluator: max over C(7,5)=21 five-card subsets. Proven; kept
// as the cross-validation oracle for the fast evaluator below.
export function score7slow(seven: Card[]): Score {
  let best: Score | null = null;
  for (const combo of C75) {
    const s = score5([seven[combo[0]], seven[combo[1]], seven[combo[2]], seven[combo[3]], seven[combo[4]]]);
    if (best === null || cmpScore(s, best) > 0) best = s;
  }
  return best!;
}

// Highest card of a 5-run in a 15-bit rank mask (bits 2..14); handles the wheel.
function straightTopFromMask(mask: number): number {
  for (let hi = 14; hi >= 6; hi--) {
    let run = true;
    for (let k = 0; k < 5; k++) if (!(mask & (1 << (hi - k)))) { run = false; break; }
    if (run) return hi;
  }
  if ((mask & (1 << 14)) && (mask & (1 << 5)) && (mask & (1 << 4)) && (mask & (1 << 3)) && (mask & (1 << 2)))
    return 5; // A-2-3-4-5
  return 0;
}

// Direct 7-card evaluator: rank counts + per-suit bitmasks, no 21-subset scan.
// Returns the SAME Score array format as score5/score7slow (cross-validated), so
// every caller (equity/outs) gets faster with zero behavioral change.
export function score7(seven: Card[]): Score {
  const cnt = new Array(15).fill(0);          // count by rank 2..14
  const suitRanks = [0, 0, 0, 0];             // per-suit rank bitmask
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of seven) {
    const r = rankOf(c), s = suitOf(c);
    cnt[r]++; rankMask |= (1 << r);
    suitRanks[s] |= (1 << r); suitCount[s]++;
  }

  // At most one suit can hold >=5 of 7 cards.
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;

  // straight flush (8)
  if (flushSuit >= 0) {
    const sf = straightTopFromMask(suitRanks[flushSuit]);
    if (sf) return [8, sf];
  }

  // group ranks by count (all desc, since r runs 14..2)
  const quads: number[] = [], trips: number[] = [], pairs: number[] = [], distinct: number[] = [];
  for (let r = 14; r >= 2; r--) {
    if (cnt[r] === 0) continue;
    distinct.push(r);
    if (cnt[r] === 4) quads.push(r);
    else if (cnt[r] === 3) trips.push(r);
    else if (cnt[r] === 2) pairs.push(r);
  }

  // quads (7)
  if (quads.length) {
    const q = quads[0];
    return [7, q, distinct.find((r) => r !== q)!];
  }

  // full house (6): a trip plus another trip-or-pair
  if (trips.length && (trips.length >= 2 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips.length >= 2 ? trips[1] : 0, pairs.length ? pairs[0] : 0);
    return [6, t, p];
  }

  // flush (5): top 5 ranks of the flush suit
  if (flushSuit >= 0) {
    const fr: number[] = [];
    for (let r = 14; r >= 2 && fr.length < 5; r--) if (suitRanks[flushSuit] & (1 << r)) fr.push(r);
    return [5, ...fr];
  }

  // straight (4)
  const st = straightTopFromMask(rankMask);
  if (st) return [4, st];

  // trips (3): trip + top 2 kickers
  if (trips.length) {
    const t = trips[0];
    return [3, t, ...distinct.filter((r) => r !== t).slice(0, 2)];
  }

  // two pair (2): two highest pairs + highest kicker
  if (pairs.length >= 2) {
    const hi = pairs[0], lo = pairs[1];
    return [2, hi, lo, distinct.find((r) => r !== hi && r !== lo)!];
  }

  // one pair (1): pair + top 3 kickers
  if (pairs.length === 1) {
    const p = pairs[0];
    return [1, p, ...distinct.filter((r) => r !== p).slice(0, 3)];
  }

  // high card (0): top 5
  return [0, ...distinct.slice(0, 5)];
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
  // Single-card-to-come, so only a flop (turn card) or turn (river card) makes
  // sense; other lengths feed best() an out-of-range hand and misbehave silently.
  if (board.length !== 3 && board.length !== 4)
    throw new Error(`outs: board must be a flop or turn (3 or 4 cards); got ${board.length}`);
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

// The actual 5 cards forming the best hand (which best()/score7 only score). Used
// by the UI to highlight a made hand. Scans all C(n,5) subsets (n<=7 -> <=21) and
// returns the highest-scoring five; score5(madeHand(x)) always equals best(x).
export function madeHand(cards: Card[]): Card[] {
  if (cards.length < 5 || cards.length > 7)
    throw new Error(`madeHand needs 5 to 7 cards; got ${cards.length}`);
  const n = cards.length;
  let bestFive: Card[] | null = null, bestS: Score | null = null;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const s = score5(five);
            if (bestS === null || cmpScore(s, bestS) > 0) { bestS = s; bestFive = five; }
          }
  return bestFive!;
}

// The suit of a flush DRAW: a suit held exactly 4 times across hero+board (5+ is a
// made flush, not a draw). Single-suit by design, matching the engine's flush model;
// straight draws have no suit to report. Used by the UI to tint the drawing cards.
export function drawSuit(hero: Combo, board: Board): number | null {
  const counts = [0, 0, 0, 0];
  for (const c of [...hero, ...board]) counts[suitOf(c)]++;
  for (let s = 0; s < 4; s++) if (counts[s] === 4) return s;
  return null;
}

// The CATEGORY of the nuts: the best hand any two hole cards could make on this
// board, independent of hero. Enumerates every 2-card holding from the remaining
// deck and takes the max. Board must be a flop/turn/river (3-5). Powers the M0
// "name the nuts" drills — recognizing the strongest possible hand on a board.
export function nutCategory(board: Board): number {
  if (board.length < 3 || board.length > 5)
    throw new Error(`nutCategory: board must be 3 to 5 cards; got ${board.length}`);
  const known = new Set<Card>(board);
  const rem = FULL_DECK.filter((c) => !known.has(c));
  let bestS: Score | null = null;
  for (let i = 0; i < rem.length; i++)
    for (let j = i + 1; j < rem.length; j++) {
      const s = best([rem[i], rem[j], ...board]);
      if (bestS === null || cmpScore(s, bestS) > 0) bestS = s;
    }
  return bestS![0];
}

// How many 2-card combinations of a holding are possible, given the cards already
// visible (hero + board remove them). `combo` is a TEMPLATE — only its two ranks
// matter. A pocket pair (same rank) has C(available,2) combos; an unpaired holding
// has availA * availB. Base counts: pair = 6, unpaired = 16 — blockers cut them.
export function comboCount(combo: Combo, known: Board): number {
  const a = rankOf(combo[0]), b = rankOf(combo[1]);
  const left = (r: number) => 4 - known.filter((c) => rankOf(c) === r).length;
  const availA = left(a);
  if (a === b) return (availA * (availA - 1)) / 2; // pocket pair
  return availA * left(b);                          // two distinct ranks
}

// Balance math — the equilibrium frequency constants, pure functions of the bet
// size relative to the pot. This is the depth-zero slice of GTO: no tree, no
// solver, just the ratio that makes an opponent indifferent. `pot` is the pot
// BEFORE the bet; `bet` is the wager. (Both drills declare pot in state.pot and
// the bet in state.toCall, so grade() reads them straight off the spot.)
//
// Minimum defense frequency: the fraction of your range you must continue with
// so that a pure bluff of `bet` shows 0 EV. Defend less and a bluff prints.
// Pot-sized bet -> 1/2; the smaller the bet, the more you must defend.
export function minDefenseFreq(pot: number, bet: number): number {
  return pot / (pot + bet);
}
// Optimal bluff fraction of a betting range: bet `bet` into `pot` and this share
// of your bets should be bluffs to leave a bluff-catcher indifferent to calling.
// Pot-sized bet -> 1/3 (one bluff per two value bets); smaller bets bluff less.
export function bluffFrequency(pot: number, bet: number): number {
  return bet / (pot + 2 * bet);
}

// Tournament ICM (T1) — the depth-zero slice of tournament play, exactly like pot
// odds / combos / MDF are for cash. Given chip `stacks` and a `payouts` structure
// (prize per finishing place, in any units), returns each seat's expected prize by
// the Malmuth-Harville model: P(a seat finishes 1st) is its share of the chips;
// remove it and repeat for 2nd, 3rd, … The point it teaches: chips are NOT money —
// a big stack's prize is far less than its chip fraction (it can't win more than
// first), and a short stack's is more (survival has value). O(n!/(n-M)!) over the
// M paid places — fine for the small fields tournaments actually reach.
export function icmEquity(stacks: number[], payouts: number[]): number[] {
  const eq = stacks.map(() => 0);
  const recurse = (rem: number[], place: number, prob: number): void => {
    if (place >= payouts.length || rem.length === 0) return;
    const remTotal = rem.reduce((a, i) => a + stacks[i], 0);
    if (remTotal <= 0) return;
    for (const i of rem) {
      const p = prob * (stacks[i] / remTotal);
      eq[i] += p * payouts[place];
      recurse(rem.filter((j) => j !== i), place + 1, p);
    }
  };
  recurse(stacks.map((_, i) => i), 0, 1);
  return eq;
}

// The ICM risk premium: the equity hero needs to CALL an all-in for the effective
// (smaller) stack. In chips it's just pot odds (a coinflip needs 50%); in $ it's
// higher, because busting costs more $-equity than doubling gains (you can't win
// more than first, and pay jumps compress the upside). Returns the break-even
// equity p* where calling and folding have equal $EV: p* = dLose / (dWin + dLose),
// with dWin/dLose the ICM swing from winning/losing the all-in. 0.5 = cash-game
// baseline (no pay ladder); >0.5 = a real premium (tighten up, e.g. on the bubble).
export function requiredEquity(stacks: number[], payouts: number[], heroSeat: number, villainSeat: number): number {
  const eff = Math.min(stacks[heroSeat], stacks[villainSeat]);
  const cur = icmEquity(stacks, payouts)[heroSeat];
  const winS = stacks.map((s, i) => i === heroSeat ? s + eff : i === villainSeat ? s - eff : s);
  const loseS = stacks.map((s, i) => i === heroSeat ? s - eff : i === villainSeat ? s + eff : s);
  const dWin = icmEquity(winS, payouts)[heroSeat] - cur;
  const dLose = cur - icmEquity(loseS, payouts)[heroSeat];
  return dWin + dLose <= 0 ? 0.5 : dLose / (dWin + dLose);
}

// Short-stack push/fold (T2), chip-EV. Folded to hero in the small blind (0.5) with
// `stack` bb; hero shoves all-in and the big blind calls `callFreq` of the time,
// giving hero `eqWhenCalled` equity when called. Returns the net bb result versus the
// pre-decision stack: fold-and-win-the-blind (+1) when villain folds, an all-in for
// `stack` each ((2e-1)*stack) when called. Compare to folding (foldEV = -0.5): shove
// iff shoveEV > -0.5. Two things push the threshold to shove WIDER: a shorter stack
// (the downside when called is smaller) and a foldier villain (more fold equity).
export function shoveEV(stack: number, callFreq: number, eqWhenCalled: number): number {
  return (1 - callFreq) * 1 + callFreq * (2 * eqWhenCalled - 1) * stack;
}

// Range advantage (M5.8): the average equity of hero's WHOLE range against villain's
// whole range on a board — the extension of `equityVsRange` (one hand vs a range) to
// range-vs-range. Card removal is exact: a hero combo that collides with the board is
// skipped, and for each hero combo the villain combos sharing its cards or the board
// are dropped. >0.5 means hero's range is ahead here (can bet/pressure); <0.5 means
// villain's range is (check more). Fast — the fast score7 makes even a flop (990
// runouts per combo pair) a few tens of ms for realistic ranges.
export function rangeVsRange(heroRange: Range, villRange: Range, board: Board): number {
  let total = 0, weight = 0;
  for (const h of heroRange) {
    if (h.combo.some((c) => board.includes(c))) continue;
    const vr = villRange.filter((v) => !v.combo.some((c) => board.includes(c) || h.combo.includes(c)));
    const e = equityVsRange(h.combo, board, vr);
    if (e === null) continue;
    total += h.weight * e;
    weight += h.weight;
  }
  if (weight === 0) throw new Error("rangeVsRange: no valid hero/villain combo pairing on this board");
  return total / weight;
}

// Board texture classification (M5.8) — a pure function of the board that names how
// ranges interact with it: paired (sets/full houses live), suit spread (flush draws),
// connectedness (straights live), and the top card (high boards favor a raiser's big cards).
export function boardTexture(board: Board): { paired: boolean; suitedness: "rainbow" | "two-tone" | "mono"; connected: boolean; topRank: number } {
  const ranks = board.map(rankOf);
  const paired = ranks.some((r, i) => ranks.indexOf(r) !== i);
  const suitCounts = [0, 0, 0, 0];
  for (const c of board) suitCounts[suitOf(c)]++;
  const maxSuit = Math.max(...suitCounts);
  const suitedness = maxSuit >= 3 ? "mono" : maxSuit === 2 ? "two-tone" : "rainbow";
  // connected: three distinct ranks fit inside a 5-value straight window somewhere.
  const distinct = [...new Set(ranks)].sort((a, b) => a - b);
  let connected = false;
  for (const r of distinct) if (distinct.filter((x) => x >= r && x <= r + 4).length >= 3) connected = true;
  return { paired, suitedness, connected, topRank: Math.max(...ranks) };
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

// M6 calibration: Brier score + per-bucket reliability over {estimate, truth}
// samples. Estimates are binned by predicted value; gap = meanEstimate - meanTruth
// (>0 overconfident). Pure; the caller supplies the sample history.
export function calibration(
  samples: { estimate: number; truth: number }[], bins = 10,
): CalibrationReport {
  const acc = Array.from({ length: bins }, () => ({ count: 0, se: 0, st: 0 }));
  for (const { estimate, truth } of samples) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(estimate * bins)));
    acc[idx].count++; acc[idx].se += estimate; acc[idx].st += truth;
  }
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < bins; i++) {
    const a = acc[i];
    if (!a.count) continue;
    const me = a.se / a.count, mt = a.st / a.count;
    buckets.push({ lo: i / bins, hi: (i + 1) / bins, count: a.count, meanEstimate: me, meanTruth: mt, gap: me - mt });
  }
  return { n: samples.length, brier: brier(samples), buckets };
}

// P6 EV calibration: aggregate graded results into recurring leaks ranked by total
// regret. "*.ok" tags (no leak) are excluded from the leaks list but still count
// toward n and overall regret. Pure; the caller supplies the result history.
export function leakReport(entries: { leakTag: string; regretBb: number }[]): LeakReport {
  const n = entries.length;
  const totalRegret = entries.reduce((s, e) => s + e.regretBb, 0);
  const byTag = new Map<string, { count: number; total: number }>();
  for (const e of entries) {
    if (e.leakTag.endsWith(".ok")) continue;
    const cur = byTag.get(e.leakTag) ?? { count: 0, total: 0 };
    cur.count++; cur.total += e.regretBb;
    byTag.set(e.leakTag, cur);
  }
  const leaks: LeakStat[] = [...byTag.entries()]
    .map(([leakTag, s]) => ({ leakTag, count: s.count, totalRegret: s.total, meanRegret: s.total / s.count }))
    .sort((a, b) => b.totalRegret - a.totalRegret || b.count - a.count);
  return { n, totalRegret, meanRegret: n ? totalRegret / n : 0, leaks };
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
      // The declared strategy is a probability distribution over the villain's
      // legal actions; normalize by the total assigned weight so authoring weights
      // need not pre-sum to 1 (a strategy summing to != 1 must not silently scale
      // the EV). Mirrors villainPolicyNode's `weight / total`.
      let ev = 0, total = 0;
      for (const { action, weight } of dist) {
        if (weight === 0) continue;
        const child = kids.find((ch) => sameAction(ch.action, action));
        if (child) { ev += weight * bestResponseEV(child.node); total += weight; }
      }
      if (total === 0)
        throw new Error("VILL node: villain.strategy assigns no weight to any legal action");
      return ev / total;
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
  if (players > 2)
    throw new Error(`multiway (players > 2) is an estimate-only field approximation; a betting tree (sizes) requires heads-up (players = 2)`);
  for (const s of sizes)
    if (!(s > 0)) throw new Error(`bet sizes must be > 0 (got ${s})`);
  if (abstraction.raiseSizes) {
    for (const r of abstraction.raiseSizes)
      if (!(r > 0)) throw new Error(`raise sizes must be > 0 (got ${r})`);
    if (abstraction.raiseSizes.length > ABSTRACTION_LIMITS.maxSizes)
      throw new Error(`too many raise sizes: ${abstraction.raiseSizes.length} > ${ABSTRACTION_LIMITS.maxSizes}`);
  }
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
  if (abstraction.heroFacesBet !== undefined && !(abstraction.heroFacesBet > 0))
    throw new Error(`heroFacesBet must be > 0 (got ${abstraction.heroFacesBet})`);
  if (abstraction.raiseCap !== undefined && !(Number.isInteger(abstraction.raiseCap) && abstraction.raiseCap >= 0 && abstraction.raiseCap <= 4))
    throw new Error(`raiseCap must be an integer in 0..4 (got ${abstraction.raiseCap})`);
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
  villainLeads: boolean;
  raiseCap: number;
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

// A bet/raise faced by `actor`: fold, call, or (if raises remain) a pot-sized
// raise that the opponent then faces. Alternating actors; capped depth. Unifies
// fold/call (cap 0), villain raise (cap 1), and re-raises (cap >= 2). `facing` is
// the amount `actor` must call; `pot` is the pot before `actor` acts.
// Villain faces a bet with a PER-COMBO policy: fold/call/raise, with the range
// narrowed PER ACTION (callers vs raisers) and re-narrowed on later streets. If a
// combo raises, hero then faces that raise (fold/call/re-raise) against the
// raise-narrowed range. Policy is kept downstream for multi-street narrowing.
function villainPolicyNode(
  ctx: Ctx, pot: number, facing: number, heroInvested: number, raisesLeft: number, rest: ("flop" | "turn" | "river")[],
): TreeNode {
  const policy = ctx.villain.policy as RangePolicy;
  const baseState = nodeState({ ...ctx, pot }, { toAct: "villain" });
  const raiseBy = pot + facing;                 // pot-sized raise (the pot after a call)
  const raiseSize = raiseBy / ctx.pot;
  const legal: Action[] = raisesLeft > 0
    ? [{ kind: "fold" }, { kind: "call" }, { kind: "bet", size: raiseSize }]
    : [{ kind: "fold" }, { kind: "call" }];
  const prob = (dist: { action: Action; weight: number }[], kind: Action["kind"]): number =>
    dist.reduce((w, d) => w + (d.action.kind === kind ? d.weight : 0), 0);
  const blocked = new Set<Card>([...(ctx.heroHand ?? []), ...ctx.board]);
  let foldW = 0, callW = 0, raiseW = 0;
  const callRange: { combo: Combo; weight: number }[] = [];
  const raiseRange: { combo: Combo; weight: number }[] = [];
  for (const { combo, weight } of ctx.villain.range) {
    if (combo.some((c) => blocked.has(c))) continue;          // impossible given hero+board
    const dist = policy(combo, baseState, legal);
    foldW += weight * prob(dist, "fold");
    const pc = prob(dist, "call");
    callW += weight * pc;
    if (pc > 0) callRange.push({ combo, weight: weight * pc });
    const pr = prob(dist, "bet");
    raiseW += weight * pr;
    if (pr > 0) raiseRange.push({ combo, weight: weight * pr });
  }
  const total = foldW + callW + raiseW || 1;
  const strat: NodeStrategy = (_s, lg) => lg.map((a) => ({
    action: a,
    weight: a.kind === "fold" ? foldW / total : a.kind === "call" ? callW / total : a.kind === "bet" ? raiseW / total : 0,
  }));
  const children: { action?: Action; node: TreeNode }[] = [
    { action: { kind: "fold" },
      node: { kind: "TERM", state: baseState, terminal: { type: "fold", folder: "villain", heroInvested } } },
    { action: { kind: "call" },
      node: advance({ ...ctx, pot: pot + facing, heroInvested, villain: { range: callRange, policy } }, rest) },
  ];
  if (raisesLeft > 0 && raiseW > 0) {
    // Villain raises (pot-sized) with the raise-narrowed range; hero faces it.
    const raisePot = pot + facing + raiseBy;
    const heroFaces = raiseNode("hero", { ...ctx, villain: { range: raiseRange, policy } },
      raisePot, raiseBy, heroInvested, raisesLeft - 1, rest);
    children.push({ action: { kind: "bet", size: raiseSize }, node: heroFaces });
  }
  return { kind: "VILL", state: { ...baseState, villain: { ...ctx.villain, strategy: strat } }, children };
}

function raiseNode(
  actor: "hero" | "villain", ctx: Ctx, pot: number, facing: number,
  heroInvested: number, raisesLeft: number, rest: ("flop" | "turn" | "river")[],
): TreeNode {
  if (actor === "villain" && ctx.villain.policy)
    return villainPolicyNode(ctx, pot, facing, heroInvested, raisesLeft, rest);
  const state = nodeState({ ...ctx, pot }, { toAct: actor });
  const children: { action?: Action; node: TreeNode }[] = [
    { action: { kind: "fold" },
      node: { kind: "TERM", state, terminal: { type: "fold", folder: actor, heroInvested } } },
    { action: { kind: "call" },
      node: advance({ ...ctx, pot: pot + facing, heroInvested: heroInvested + (actor === "hero" ? facing : 0) }, rest) },
  ];
  if (raisesLeft > 0) {
    const opp = actor === "hero" ? "villain" : "hero";
    const potRaise = pot + facing;          // baseline pot-sized raise (the pot after a call)
    // Hero may choose among declared raise sizes (multipliers on the pot-sized raise);
    // villain always raises pot-sized. Default [1.0] keeps the original behavior.
    const rsizes = (actor === "hero" && ctx.abstraction.raiseSizes) ? ctx.abstraction.raiseSizes : [1.0];
    for (const rs of rsizes) {
      const raiseBy = rs * potRaise;
      const addNow = facing + raiseBy;      // actor calls, then raises by raiseBy
      const raisePot = pot + addNow;
      const raiseHeroInv = heroInvested + (actor === "hero" ? addNow : 0);
      children.push({
        action: { kind: "bet", size: raiseBy / ctx.pot },   // raise-to, relative to the street pot
        node: raiseNode(opp, ctx, raisePot, raiseBy, raiseHeroInv, raisesLeft - 1, rest),
      });
    }
  }
  return { kind: actor === "hero" ? "HERO" : "VILL", state, children };
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

// Villain acts after hero checks (only when villainLeads): check back -> advance,
// or bet -> hero faces the bet.
function villainAfterCheck(ctx: Ctx, rest: ("flop" | "turn" | "river")[]): TreeNode {
  const children: { action?: Action; node: TreeNode }[] = [
    { action: { kind: "check" }, node: advance(ctx, rest) }, // villain checks back
  ];
  for (const s of ctx.sizes) {
    const bet = s * ctx.pot;
    const betState = nodeState({ ...ctx, pot: ctx.pot + bet }, { toAct: "hero" });
    const calledCtx: Ctx = { ...ctx, pot: ctx.pot + 2 * bet, heroInvested: ctx.heroInvested + bet };
    // Hero faces villain's bet: fold (forfeits what hero already put in) or call.
    const heroFacing: TreeNode = {
      kind: "HERO", state: betState,
      children: [
        { action: { kind: "fold" },
          node: { kind: "TERM", state: betState,
                  terminal: { type: "fold", folder: "hero", heroInvested: ctx.heroInvested } } },
        { action: { kind: "call" }, node: advance(calledCtx, rest) },
      ],
    };
    children.push({ action: { kind: "bet", size: s }, node: heroFacing });
  }
  return { kind: "VILL", state: nodeState(ctx, { toAct: "villain" }), children };
}

// One hero betting round on streets[0], then advance over streets.slice(1).
function buildStreet(ctx: Ctx, streets: ("flop" | "turn" | "river")[]): TreeNode {
  const rest = streets.slice(1);
  const children: { action?: Action; node: TreeNode }[] = [];

  // Check line: round closes (villain checks behind) unless villainLeads, in which
  // case villain may bet and hero must respond.
  children.push({
    action: { kind: "check" },
    node: ctx.villainLeads ? villainAfterCheck(ctx, rest) : advance(ctx, rest),
  });

  // Bet lines: one per declared pot-relative size. Villain faces hero's bet via the
  // unified raise chain (fold/call, or raises up to ctx.raiseCap).
  for (const s of ctx.sizes) {
    const bet = s * ctx.pot;
    const villNode = raiseNode("villain", ctx, ctx.pot + bet, bet, ctx.heroInvested + bet, ctx.raiseCap, rest);
    children.push({ action: { kind: "bet", size: s }, node: villNode });
  }

  return { kind: "HERO", state: nodeState(ctx, { toAct: "hero" }), children };
}

// Root where hero FACES a villain bet of size*pot: fold (forfeits prior money) or
// call -> advance to the remaining streets, where hero can bet a completed draw and
// villain pays off (the implied winnings). Models a true implied-odds call/fold.
function heroFacesBetRoot(ctx: Ctx, size: number, streets: ("flop" | "turn" | "river")[]): TreeNode {
  const bet = size * ctx.pot;
  // Hero faces villain's bet via the unified raise chain: fold/call, or (raiseCap>0)
  // a 3-bet that villain then faces.
  return raiseNode("hero", ctx, ctx.pot + bet, bet, ctx.heroInvested, ctx.raiseCap, streets.slice(1));
}

export function buildTree(state: State): TreeNode {
  validateAbstraction(state.abstraction, state.board);
  const ctx: Ctx = {
    heroHand: state.heroHand, heroRange: state.heroRange,
    board: state.board, pot: state.pot, villain: state.villain,
    players: state.abstraction.players ?? 2,
    abstraction: state.abstraction,
    sizes: state.abstraction.sizes,
    villainLeads: state.abstraction.villainLeads ?? false,
    raiseCap: state.abstraction.raiseCap ?? (state.abstraction.villainRaises ? 1 : 0),
    heroInvested: 0,
  };
  if (state.abstraction.heroFacesBet !== undefined)
    return heroFacesBetRoot(ctx, state.abstraction.heroFacesBet, state.abstraction.streets);
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
    const eq = fieldEquity(state); // field-aware (reduces to heads-up equity at players=2)
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

// Characterize an action leak by comparing the chosen action to the BEST action,
// so size errors are distinguished: a bet smaller than the best bet is an
// "underbet", larger (or a bet when checking/passing was best) is an "overbet".
function actionSuffix(chosen: Action, best: Action): string {
  switch (chosen.kind) {
    case "fold": return "overfold";    // folded when something better existed
    case "check": return "missed_bet"; // checked when betting/acting was better
    case "call": return best.kind === "bet" ? "passive" : "spew"; // flat when raising was best / called a loser
    case "bet":
      return best.kind === "bet" ? (chosen.size > best.size ? "overbet" : "underbet") : "overbet";
  }
}

function actionLeak(state: State, chosen: Action, best: Action, regretBb: number): string {
  const p = state.abstraction.sizes.length === 0 ? "p1" : "p2";
  if (regretBb <= 1e-9) return `${p}.ok`;
  return `${p}.${actionSuffix(chosen, best)}`;
}

// M0 hand-reading: the category (0..8) of hero's best made hand on the board.
function handCategory(state: State): number {
  if (!state.heroHand) throw new Error("category drill requires heroHand");
  return best([...state.heroHand, ...state.board])[0];
}

// M1 out-counting: the true number of outs (single-card-to-come) for hero vs the
// drill's single villain combo. Mirrors the L2 `outs` leaf.
function drillOuts(state: State): number {
  if (!state.heroHand) throw new Error("outs drill requires heroHand");
  const v = state.villain.range[0]?.combo;
  if (!v) throw new Error("outs drill requires a single villain combo");
  return outs(state.heroHand, state.board, v);
}

// Out-counting is graded exactly (off-by-any-amount is a miss); the over/under
// suffixes reuse the pillar-1 estimate tags so classifyLeak maps M1 -> over/undercounts_outs.
function outsLeak(error: number): string {
  if (error === 0) return "p1.ok";
  return error > 0 ? "p1.overestimate" : "p1.underestimate";
}

export function grade(state: State, response: Response): Result {
  if (response.kind === "estimate") {
    // Estimates are graded against equity in [0,1]; a tree spot's truth() is a bb
    // EV, so an estimate on a non-empty abstraction would be graded incoherently.
    if (state.abstraction.sizes.length > 0)
      throw new Error("grade: an estimate response requires a pillar-1 spot (empty abstraction)");
    const t = truth(state); // throws on a malformed spot
    const error = response.value - t;
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: estimateLeak(error) };
  }
  if (response.kind === "category") {
    // Graded by distance to the true category (0 = correct). Not an EV decision.
    const err = Math.abs(response.value - handCategory(state));
    return { regretBb: 0, estimateError: err, leakTag: err === 0 ? "p1.ok" : "p1.miscategorized" };
  }
  if (response.kind === "outs") {
    // Graded by distance to the true out count (0 = exact). Not an EV decision.
    const error = response.value - drillOuts(state);
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: outsLeak(error) };
  }
  if (response.kind === "nuts") {
    // Graded by distance to the true nut category (0 = correct). Board-only.
    const err = Math.abs(response.value - nutCategory(state.board));
    return { regretBb: 0, estimateError: err, leakTag: err === 0 ? "p1.ok" : "p1.misreads_nuts" };
  }
  if (response.kind === "combos") {
    // Graded by distance to the true combo count. villain.range[0].combo is the target
    // holding; hero + board are the removed cards. Reuses the over/under out-count tags.
    const target = state.villain.range[0]?.combo;
    if (!target) throw new Error("combos drill requires a target holding in villain.range");
    const error = response.value - comboCount(target, [...(state.heroHand ?? []), ...state.board]);
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: outsLeak(error) };
  }
  if (response.kind === "mdf") {
    // Minimum defense frequency from the declared pot/bet. A 0.5-point tolerance so a
    // non-terminating target (e.g. 33.3%) counts as correct when typed as a percentage.
    // Over/under keep distinct suffixes so one module can carry both mdf and bluff drills.
    const error = response.value - minDefenseFreq(state.pot, state.toCall ?? 0);
    const tag = Math.abs(error) < 5e-3 ? "p1.ok" : error > 0 ? "p1.overdefends" : "p1.underdefends";
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: tag };
  }
  if (response.kind === "bluffs") {
    const error = response.value - bluffFrequency(state.pot, state.toCall ?? 0);
    const tag = Math.abs(error) < 5e-3 ? "p1.ok" : error > 0 ? "p1.overbluffs" : "p1.underbluffs";
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: tag };
  }
  if (response.kind === "icm") {
    // Hero's ICM $-equity as a share of the prize pool, from the declared stacks/payouts.
    // A 0.02 tolerance (2 points of the pool) counts as "ok". Over/under keep distinct
    // suffixes so the module can distinguish overvaluing chips from undervaluing them.
    const target = icmEquity(state.stacks ?? [], state.payouts ?? [])[state.heroSeat ?? 0] ?? 0;
    const error = response.value - target;
    const tag = Math.abs(error) < 0.02 ? "p1.ok" : error > 0 ? "p1.overvalues" : "p1.undervalues";
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: tag };
  }
  if (response.kind === "callequity") {
    // The ICM-adjusted equity needed to call an all-in. Answering too LOW (e.g. the
    // cash-game 50%) means calling too light for a tournament; too HIGH means folding
    // too tight. A 0.02 tolerance, mirroring the icm grade.
    const target = requiredEquity(state.stacks ?? [], state.payouts ?? [], state.heroSeat ?? 0, state.villainSeat ?? 0);
    const error = response.value - target;
    const tag = Math.abs(error) < 0.02 ? "p1.ok" : error > 0 ? "p1.foldstoo_tight" : "p1.callstoo_light";
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: tag };
  }
  if (response.kind === "shove") {
    // Push/fold decision graded by chip-EV: shoving vs folding (foldEV = -0.5 bb).
    const sev = shoveEV(state.effStack ?? 0, state.callFreq ?? 0, state.eqWhenCalled ?? 0);
    const foldEV = -0.5;
    const shoveBest = sev > foldEV;
    const choseShove = response.action === "shove";
    const regretBb = choseShove === shoveBest ? 0 : Math.abs(sev - foldEV);
    const tag = regretBb === 0 ? "p1.ok" : shoveBest ? "p1.shoves_too_tight" : "p1.shoves_too_loose";
    return { regretBb, leakTag: tag };
  }
  if (response.kind === "rangeadv") {
    // Estimate hero's whole-range equity vs villain's range on the board, graded by error.
    const target = rangeVsRange(state.heroRange ?? [], state.villain.range, state.board);
    const error = response.value - target;
    const tag = estimateLeak(error); // reuse the estimate over/under bands; refined by module in classifyLeak
    return { regretBb: 0, estimateError: Math.abs(error), leakTag: tag };
  }
  const evs = decisionEVs(state);
  const chosen = evs.find((e) => sameAction(e.action, response.action));
  if (!chosen) throw new Error(`grade: illegal action ${JSON.stringify(response.action)} for this spot`);
  const bestEntry = evs.reduce((a, b) => (b.ev > a.ev ? b : a));
  const regretBb = bestEntry.ev - chosen.ev;
  return { regretBb, leakTag: actionLeak(state, response.action, bestEntry.action, regretBb) };
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
  "M0:miscategorized": "m0.misreads_hand",
  "M0:misreads_nuts": "m0.misreads_nuts",
  "M4.5:overestimate": "m45.overcounts_combos",
  "M4.5:underestimate": "m45.undercounts_combos",
  "M5.7:overdefends": "m57.overdefends",
  "M5.7:underdefends": "m57.underdefends",
  "M5.7:overbluffs": "m57.overbluffs",
  "M5.7:underbluffs": "m57.underbluffs",
  "T1:overvalues": "t1.overvalues_chips",
  "T1:undervalues": "t1.undervalues_chips",
  "T1:foldstoo_tight": "t1.folds_too_tight",
  "T1:callstoo_light": "t1.calls_too_light",
  "T2:shoves_too_tight": "t2.shoves_too_tight",
  "T2:shoves_too_loose": "t2.shoves_too_loose",
  "M5.8:overestimate": "m58.overrates_range",
  "M5.8:underestimate": "m58.underrates_range",
  "P0:overbet": "p0.bets_without_fold_equity",
  "P0:overfold": "p0.overfolds_in_position",
  "P1:overestimate": "p1.overvalues_holding",
  "P1:underestimate": "p1.undervalues_holding",
  "M3:overfold": "m3.folds_when_priced_in",
  "M3:spew": "m3.calls_when_overpriced",
  "M3.5:missed_bet": "m35.gives_up_fold_equity",
  "M3.5:overbet": "m35.bluffs_without_fold_equity",
  "M4:missed_bet": "m4.misses_street_sequence",
  "M4:overbet": "m4.bets_when_way_behind",
  "M5.6:overfold": "m56.folds_with_implied_odds",
  "M5.6:spew": "m56.chases_without_odds",
  "P2:missed_bet": "p2.misses_thin_value",
  "P2:underbet": "p2.bets_too_small",
  "P2:overbet": "p2.bets_too_big",
  "P2:passive": "p2.flats_instead_of_raising",
  "P2.5:missed_bet": "p25.checks_instead_of_betting",
  "P2.5:passive": "p25.flats_instead_of_raising",
  "P2.5:overfold": "p25.overfolds",
  "P2.5:overbet": "p25.cbets_without_equity",
  "P3:missed_bet": "p3.misses_multistreet_value",
  "P3:overbet": "p3.overbets_multistreet",
  "P3:passive": "p3.flats_instead_of_raising",
  "P3.4:missed_bet": "p34.misses_a_barrel",
  "P3.4:overbet": "p34.barrels_without_fold_equity",
  "P3.5:passive": "p35.flats_a_value_raise",
  "P3.5:overbet": "p35.raises_into_better",
  "P3.5:overfold": "p35.overfolds_the_river",
  "P3.5:spew": "p35.pays_off_the_river",
  "P4:overestimate": "p4.overrates_field",
  "P4:underestimate": "p4.underrates_field",
  "P5:missed_bet": "p5.misses_exploit",
  "P5:overbet": "p5.bets_into_strong_range",
  "P5:overfold": "p5.overfolds_vs_a_bluffer",
  "P5:spew": "p5.pays_off_a_nit",
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
  // For estimates, compute the ground truth ONCE (preflop is ~3s) and reuse it
  // for both the Result and GradeOutcome.truth (so callers can build calibration
  // sets without re-enumerating). Actions go through the standard grade() path.
  let base: Result;
  let truthValue: number | undefined;
  if (response.kind === "estimate") {
    const t = truth(drill.state);
    truthValue = t;
    const error = response.value - t;
    base = { regretBb: 0, estimateError: Math.abs(error), leakTag: estimateLeak(error) };
  } else {
    base = grade(drill.state, response);
  }
  const result: Result = { ...base, leakTag: classifyLeak(drill, base) };
  const prior = session.reviews[drillId] ?? newReview(drillId, now);
  const review = scheduleReview(prior, result, now);
  return {
    result, review, truth: truthValue,
    session: { ...session, reviews: { ...session.reviews, [drillId]: review } },
  };
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

// M5.8 range-advantage drills share one matchup — a strong preflop RAISER range vs a
// medium CALLER range — across different flops, so the only thing that changes is the
// board texture (and thus who's ahead). Representative combos keep the equities fast.
const RA_RAISER: Range = ([["Ah", "Ad"], ["Kh", "Kd"], ["Qh", "Qd"], ["As", "Ks"], ["As", "Qs"], ["As", "Js"]])
  .map(([a, b]) => ({ combo: hand(a, b), weight: 1 }));
const RA_CALLER: Range = ([["Jh", "Jc"], ["Th", "Tc"], ["9h", "9c"], ["Ac", "Qd"], ["Kc", "Qh"], ["Js", "Ts"], ["Td", "9d"]])
  .map(([a, b]) => ({ combo: hand(a, b), weight: 1 }));

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
    id: "p2-bet-or-check", // id keeps its legacy "p2-" prefix (stable key); it lives in M3.5
    module: "M3.5",        // a single-size semi-bluff decision -> fold equity, not sizing
    title: "Fold equity: an open-ended draw on the turn",
    ask: "action",
    read: "Villain folds to a bet about half the time.",
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
    title: "Counting outs: how many cards give you the winning hand?",
    ask: "outs",
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
    title: "Fold equity: a flush draw on the flop",
    ask: "action",
    read: "Villain folds often.",
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
    title: "Multi-street lines: a flopped nut hand, two streets to play",
    ask: "action",
    read: "Villain calls any bet (never folds, never raises).",
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
    title: "Multiway: an unimprovable hand against a two-opponent field",
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
    title: "Exploit: no showdown value against a fold-happy villain",
    ask: "action",
    read: "Villain folds to a bet very often.",
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
    id: "p5-exploit-floater",
    module: "P5",
    title: "Exploit: a villain who floats the flop but folds the turn",
    read: "Villain 'floats' — he calls flop bets with weak hands, then gives up and folds when you fire again on the turn.",
    ask: "action",
    // Street-aware villain (a genuine two-street line: floats the flop, folds the turn). Hero KcQc = air on
    // 8h 5d 2c. Bet the flop: villain floats (calls) with his weak pair, then folds your turn barrel — so a
    // double barrel makes him pay a street before he gives up. Bet (1.75) beats check-then-barrel (1.00);
    // checking the flop misses the exploit. (Villain policy switches on board.length: 3 = flop, 4 = turn.)
    state: {
      heroHand: hand("Kc", "Qc"), board: hand("8h", "5d", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("7s", "7d"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const flop = s.board.length === 3; // floats the flop, folds the turn
          return [{ action: { kind: "fold" }, weight: flop ? 0 : 1 }, { action: { kind: "call" }, weight: flop ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.75], streets: ["flop", "turn"], players: 2 },
    },
  },
  {
    id: "p5-exploit-maniac",
    module: "P5",
    title: "Exploit: a weak hand against a maniac who bluffs too much",
    read: "Villain is a maniac — he bets far more bluffs than value.",
    ask: "action",
    // Call down a maniac. Hero 8h8d = third pair (a hand you'd normally fold) on As Kc 7d 2s 4h. The maniac
    // bets a range that's mostly busted bluffs (2:1 over value), so your third pair beats ~80% of it -> CALL,
    // don't fold. The over-bluffing turns a fold into a call. (raiseCap 0 -> a clean call/fold spot.)
    state: {
      heroHand: hand("8h", "8d"), board: hand("As", "Kc", "7d", "2s", "4h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qh", "Jh"), weight: 2 }, { combo: hand("Th", "9h"), weight: 2 }, { combo: hand("Ac", "Tc"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 0.75, raiseCap: 0 },
    },
  },
  {
    id: "p5-exploit-nit",
    module: "P5",
    title: "Exploit: two pair against a nit who only bets the nuts",
    read: "Villain is a nit — he only bets big hands, effectively never bluffs.",
    ask: "action",
    // Believe a nit. Hero As9s = two pair (a hand you'd usually call with) on Ah 9d 4c 2s 7h. But this
    // villain only bets the nuts (a set here), which crushes two pair -> FOLD. The read overrides your hand
    // strength: against someone who never bluffs, a strong hand can still be an easy fold. Calling pays him off.
    state: {
      heroHand: hand("As", "9s"), board: hand("Ah", "9d", "4c", "2s", "7h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("4s", "4d"), weight: 1 }, { combo: hand("9h", "9c"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "m4-sequence-two-streets",
    module: "M4",
    title: "Street sequencing: a flopped straight flush",
    ask: "action",
    read: "Villain calls any bet (calling station).",
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
  {
    id: "m56-implied-odds-oesd",
    module: "M5.6",
    title: "Implied odds: an open-ender facing a big bet",
    read: "Villain bets big and pays off the turn when your straight completes.",
    ask: "action",
    // A REAL multi-street implied-odds tree (NOT an effective-pot shortcut). Hero
    // Th9c on Qd Jc 4h has an open-ended straight draw (K or 8, ~31.5%); no flush is
    // possible. heroFacesBet 1.5 -> the immediate price is 1.5/(1+2*1.5) = 37.5%, so
    // on price alone the call is rejected. But the callStrat villain pays off a turn
    // bet when the straight hits, and that future money makes calling +EV (~+0.36);
    // folding is the implied-odds leak. Contrast m56-no-implied-odds (no future bets
    // -> fold) and m56-true-implied-odds (the flush-draw instance of the same idea).
    state: {
      heroHand: hand("Th", "9c"), board: hand("Qd", "Jc", "4h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Qh"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2, heroFacesBet: 1.5 },
    },
  },
  {
    id: "m56-true-implied-odds",
    module: "M5.6",
    title: "Implied odds: a flush draw facing an overbet",
    ask: "action",
    read: "Villain pays off the turn when your draw hits.",
    // heroFacesBet 2.0 -> immediate odds need 40%, but the ~37% flush draw is +EV
    // because villain (callStrat) pays off the turn when it completes. Unlike the
    // effective-pot M5.6, the implied winnings come from a real future street.
    state: {
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2, heroFacesBet: 2.0 },
    },
  },
  {
    id: "p0-oop-no-equity",
    module: "P0",
    title: "Position: out of position with a worthless hand on the turn",
    ask: "action",
    read: "If you check, villain bets; villain never folds and always bets when checked to.",
    // villainLeads: if hero checks, villain bets and hero can check-fold (EV 0);
    // betting into a calling villain with 0 equity just spews (EV -1).
    state: {
      heroHand: hand("7h", "2d"), board: hand("As", "Ah", "Ad", "Kc"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ac", "5s"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: (a.kind === "bet" || a.kind === "call") ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, villainLeads: true },
    },
  },
  {
    id: "p0-ip-realize-equity",
    module: "P0",
    title: "Position: a flush draw on the turn, last to act",
    ask: "action",
    read: "You're in position (last to act), and villain never folds to a bet.",
    // The IP mirror of p0-oop-no-equity: no villainLeads, so a hero check ENDS the
    // street -> a free river. Hero realizes the full 9/44 draw equity (check EV
    // 9/44, realizationFactor 1). Betting has no fold equity here, so it just burns
    // chips (EV -17/44). OOP the same check would face a bet and realize 0.
    state: {
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d", "Jc"), // spade flush draw, 9 outs
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }], // a pair of aces; loses only to the flush
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p1-aa-vs-kk-preflop",
    module: "P1",
    title: "Preflop ranges: pocket aces vs pocket kings, all-in",
    ask: "estimate",
    // Preflop equity is a full 5-card runout (~3s on the fast evaluator); now
    // viable as content, but grading it is far slower than a postflop drill.
    state: {
      heroHand: hand("Ah", "As"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kh", "Ks"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p5-value-vs-raiser",
    module: "P5",
    title: "Exploit: the nuts on the turn against a raise-happy villain",
    ask: "action",
    read: "Villain raises whenever you bet.",
    // villainRaises + a raise-always villain: betting the nuts (EV 5) crushes
    // checking (EV 1) because hero re-calls the raise. Checking misses the value.
    state: {
      heroHand: hand("9s", "8s"), board: hand("7s", "6s", "5s", "2d"), // 9-high straight flush
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Kd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "bet" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, villainRaises: true },
    },
  },
  {
    id: "p2-size-up-nuts",
    module: "P2",
    title: "Sizing: the nuts on the turn with two bet sizes available",
    ask: "action",
    read: "Villain calls any bet.",
    // Two sizes; a calling villain. The nuts wants the BIGGER bet (EV 2 vs 1.5);
    // betting small is now tagged distinctly as an underbet (p2.bets_too_small).
    state: {
      heroHand: hand("As", "Ks"), board: hand("Qs", "Js", "Ts", "2d"), // royal flush
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("2h", "2c"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [0.5, 1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p5-vs-checkraise-range",
    module: "P5",
    title: "Exploit: top pair facing a villain who raises only monsters",
    ask: "action",
    read: "Villain only raises hands that beat you; everything else gives up.",
    // Villain raises monsters (sets / AK, all beat AJ) and folds QQ/JT. Betting gets
    // raised exactly when behind and folds out the hands you beat (EV -0.2);
    // checking shows down vs the full range (EV ~0.41). Showcases policy + raise.
    state: {
      heroHand: hand("As", "Js"), board: hand("Ad", "8c", "3h", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("8d", "8h"), weight: 1 }, { combo: hand("3d", "3c"), weight: 1 },
                { combo: hand("Ah", "Kh"), weight: 1 }, { combo: hand("Qh", "Qc"), weight: 1 },
                { combo: hand("Jh", "Th"), weight: 1 }],
        policy: (combo: Combo) => {
          const a = rankOf(combo[0]), b = rankOf(combo[1]);
          const monster = (a === b && (a === 8 || a === 3)) || (a === 14 && b === 13) || (a === 13 && b === 14);
          return [{ action: { kind: "fold" }, weight: monster ? 0 : 1 },
                  { action: { kind: "call" }, weight: 0 },
                  { action: { kind: "bet", size: 1 }, weight: monster ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, raiseCap: 1 },
    },
  },
  {
    id: "p5-thin-value-vs-range",
    module: "P5",
    title: "Exploit: top pair against a range that continues only with better",
    ask: "action",
    read: "Villain calls only with a better hand and folds worse.",
    // Villain calls only with AK (which beats AJ) and folds QQ. So betting gets
    // called only when behind (range narrows); checking shows down vs the full
    // range and wins vs QQ. Check (EV ~0.51) beats betting (~0.10).
    state: {
      heroHand: hand("As", "Js"), board: hand("Ad", "8c", "3h", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Kh"), weight: 1 }, { combo: hand("Qh", "Qc"), weight: 1 }],
        policy: (combo: Combo) => {
          const hasKing = rankOf(combo[0]) === 13 || rankOf(combo[1]) === 13;
          return [{ action: { kind: "fold" }, weight: hasKing ? 0 : 1 },
                  { action: { kind: "call" }, weight: hasKing ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p5-thin-value-station",
    module: "P5",
    title: "Exploit: value bet thin against a calling station",
    ask: "action",
    read: "Villain is a calling station — he calls any bet with any pair or draw and never raises or folds.",
    // The mirror of the fold-happy exploits: against someone who NEVER folds, widen your VALUE bets, don't bluff.
    // Hero As 4d = top pair, weak kicker on Ah 9c 5d 2s -- a hand you'd often check against a thinking player, but
    // the station calls with worse aces and pairs (9h 8h) and second-best kings (Kc Qd). Bet 0.75 (1.61) crushes
    // checking (0.94): get thin value from a hand that pays off, since he'll never fold the worse ones out.
    state: {
      heroHand: hand("As", "4d"), board: hand("Ah", "9c", "5d", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9h", "8h"), weight: 1 }, { combo: hand("Kc", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p3-3bet-the-nuts",
    module: "P3",
    title: "Raise lines: facing a bet on the turn with the nuts",
    ask: "action",
    read: "Villain has bet; villain will call a raise but never re-raises.",
    // heroFacesBet + raiseCap 1: hero faces villain's pot bet holding the nuts.
    // Re-raising (3-bet, EV 5) beats flatting (EV 2); flatting under-extracts.
    state: {
      heroHand: hand("9s", "8s"), board: hand("7s", "6s", "5s", "2d"), // straight flush
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Kd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p3-value-raise-turn",
    module: "P3",
    title: "Raise lines: facing a turn bet with top two pair",
    read: "Villain has bet; he pays off a raise with his one-pair hands but never re-raises.",
    ask: "action",
    // Value-raise a NON-nut strong hand (the discrimination with p3-3bet-the-nuts, which raises the stone nuts).
    // Hero Ah Kh = top two pair on Ac Kd 7c 2s. Villain bets and calls a raise with a worse made hand (As Qd = a
    // pair of aces, weaker kicker). Re-raising (EV 5) beats flatting (2): raise for value even when you're not the nuts.
    state: {
      heroHand: hand("Ah", "Kh"), board: hand("Ac", "Kd", "7c", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("As", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p3-3bet-semibluff",
    module: "P3",
    title: "Raise lines: 3-betting a big draw as a semi-bluff",
    read: "Villain has bet his overpair; he folds it to a raise about half the time and never re-raises.",
    ask: "action",
    // 3-bet (re-raise) as a SEMI-BLUFF -- the draw analogue of value-raising the nuts. Hero 9s8s = an open-ended
    // straight-flush draw on 7s 6d 2h Ks. Raising villain's overpair (Ah Ad) folds it out ~50% AND still has a
    // huge draw when called. Re-raising (0.53) beats flatting (0.02): a big draw plays the raise, not just the call.
    state: {
      heroHand: hand("9s", "8s"), board: hand("7s", "6d", "2h", "Ks"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Ad"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0.5 }, { action: { kind: "call" }, weight: 0.5 }],
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p3-flat-to-trap",
    module: "P3",
    title: "Raise lines: flatting the nuts to trap",
    read: "Villain is barreling a bluffy range; he folds to a raise but keeps betting if you just call.",
    ask: "action",
    // The opposite of raising for value: sometimes you FLAT the nuts to keep villain bluffing. Hero AsKs = a
    // royal flush on Qs Js Ts 4h. If you raise, villain gives up (EV 2); if you just call, he barrels the river
    // and you collect another bet (EV 5). Flatting a monster to induce more bluffs beats raising them off it.
    state: {
      heroHand: hand("As", "Ks"), board: hand("Qs", "Js", "Ts", "4h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9h", "9d"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => {
          const facing = legal.some((a) => a.kind === "fold");
          if (facing) return legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 1 : 0 }));
          return legal.map((a) => ({ action: a, weight: a.kind === "bet" ? 1 : 0 }));
        },
      },
      abstraction: { sizes: [1.0], streets: ["turn", "river"], players: 2, heroFacesBet: 1.0, raiseCap: 1, villainLeads: true },
    },
  },
  {
    id: "p3-three-street-value",
    module: "P3",
    title: "Multi-street lines: top two pair for three streets of value",
    read: "Villain calls any bet down with a worse hand (a calling station).",
    ask: "action",
    // Plan the WHOLE hand, not one street. Hero AsQs = top two pair on Ah Qd 4c; a station calls flop, turn AND
    // river with a worse ace, so bet all three streets to build the biggest pot. Checking any street leaves value
    // behind. (The Pillar-2 counterpart of M4's sequencing, against a fixed calling range.)
    state: {
      heroHand: hand("As", "Qs"), board: hand("Ah", "Qd", "4c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ad", "Jc"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn", "river"], players: 2 },
    },
  },
  {
    id: "p3-delayed-cbet",
    module: "P3",
    title: "Multi-street lines: checking a strong hand to induce",
    read: "Villain folds his air to a flop bet — but if you check, he bets it as a bluff.",
    ask: "action",
    // Delayed c-bet / induce: betting now folds out the hands you beat, so CHECK the flop and let villain bluff.
    // Hero AsAd is an overpair on Kc 7d 2h; villain's air (Qh Jh) folds to a flop bet but bets if checked to.
    // Checking (EV 4.27, hero collects the bluff and can bet the turn) beats betting (1.00). Check strong to trap.
    state: {
      heroHand: hand("As", "Ad"), board: hand("Kc", "7d", "2h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qh", "Jh"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => {
          const facing = legal.some((a) => a.kind === "fold");
          if (facing) return legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 1 : 0 }));
          return legal.map((a) => ({ action: a, weight: a.kind === "bet" ? 1 : 0 }));
        },
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2, villainLeads: true },
    },
  },
  {
    id: "p3-pot-control",
    module: "P3",
    title: "Multi-street lines: a medium top pair on the turn",
    read: "You bet the flop and were called. Villain continues only with a hand that beats you; the rest is near-dead.",
    ask: "action",
    // Pot control. Hero KsQd = top pair (queens) with only a king kicker. A turn bet
    // gets called only by the BETTER part of the range (AQ, which dominates the
    // kicker) and folds out the near-dead part (88, ~2 outs) -> betting into strength
    // for no value. Checking realizes showdown value vs the whole range and keeps the
    // pot small. Check (EV 0.511) beats bet (0.102); betting is p3.overbets_multistreet.
    state: {
      heroHand: hand("Ks", "Qd"), board: hand("Qc", "9h", "5d", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ac", "Qh"), weight: 1 }, { combo: hand("8s", "8d"), weight: 1 }],
        policy: (combo: Combo) => {
          const ace = rankOf(combo[0]) === 14 || rankOf(combo[1]) === 14;
          return [{ action: { kind: "fold" }, weight: ace ? 0 : 1 },
                  { action: { kind: "call" }, weight: ace ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  // ---- P3.5 River decisions: call/raise/fold on a final board (heroFacesBet) ----
  {
    id: "p35-river-value-raise",
    module: "P3.5",
    title: "River decisions: a strong hand facing a bet",
    read: "Villain bets a hand you beat and will call a raise.",
    ask: "action",
    // Hero 9h9s = a set of nines on Ac 9d 4s 2c 7h (river, hand is final). Villain
    // bets a worse hand (AK, top pair) and pays off a raise. Raising (EV 5) beats
    // flat-calling (EV 2): on the river, raise your strong hands for value.
    state: {
      heroHand: hand("9h", "9s"), board: hand("Ac", "9d", "4s", "2c", "7h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Kd"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p35-river-thin-value",
    module: "P3.5",
    title: "River decisions: two pair facing a bet",
    read: "Villain bets some hands you beat and some you don't; only the better ones call a raise.",
    ask: "action",
    // Hero As9s = two pair (aces & nines). Villain bets {7s7c set (beats you), AhKd
    // top pair (you beat)}, but calls a raise only with the set. Raising folds out the
    // worse hand and gets called only by the better one (EV -1); just CALL (EV 0.5) to
    // keep the worse value in. A value hand, but raising is too thin. p35.raises_into_better.
    state: {
      heroHand: hand("As", "9s"), board: hand("Ac", "9d", "4s", "2c", "7h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("7s", "7c"), weight: 1 }, { combo: hand("Ah", "Kd"), weight: 1 }],
        policy: (combo: Combo) => {
          const set = rankOf(combo[0]) === 7 || rankOf(combo[1]) === 7;
          return [{ action: { kind: "fold" }, weight: set ? 0 : 1 },
                  { action: { kind: "call" }, weight: set ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p35-river-bluff-catch",
    module: "P3.5",
    title: "River decisions: top pair facing a bet",
    read: "Villain bets his big hands AND his busted draws.",
    ask: "action",
    // Hero AsKd = top pair aces. Villain bets a POLARIZED range {9h9s set (value),
    // KcQc busted draw (a bluff)}. Calling catches the bluff and shows down (EV 0.5);
    // raising folds the bluff and is called only by the set (EV -1); folding gives up
    // vs the bluff. Bluff-catch = CALL. p35.overfolds_the_river / p35.raises_into_better.
    state: {
      heroHand: hand("As", "Kd"), board: hand("Ac", "9d", "4s", "2c", "7h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9h", "9s"), weight: 1 }, { combo: hand("Kc", "Qc"), weight: 1 }],
        policy: (combo: Combo) => {
          const set = rankOf(combo[0]) === 9 || rankOf(combo[1]) === 9;
          return [{ action: { kind: "fold" }, weight: set ? 0 : 1 },
                  { action: { kind: "call" }, weight: set ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  {
    id: "p35-river-multiway-fold",
    module: "P3.5",
    title: "River decisions: top pair in a four-way pot",
    read: "Three others already called this bet; a range that keeps firing four-way is all value.",
    ask: "action",
    // SAME top pair (AsKd) and board as the bluff-catch — but the read makes it a
    // four-way pot, so the range is CONDENSED to value (two sets + a two pair), no
    // bluffs. Now calling loses (EV -1) and folding (EV 0) is best. The discrimination
    // contrast with p35-river-bluff-catch: same hand, stronger range -> call becomes
    // fold. Multiway, tighten your bluff-catches. Calling is p35.pays_off_the_river.
    state: {
      heroHand: hand("As", "Kd"), board: hand("Ac", "9d", "4s", "2c", "7h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9h", "9s"), weight: 1 }, { combo: hand("4h", "4d"), weight: 1 }, { combo: hand("Ah", "9c"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.0, raiseCap: 1 },
    },
  },
  // ---- P3.5 read the bet SIZE: small = bluffy (call), overbet = value (fold) ----
  {
    id: "p35-call-small-bet",
    module: "P3.5",
    title: "River decisions: a small bet with top pair",
    read: "A small bet is cheap and often a bluff — villain fires his busted draws this size too.",
    ask: "action",
    // Reading the size. Hero KcQd = top pair (a bluff-catcher) on Ks 8h 3c 2d 7s. A SMALL (⅓-pot) bet
    // comes from a bluffy range {a set (value), a busted draw QhJh (bluff)}: you beat half of it at a cheap
    // price -> CALL (0.50). Folding over-folds; raising folds out the bluff you beat (−0.33).
    state: {
      heroHand: hand("Kc", "Qd"), board: hand("Ks", "8h", "3c", "2d", "7s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("3s", "3d"), weight: 1 }, { combo: hand("Qh", "Jh"), weight: 1 }],
        policy: (combo: Combo) => {
          const set = rankOf(combo[0]) === 3 || rankOf(combo[1]) === 3 || rankOf(combo[0]) === 8 || rankOf(combo[1]) === 8;
          return [{ action: { kind: "fold" }, weight: set ? 0 : 1 }, { action: { kind: "call" }, weight: set ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 0.33, raiseCap: 1 },
    },
  },
  {
    id: "p35-fold-an-overbet",
    module: "P3.5",
    title: "River decisions: a big overbet with the same top pair",
    read: "A big overbet is expensive and usually value — few players overbet as a bluff.",
    ask: "action",
    // SAME KcQd top pair, same board — but a 1.5x OVERBET. Big bets come from a value-heavy range {two
    // sets, one lone bluff}: you beat only a third at a bad price -> FOLD (calling is −0.17). The size reads
    // the range: small = bluffy (call, see p35-call-small-bet), big = strong (fold). Discrimination pair.
    state: {
      heroHand: hand("Kc", "Qd"), board: hand("Ks", "8h", "3c", "2d", "7s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("3s", "3d"), weight: 1 }, { combo: hand("8s", "8c"), weight: 1 }, { combo: hand("Qh", "Jh"), weight: 1 }],
        policy: (combo: Combo) => {
          const set = rankOf(combo[0]) === 3 || rankOf(combo[1]) === 3 || rankOf(combo[0]) === 8 || rankOf(combo[1]) === 8;
          return [{ action: { kind: "fold" }, weight: set ? 0 : 1 }, { action: { kind: "call" }, weight: set ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2, heroFacesBet: 1.5, raiseCap: 1 },
    },
  },
  {
    id: "m0-read-two-pair",
    module: "M0",
    title: "Hand reading: a high, two-tone board",
    ask: "category",
    state: {
      heroHand: hand("Ac", "Kd"), board: hand("Ah", "Kh", "7c"), // two pair, aces & kings
      pot: 1, toAct: "hero",
      villain: { range: [] }, // villain irrelevant for hand-reading
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-combo-draw",
    module: "M2",
    title: "Rule of 2&4 with the big-draw correction (open-ender + flush draw)",
    ask: "estimate",
    state: {
      heroHand: hand("Js", "Ts"), board: hand("9s", "8s", "2c"), // ~15 outs (flush + open-ender); naive 4x over-counts
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-wide-range",
    module: "M5",
    title: "Equity vs a wider range: AK high vs sets and an underpair",
    ask: "estimate",
    state: {
      heroHand: hand("Ah", "Kh"), board: hand("Qd", "Js", "5c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ac", "Ad"), weight: 1 },
                         { combo: hand("Kc", "Kd"), weight: 1 },
                         { combo: hand("Tc", "Td"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p1-akx-vs-qq-race",
    module: "P1",
    title: "Preflop ranges: suited AK vs a bigger pocket pair",
    ask: "estimate",
    state: {
      heroHand: hand("As", "Ks"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qh", "Qd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p1-ak-vs-aq",
    module: "P1",
    title: "Preflop ranges: ace-king against ace-queen",
    ask: "estimate",
    // Domination: they share the ace, so hero's king outkicks the queen. The
    // dominated hand is drawing thin (mostly a queen) -> ~74% (a full runout, ~3s).
    state: {
      heroHand: hand("As", "Kh"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Qc"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p1-suited-connector-vs-aces",
    module: "P1",
    title: "Preflop ranges: a suited connector against aces",
    ask: "estimate",
    // A suited connector is crushed by an overpair but not drawing dead: straights, flushes and two pair keep
    // hero around 23% against pocket aces preflop (a full runout, ~3s). Small pairs and connectors need a cheap
    // price and deep stacks precisely because they're this far behind a big pair heads-up.
    state: {
      heroHand: hand("8h", "7h"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("As", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p1-dominated-ace",
    module: "P1",
    title: "Preflop ranges: a weak ace against a bigger one",
    ask: "estimate",
    // The wrong side of domination (the mirror of AK vs AQ). Hero's A-5 shares the ace with A-K, so hero is
    // outkicked and drawing mostly to a five or a runner-runner -> only ~26% preflop. Being dominated is why
    // weak aces play so poorly against a raising range: you make top pair and are still behind.
    state: {
      heroHand: hand("Ah", "5c"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("As", "Ks"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p1-overcards-vs-pair-race",
    module: "P1",
    title: "Preflop ranges: two overcards against the smallest pair",
    ask: "estimate",
    // The classic coin flip. Ace-king against a pair of twos is almost exactly even (~47%) -- even the smallest
    // pair is a slight favorite over two overcards preflop, because it's ahead until an ace or king pairs. 'A
    // race' means roughly 50/50; here the pair edges it, which is why a pair is never a big underdog preflop.
    state: {
      heroHand: hand("Ah", "Kc"), board: [],
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("2s", "2d"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-read-straight",
    module: "M0",
    title: "Hand reading: a low connected board",
    ask: "category",
    state: {
      heroHand: hand("Ts", "9d"), board: hand("8c", "7h", "6s"), // T-9-8-7-6 straight (cat 4)
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-nut-broadway",
    module: "M0",
    title: "Hand reading: a high, connected board",
    ask: "category",
    // Hero's ten completes A-K-Q-J-T (broadway) -> a straight (cat 4), and with no
    // pair or flush on the board it is the NUTS. Teaches recognizing the best hand.
    state: {
      heroHand: hand("Tc", "5d"), board: hand("As", "Kd", "Qc", "Jh", "9s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M0 "name the nuts": the best hand the BOARD allows (board-only, ask:"nuts") ----
  {
    id: "m0-nuts-flush",
    module: "M0",
    title: "Name the nuts: three of a suit on the board",
    ask: "nuts",
    // As 9s 4s Kd 2c: three spades, unpaired -> the best possible hand is a FLUSH
    // (cat 5); no straight/full house can form. Recognizing a flush-possible board.
    state: {
      board: hand("As", "9s", "4s", "Kd", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-nuts-straight",
    module: "M0",
    title: "Name the nuts: a connected board",
    ask: "nuts",
    // Js Td 9c 4h 2s: J-T-9 with no flush possible -> K-Q makes K-Q-J-T-9, a
    // STRAIGHT (cat 4) — the best hand the board allows.
    state: {
      board: hand("Js", "Td", "9c", "4h", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-nuts-quads",
    module: "M0",
    title: "Name the nuts: a paired board",
    ask: "nuts",
    // Ks Kd 8c 5h 2s: the board is paired, so whoever holds the other two kings has
    // four of a kind -> QUADS (cat 7) is the nuts. Paired boards enable quads/boats.
    state: {
      board: hand("Ks", "Kd", "8c", "5h", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M0 misread traps (common beginner errors) ----
  {
    id: "m0-counts-board-pair",
    module: "M0",
    title: "Hand reading: a paired board",
    ask: "category",
    state: {
      // A-K on K-8-8-4-2: best is K K 8 8 A -> TWO PAIR (the board's pair counts). Misread: one pair.
      heroHand: hand("Ac", "Kd"), board: hand("Ks", "8h", "8d", "4c", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-wheel",
    module: "M0",
    title: "Hand reading: an ace with three low cards",
    ask: "category",
    state: {
      // A-2 on 3-4-5-K-9: A-2-3-4-5 = the wheel STRAIGHT (cat 4). Misread: ace-high / high card.
      heroHand: hand("As", "2h"), board: hand("3d", "4c", "5s", "Kh", "9d"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-play-the-board-straight",
    module: "M0",
    title: "Hand reading: a fully connected board",
    ask: "category",
    state: {
      // 2-2 on 5-6-7-8-9: the BOARD is a straight (cat 4) and beats your pair of twos. Misread: one pair.
      heroHand: hand("2c", "2s"), board: hand("5d", "6c", "7h", "8s", "9d"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-flush-trap",
    module: "M0",
    title: "Hand reading: three of a suit on the board",
    ask: "category",
    state: {
      // K-2 on A-8-3(all hearts)-K-5: only 4 hearts total (board 3 + your 1) -> NO flush; best is a pair of kings.
      heroHand: hand("Kh", "2c"), board: hand("Ah", "8h", "3h", "Kd", "5c"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-flush-count",
    module: "M0",
    title: "Hand reading: three of your suit are on the board",
    ask: "category",
    state: {
      // A-5 of diamonds on K-9-4(diamonds)-7-2: your 2 + board's 3 = 5 diamonds -> FLUSH (cat 5). Misread: ace-high.
      heroHand: hand("Ad", "5d"), board: hand("Kd", "9d", "4d", "7c", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-fullhouse-pocket-pair",
    module: "M0",
    title: "Hand reading: a pocket pair on a paired board",
    ask: "category",
    state: {
      // 7-7 on 7-K-K-2-9: 7 7 7 + K K = FULL HOUSE (cat 6). Misread: trips (the third seven only) or two pair.
      heroHand: hand("7h", "7d"), board: hand("7s", "Kc", "Kd", "2h", "9s"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-straight-flush",
    module: "M0",
    title: "Hand reading: a connected, single-suit board",
    ask: "category",
    state: {
      // T-9 of hearts on 6-7-8(hearts)-2-K: 6-7-8-9-T all hearts = STRAIGHT FLUSH (cat 8). Misread: flush or straight.
      heroHand: hand("Th", "9h"), board: hand("6h", "7h", "8h", "2c", "Kd"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-trips",
    module: "M0",
    title: "Hand reading: you match the board's pair",
    ask: "category",
    state: {
      // A-9 on 9-9-K-2-5: three nines = THREE OF A KIND (cat 3). Common over-read: "full house" (a paired
      // board feels like a boat) — but there's no second pair.
      heroHand: hand("Ac", "9d"), board: hand("9s", "9h", "Kd", "2c", "5h"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-quads",
    module: "M0",
    title: "Hand reading: a pocket pair meets a paired board",
    ask: "category",
    state: {
      // 9-9 on 9-9-K-2-5: all four nines = FOUR OF A KIND (cat 7). Easy to under-read as trips or a full house.
      heroHand: hand("9c", "9s"), board: hand("9d", "9h", "Kc", "2s", "5h"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m0-high-card",
    module: "M0",
    title: "Hand reading: nothing connects",
    ask: "category",
    state: {
      // A-Q on K-9-4-2-7 (rainbow): no pair, straight, or flush -> just HIGH CARD (cat 0). Don't overvalue ace-high.
      heroHand: hand("Ac", "Qd"), board: hand("Ks", "9h", "4c", "2s", "7d"),
      pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-open-ender",
    module: "M1",
    title: "Counting outs: which cards make you the best hand?",
    ask: "outs",
    state: {
      heroHand: hand("9h", "8d"), board: hand("7s", "6c", "2h"), // OESD: 5 or T (8 outs)
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M1 commonly-miscounted spots ----
  {
    id: "m1-gutshot",
    module: "M1",
    title: "Counting outs: count the cards that win",
    ask: "outs",
    state: {
      // 9-8 on 7-5-2 vs AA: only a 6 completes 9-8-7-6-5 = 4 outs (a gutshot, not 8). Pairing loses to aces.
      heroHand: hand("9d", "8c"), board: hand("7s", "5h", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ac", "As"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-overcards",
    module: "M1",
    title: "Counting outs: how many outs do you have?",
    ask: "outs",
    state: {
      // A-K on 9-5-2 vs 77: pairing the A or K (3 + 3 = 6 outs) beats the small pair. Nothing else wins.
      heroHand: hand("As", "Kd"), board: hand("9c", "5d", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("7d", "7c"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-combo-draw-outs",
    module: "M1",
    title: "Counting outs: count your outs against a big hand",
    ask: "outs",
    state: {
      // J-T hearts on 9-8(hearts)-2 vs AA: flush draw (9) + open-ender (Q,7). The Q/7 of hearts are already
      // flush outs, so it's 9 + 6 = 15 — NOT 9 + 8 = 17. The classic double-count trap.
      heroHand: hand("Jh", "Th"), board: hand("9h", "8h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("As", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-tainted-flush-out",
    module: "M1",
    title: "Counting outs: careful — not every winner is clean",
    ask: "outs",
    state: {
      // A-Q of spades on K-7-2(K,7 spades) vs a set of kings: a flush draw looks like 9, but the 2♠ pairs the
      // board and gives the set a full house that beats the flush. So it's 8 clean outs, not 9 (discount the taint).
      heroHand: hand("As", "Qs"), board: hand("Ks", "7s", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kd", "Kc"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-gutshot-2",
    module: "M1",
    title: "Counting outs: how many cards complete your draw?",
    ask: "outs",
    state: {
      // Q-J on T-8-2 vs AA: only a 9 makes Q-J-T-9-8 = 4 outs (a second gutshot, different board).
      heroHand: hand("Qd", "Jc"), board: hand("Ts", "8h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ac", "As"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-flush-draw-2",
    module: "M1",
    title: "Counting outs: count every card that wins",
    ask: "outs",
    state: {
      // Q-J of clubs on A-7(clubs)-3 vs KK: a flush draw is 9 outs (a second flush draw, different board/suit).
      heroHand: hand("Qc", "Jc"), board: hand("Ac", "7c", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kd", "Ks"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-one-overcard",
    module: "M1",
    title: "Counting outs: how many winners are there?",
    ask: "outs",
    state: {
      // A-7 on 9-5-2 vs KK: only ONE overcard (the ace); pairing it = 3 outs. The 7 doesn't beat kings.
      heroHand: hand("Ac", "7s"), board: hand("9d", "5c", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kd", "Ks"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-flush-plus-gutshot",
    module: "M1",
    title: "Counting outs: add up all your outs",
    ask: "outs",
    state: {
      // J-9 of clubs on Q-8(clubs)-2 vs AA: flush draw (9) + a gutshot to a ten (Q-J-T-9-8). The T of clubs is
      // already a flush out, so it's 9 + 3 = 12 — not 9 + 4 = 13. Combine draws without double-counting the overlap.
      heroHand: hand("Jc", "9c"), board: hand("Qc", "8c", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-double-gutshot",
    module: "M1",
    title: "Counting outs: look again — how many outs?",
    ask: "outs",
    state: {
      // T-4 on 6-7-8 vs AA: looks like nothing, but it's a double belly-buster — a 5 makes 4-5-6-7-8 AND a 9
      // makes 6-7-8-9-T. Two gutshots = 8 outs, the same as an open-ender (easy to undercount as 0 or 4).
      heroHand: hand("Td", "4c"), board: hand("6s", "7h", "8d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ac", "As"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-set-mining",
    module: "M1",
    title: "Counting outs: a pocket pair hunting for a set",
    ask: "outs",
    state: {
      // The smallest draw. Hero 6c6d is behind villain's two pair (Ah Kh) on As Kd 9h; only the two remaining
      // sixes make a set that wins -> just 2 outs. Tiny, which is exactly why set-mining needs big implied odds.
      heroHand: hand("6c", "6d"), board: hand("As", "Kd", "9h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-oesd-behind-a-set",
    module: "M1",
    title: "Counting outs: an open-ender against a made set",
    ask: "outs",
    state: {
      // A second open-ender, this time chasing a made hand. Hero Ts9s on 8h 7c 2d is behind villain's set of
      // twos; only a straight wins -> a J (4) or a 6 (4) = 8 outs. Overcards don't help when you're drawing to beat a set.
      heroHand: hand("Ts", "9s"), board: hand("8h", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("2s", "2c"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-pair-plus-flush-draw",
    module: "M1",
    title: "Counting outs: a pair with a flush draw against an overpair",
    ask: "outs",
    state: {
      // A made pair that's still behind, PLUS a draw. Hero 9h8h on 9c 5h 2h has middle pair and a flush draw vs
      // aces. Outs to beat the overpair: 9 flush cards + 2 more nines (trips) + 3 eights (two pair) = 14 outs.
      // Count every way to improve, not just the flush.
      heroHand: hand("9h", "8h"), board: hand("9c", "5h", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ac", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-overcards-plus-gutshot",
    module: "M1",
    title: "Counting outs: two overcards and a gutshot",
    ask: "outs",
    state: {
      // Add up the pieces. Hero AhTs on Qc Jd 5h is behind a pair of eights; a king makes the straight (4),
      // and EITHER an ace or a ten pairs a card that beats eights (3 + 3). 4 + 3 + 3 = 10 outs — count the
      // straight cards AND both overcards.
      heroHand: hand("Ah", "Ts"), board: hand("Qc", "Jd", "5h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("8h", "8d"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-pair-plus-oesd",
    module: "M1",
    title: "Counting outs: a pair with an open-ender against an overpair",
    ask: "outs",
    state: {
      // A made pair that's still behind, plus a straight draw. Hero Ts9s has a pair of tens and an open-ender on
      // 8h 7c 2d Td vs aces. Outs to beat the overpair: a jack (4) or a six (4) for the straight, two more tens
      // (trips), and three nines (two pair) = 4 + 4 + 2 + 3 = 13. Count the straight outs AND the pair improvements.
      heroHand: hand("Ts", "9s"), board: hand("8h", "7c", "2d", "Td"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m1-middle-pair-behind",
    module: "M1",
    title: "Counting outs: a middle pair behind an overpair",
    ask: "outs",
    state: {
      // A common, small draw. Hero 9s8c has middle pair on 9h 5d 2c but is behind villain's aces. Only improving
      // wins: two more nines make trips (2), and three eights make two pair (3) = 5 outs. A pair that's behind is
      // usually drawing to just a handful of cards.
      heroHand: hand("9s", "8c"), board: hand("9h", "5d", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-bad-odds-fold",
    module: "M3",
    title: "Pot odds: fold a weak draw at a bad price",
    ask: "action",
    state: {
      heroHand: hand("7h", "6h"), board: hand("As", "Ks", "2c"),
      pot: 1, toCall: 1, toAct: "hero", // need 50%, hero ~1.5% (near-dead) -> fold; calling is the leak
      villain: { range: [{ combo: hand("Ah", "Tc"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M3 coverage: the price decides (same draw, two prices) ----
  {
    id: "m3-flush-draw-call",
    module: "M3",
    title: "Pot odds: a flush draw, small bet to call",
    ask: "action",
    state: {
      // 9-out flush draw on the turn (~20%) getting 5:1 (break-even 16.7%): a +EV CALL. Folding is the leak.
      heroHand: hand("8s", "3s"), board: hand("Ks", "Js", "2h", "5d"),
      pot: 5, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-flush-draw-fold",
    module: "M3",
    title: "Pot odds: the same flush draw, big bet to call",
    ask: "action",
    state: {
      // The SAME ~20% flush draw, now facing a pot-size bet (break-even 50%): a FOLD. Calling is the leak.
      heroHand: hand("8s", "3s"), board: hand("Ks", "Js", "2h", "5d"),
      pot: 2, toCall: 2, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-gutshot-fold",
    module: "M3",
    title: "Pot odds: a gutshot facing a bet",
    ask: "action",
    state: {
      // 4-out gutshot on the turn (~9%) facing 3:1 (break-even 25%): a FOLD — small draws rarely get the price.
      heroHand: hand("Kd", "Qc"), board: hand("Js", "9h", "2c", "5s"),
      pot: 3, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-oesd-call",
    module: "M3",
    title: "Pot odds: an open-ender getting a great price",
    ask: "action",
    state: {
      // 8-out open-ender on the turn (~18%) getting 6:1 (break-even 14.3%): a +EV CALL. A bigger draw than a
      // gutshot can profitably call a bet a gutshot must fold to. Folding here is the leak.
      heroHand: hand("Ts", "9s"), board: hand("8h", "7c", "2d", "Kd"),
      pot: 6, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-oesd-fold",
    module: "M3",
    title: "Pot odds: the same open-ender at a bad price",
    ask: "action",
    state: {
      // The SAME ~18% open-ender, now facing a bigger bet (2:3 -> break-even 40%): a FOLD. Even eight outs
      // isn't enough when the price is wrong. Calling is the leak. (Pairs with m3-oesd-call: price decides.)
      heroHand: hand("Ts", "9s"), board: hand("8h", "7c", "2d", "Kd"),
      pot: 1.5, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m3-combo-draw-call",
    module: "M3",
    title: "Pot odds: a big combo draw facing a bet",
    ask: "action",
    state: {
      // Big combo draw (flush + open-ender, ~34%) facing 3:1 (break-even 25%): a clear CALL. Folding is the leak.
      heroHand: hand("Qh", "Jh"), board: hand("Th", "9h", "3c", "4s"),
      pot: 3, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "p4-strong-multiway",
    module: "P4",
    title: "Multiway: top pair top kicker vs a two-opponent field",
    ask: "estimate",
    state: {
      heroHand: hand("As", "Ks"), board: hand("Ad", "8c", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qh", "Jh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "p4-tptk-4way",
    module: "P4",
    title: "Multiway: top pair top kicker against a THREE-opponent field",
    ask: "estimate",
    // Same TPTK/board as p4-strong-multiway, one more opponent: equity falls again (~0.838 three-way ->
    // ~0.766 four-way). Every player you add takes another slice — a strong hand is worth less each time.
    state: {
      heroHand: hand("As", "Ks"), board: hand("Ad", "8c", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qh", "Jh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 4 },
    },
  },
  {
    id: "p4-overpair-diluted",
    module: "P4",
    title: "Multiway: an overpair against a two-opponent field",
    ask: "estimate",
    // Dilution on a made hand. Aces are ~78% heads-up against this range but only ~61% three-way -- to win
    // you must beat BOTH opponents, and each extra player is another shot at a set or a made draw. Still ahead,
    // but far from the lock it is one-on-one, so lean toward charging draws over bloating the pot out of position.
    state: {
      heroHand: hand("As", "Ad"), board: hand("Kc", "9h", "4d"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Kh", "Qd"), weight: 1 }, { combo: hand("Jh", "Th"), weight: 1 }, { combo: hand("9c", "8c"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "p4-flushdraw-diluted",
    module: "P4",
    title: "Multiway: a bare flush draw against a two-opponent field",
    ask: "estimate",
    // Draws hate a crowd. Hero 8h9h is ~30% heads-up against this range, but three-way it collapses to ~9%:
    // you have to fade TWO made hands and out-draw both. A draw that's a fine call heads-up is often a fold
    // multiway -- the field is likely to already have you beaten AND to keep a better draw live.
    state: {
      heroHand: hand("8h", "9h"), board: hand("Kh", "7h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kc", "Qd"), weight: 1 }, { combo: hand("Ah", "Th"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "p4-two-pair-diluted",
    module: "P4",
    title: "Multiway: top two pair against a two-opponent field",
    ask: "estimate",
    // Even a strong made hand is roughly halved. Hero KcQd = top two pair on Kh Qh 5c; heads-up it's ~56%
    // against this draw-heavy spot, but three-way it drops to ~31% -- you must beat BOTH opponents and one of
    // them is likely getting there. Strong hands stay bet-worthy multiway, but they're no longer favorites.
    state: {
      heroHand: hand("Kc", "Qd"), board: hand("Kh", "Qh", "5c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Jh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "p4-weak-draw-diluted",
    module: "P4",
    title: "Multiway: a gutshot against a two-opponent field",
    ask: "estimate",
    // A weak draw is nearly dead in a crowd. Hero Kd Qc has just a gutshot on Js 9h 2c; heads-up it's ~19%,
    // but three-way it falls to about 3% -- against two hands you must both improve AND still be best. Small
    // draws that are marginal heads-up are automatic folds multiway.
    state: {
      heroHand: hand("Kd", "Qc"), board: hand("Js", "9h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
    },
  },
  {
    id: "m2-set-vs-overpair",
    module: "M2",
    title: "Equity: a set crushes an overpair",
    ask: "estimate",
    state: {
      heroHand: hand("7s", "7h"), board: hand("7d", "Kc", "2s"), // set of sevens
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m35-turn-semibluff",
    module: "M3.5",
    title: "Fold equity: a flush draw on the turn",
    ask: "action",
    read: "Villain folds often.",
    state: {
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d", "Jc"), // flush draw, one to come
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.6 : 0.4 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p2-thin-value",
    module: "P2",
    title: "Sizing: top pair on a dry turn against a loose caller",
    ask: "action",
    read: "Villain is a station who calls any bet, even with a worse hand.",
    state: {
      heroHand: hand("As", "Js"), board: hand("Ad", "8c", "3h", "2s"), // top pair
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qh", "Qc"), weight: 1 }], // worse; a station that calls
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
    },
  },
  // ---- P2 sizing depth: size DOWN for thin value, UP to deny equity, and overbet a capped range ----
  {
    id: "p2-bet-small-thin-value",
    module: "P2",
    title: "Sizing: top pair against hands that call small",
    read: "The worse hands that pay you off call a small bet but fold a big one; the one hand that beats you calls anything.",
    ask: "action",
    // Hero AsKd top pair (K kicker) on Ac 8d 4s 2c. Worse aces (Ah9c, weight 3) call SMALL, fold BIG; a
    // set (44, weight 1) calls anything. A 1/3 bet milks the worse aces (EV 0.83); a pot bet folds them
    // and only the set calls (0.50); checking (0.70) gives up the thin value. Size DOWN for thin value.
    state: {
      heroHand: hand("As", "Kd"), board: hand("Ac", "8d", "4s", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "9c"), weight: 3 }, { combo: hand("4h", "4d"), weight: 1 }],
        policy: (combo: Combo, s: NodeState) => {
          if (rankOf(combo[0]) === 4 || rankOf(combo[1]) === 4)
            return [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }];
          const small = s.pot <= 1.4; // pot 1 + 0.33 bet = 1.33 (small) vs 1 + 1.0 = 2.0 (big)
          return [{ action: { kind: "fold" }, weight: small ? 0 : 1 }, { action: { kind: "call" }, weight: small ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.33, 1.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p2-bet-big-deny-equity",
    module: "P2",
    title: "Sizing: an overpair on a wet board against a draw",
    read: "Villain is on a big draw — a small bet gives a fair price, a big bet folds it out.",
    ask: "action",
    // Hero KsKd overpair (65.9%) on 9h 8h 4s 2c vs a COMBO draw (JhTh: 9 hearts + 6 non-heart
    // straight cards = 15 outs, 34.1%). Betting big (1.5x, EV 1.00) folds the draw and denies all
    // of that equity; a half-pot bet (0.818) lets a 34% draw continue; checking (0.659) gives a
    // free card. Size UP to deny equity / protect the hand.
    // Villain's policy is pot-odds-RATIONAL, which is what makes the lesson honest: facing 0.5 into
    // 1 it needs 25% and has 34.1% (calling is correct); facing 1.5 into 1 it needs 37.5% and has
    // 34.1% (folding is correct). Re-authored 2026-07-20 — the old spot (AhJh flush draw only,
    // 12 outs) left just 0.045bb between the two sizes, so it graded a coin-flip as a leak.
    state: {
      heroHand: hand("Ks", "Kd"), board: hand("9h", "8h", "4s", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Jh", "Th"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const small = s.pot <= 1.7; // 1 + 0.5 = 1.5 (small) vs 1 + 1.5 = 2.5 (big)
          return [{ action: { kind: "fold" }, weight: small ? 0 : 1 }, { action: { kind: "call" }, weight: small ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.5, 1.5], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p2-overbet-capped-range",
    module: "P2",
    title: "Sizing: the nuts against a hand that can't fold",
    read: "Villain has a strong hand he won't fold to a big bet — but an enormous one would still scare him off.",
    ask: "action",
    // Hero AsTs = a royal flush (the nuts) on Ks Qs Js 4h. Villain KhKd (a set) calls a pot bet OR a 2x
    // overbet, but folds to a 3x. So the 2x OVERBET extracts the most (EV 3.0); a pot bet (2.0) leaves
    // value on the table; the 3x (1.0) folds him out. Overbet as much as they'll pay — not so much they fold.
    state: {
      heroHand: hand("As", "Ts"), board: hand("Ks", "Qs", "Js", "4h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Kd"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const calls = s.pot <= 3.1; // pot 1: +1.0->2.0 (call), +2.0->3.0 (call), +3.0->4.0 (fold)
          return [{ action: { kind: "fold" }, weight: calls ? 0 : 1 }, { action: { kind: "call" }, weight: calls ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0, 2.0, 3.0], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p2-overbet-bluff",
    module: "P2",
    title: "Sizing: a busted hand on the river against a bluff-catcher",
    read: "Villain has a medium hand that pays a normal bet but folds to a huge one.",
    ask: "action",
    // Overbet as a BLUFF — the mirror of the overbet-for-value drill. Hero KhQh = air (missed) on As 7c 4d
    // 2s 9h. Villain's bluff-catcher (a pair of aces) calls a half-pot bet but folds a 1.5x overbet. The
    // overbet (EV 1.0) folds him out and steals; a small bet (−0.5) gets called and loses; checking (0)
    // gives up. Overbet your bluffs, not just your value — a polarized range bets big with both.
    state: {
      heroHand: hand("Kh", "Qh"), board: hand("As", "7c", "4d", "2s", "9h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ac", "Tc"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const small = s.pot <= 1.7; // 1 + 0.5 = 1.5 (calls) vs 1 + 1.5 = 2.5 (folds)
          return [{ action: { kind: "fold" }, weight: small ? 0 : 1 }, { action: { kind: "call" }, weight: small ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.5, 1.5], streets: ["river"], players: 2 },
    },
  },
  {
    id: "p2-raise-sizing",
    module: "P2",
    title: "Sizing: choosing your raise size on the turn",
    read: "Villain has bet a strong hand he'll call a raise with — but an enormous one folds even him.",
    ask: "action",
    // How BIG to raise (raiseSizes = 0.5/1.0/2.0x the pot-sized raise). Hero AsTs = a royal (nuts)
    // facing villain's pot bet; the set (KhKd) calls a small or pot-sized raise but folds a huge over-raise.
    // raise-to sizes: 1.5 (EV 3.5) / 3.0 (EV 5.0, best) / 6.0 (EV 2.0 — folds him out). Raise as big as he'll
    // call, not bigger: raising too small under-extracts (p2.bets_too_small), too big folds him (p2.bets_too_big).
    state: {
      heroHand: hand("As", "Ts"), board: hand("Ks", "Qs", "Js", "4h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Kd"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const calls = s.pot <= 7.0; // raise-to pots: 0.5->4.5 (call), 1.0->6 (call), 2.0->9 (fold)
          return [{ action: { kind: "fold" }, weight: calls ? 0 : 1 }, { action: { kind: "call" }, weight: calls ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["turn"], players: 2, heroFacesBet: 1.0, raiseCap: 1, raiseSizes: [0.5, 1.0, 2.0] },
    },
  },
  {
    id: "p2-bluff-small",
    module: "P2",
    title: "Sizing: bluffing the minimum on the river",
    read: "Villain folds the same fraction of the time no matter how much you bet.",
    ask: "action",
    // Bluff sizing DOWN — the mirror of p2-overbet-bluff. Hero KhQh missed on As Kd 9c 4h 2s. Villain folds ~60%
    // to ANY bet (his fold rate doesn't move with size), so a 1/3 bet (EV 0.47) beats a pot bet (0.20): when a
    // small bet folds them just as often, risk the minimum. (Overbet only when a big bet folds MORE than a small one.)
    state: {
      heroHand: hand("Kh", "Qh"), board: hand("As", "Kd", "9c", "4h", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ac", "Td"), weight: 1 }],
        policy: (_combo: Combo, _s: NodeState) =>
          [{ action: { kind: "fold" }, weight: 0.6 }, { action: { kind: "call" }, weight: 0.4 }],
      },
      abstraction: { sizes: [0.33, 1.0], streets: ["river"], players: 2 },
    },
  },
  {
    id: "p2-protect-flop",
    module: "P2",
    title: "Sizing: protecting an overpair on a wet flop",
    read: "Villain is on a big draw with two cards to come — a small bet gives a fair price, a big bet folds it out.",
    ask: "action",
    // Protection sizing on the FLOP (the flop counterpart of the turn's p2-bet-big-deny-equity). Hero AsAd is an
    // overpair on 9h 8h 4c; villain's combo draw (JhTh, ~15 outs, ~54% with two cards) calls a half-pot bet but
    // folds a 1.5x. Betting big (EV 1.00) denies that huge draw; a small bet (0.375) prices it in; checking (0.437)
    // gives a free card. On the flop the draw has the MOST equity, so protection matters most — size up.
    state: {
      heroHand: hand("As", "Ad"), board: hand("9h", "8h", "4c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Jh", "Th"), weight: 1 }],
        policy: (_combo: Combo, s: NodeState) => {
          const small = s.pot <= 1.7; // 1 + 0.5 = 1.5 (calls) vs 1 + 1.5 = 2.5 (folds)
          return [{ action: { kind: "fold" }, weight: small ? 0 : 1 }, { action: { kind: "call" }, weight: small ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.5, 1.5], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "p2-small-cbet-dry",
    module: "P2",
    title: "Sizing: a small bet on a dry board",
    read: "There are no draws to charge; worse hands call a small bet but fold a big one.",
    ask: "action",
    // Range-bet / small c-bet on a DRY board. Hero AsKs = top pair top kicker on Kc 7d 2h -- nothing to protect
    // against, so bet SMALL and get called by more. A 1/3 bet (EV 1.20) beats a pot bet (1.00): worse pairs and
    // floats (QJ, T9, 55) pay a small bet and fold a big one. On a dry board, size down and keep them all in.
    state: {
      heroHand: hand("As", "Ks"), board: hand("Kc", "7d", "2h"),
      pot: 1, toAct: "hero",
      villain: {
        range: [
          { combo: hand("Qh", "Jd"), weight: 2 }, { combo: hand("Td", "9d"), weight: 2 }, { combo: hand("5c", "5d"), weight: 1 },
        ],
        policy: (_combo: Combo, s: NodeState) => {
          const small = s.pot <= 1.4; // 1 + 0.33 (call) vs 1 + 1.0 (fold)
          return [{ action: { kind: "fold" }, weight: small ? 0 : 1 }, { action: { kind: "call" }, weight: small ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.33, 1.0], streets: ["flop"], players: 2 },
    },
  },
  // ---- P2.5 Taking the lead: continuation bet, donk lead, check-raise ----
  {
    id: "p25-cbet",
    module: "P2.5",
    title: "Taking the lead: top pair after you raised before the flop",
    read: "You raised before the flop and villain called. He continues with a worse ace but folds his missed hands.",
    ask: "action",
    // Continuation bet. Hero AsKs = top pair top kicker on Ah 8c 3d. Villain calls a c-bet with a worse
    // ace (Ad9h) and folds a missed draw (KhQh) -> betting gets value AND fold equity; checking (0.905)
    // gives up both. Bet (1.216) is best: keep the lead you took preflop.
    state: {
      heroHand: hand("As", "Ks"), board: hand("Ah", "8c", "3d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ad", "9h"), weight: 1 }, { combo: hand("Kh", "Qh"), weight: 1 }],
        policy: (combo: Combo) => {
          const ace = rankOf(combo[0]) === 14 || rankOf(combo[1]) === 14;
          return [{ action: { kind: "fold" }, weight: ace ? 0 : 1 }, { action: { kind: "call" }, weight: ace ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.75], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "p25-donk-lead",
    module: "P2.5",
    title: "Taking the lead: a board that smashes your hand, out of position",
    read: "Villain raised before the flop; normally you'd check to him — but this board hit YOUR hand hard.",
    ask: "action",
    // Donk (lead out of position). Hero 9s8s flopped a straight on 7h 6d 5c. Rather than check to the
    // preflop raiser, lead: a set (77) pays off, overcards (KhQh) fold. Bet (0.939) beats check (0.801).
    state: {
      heroHand: hand("9s", "8s"), board: hand("7h", "6d", "5c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("7s", "7d"), weight: 1 }, { combo: hand("Kh", "Qh"), weight: 1 }],
        policy: (combo: Combo) => {
          const set = rankOf(combo[0]) === 7 || rankOf(combo[1]) === 7;
          return [{ action: { kind: "fold" }, weight: set ? 0 : 1 }, { action: { kind: "call" }, weight: set ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.75], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "p25-check-raise",
    module: "P2.5",
    title: "Taking the lead: a hidden monster facing a bet",
    read: "You checked; villain (the preflop raiser) bet his top pair. He'll pay off a raise.",
    ask: "action",
    // Check-raise. Hero 7s7d = bottom set on 7h Kc 2d. You checked to induce; villain c-bets his top pair
    // (KhQh, calls a raise) while a bluff (JhTh) folds. Raising (2.80) beats flatting (1.59): check-raise the
    // set to build the pot now.
    state: {
      heroHand: hand("7s", "7d"), board: hand("7h", "Kc", "2d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Qh"), weight: 1 }, { combo: hand("Jh", "Th"), weight: 1 }],
        policy: (combo: Combo) => {
          const king = rankOf(combo[0]) === 13 || rankOf(combo[1]) === 13;
          return [{ action: { kind: "fold" }, weight: king ? 0 : 1 }, { action: { kind: "call" }, weight: king ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2, heroFacesBet: 0.75, raiseCap: 1 },
    },
  },
  {
    id: "p25-cbet-semibluff",
    module: "P2.5",
    title: "Taking the lead: continuation-betting a draw you raised with",
    read: "You raised before the flop and villain called. He continues with his made aces but folds his missed overcards.",
    ask: "action",
    // C-bet as a SEMI-BLUFF (the draw version of p25-cbet's made-hand value bet). Hero 8h9h = a flush draw on
    // Ah Kh 4d -- behind now, but a bet folds out villain's missed overcards (Qc Jc) AND you have nine outs when
    // his ace (Ac Td) calls. Bet (0.59) beats check (0.45): keep the lead with equity plus fold equity.
    state: {
      heroHand: hand("8h", "9h"), board: hand("Ah", "Kh", "4d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ac", "Td"), weight: 1 }, { combo: hand("Qc", "Jc"), weight: 1 }],
        policy: (combo: Combo) => {
          const ace = rankOf(combo[0]) === 14 || rankOf(combo[1]) === 14;
          return [{ action: { kind: "fold" }, weight: ace ? 0 : 1 }, { action: { kind: "call" }, weight: ace ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [0.75], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "p25-check-raise-semibluff",
    module: "P2.5",
    title: "Taking the lead: check-raising a big draw as a semi-bluff",
    read: "You checked; villain (the preflop raiser) c-bet his top pair. He folds his weak overcards to a raise but calls with a pair.",
    ask: "action",
    // Check-raise as a SEMI-BLUFF (the draw version of p25-check-raise's value set). Hero 6s5s = an open-ender
    // plus a flush draw on 7s 4h 2c. Check-raising folds out villain's air (Kc Qc) now and still has a mountain of
    // outs when his pair (Ah 7h) calls. Raising (0.57) beats flatting the draw (0.31): grab the lead with a draw.
    state: {
      heroHand: hand("6s", "5s"), board: hand("7s", "4h", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "7h"), weight: 1 }, { combo: hand("Kc", "Qc"), weight: 1 }],
        policy: (combo: Combo) => {
          const pair = rankOf(combo[0]) === 7 || rankOf(combo[1]) === 7;
          return [{ action: { kind: "fold" }, weight: pair ? 0 : 1 }, { action: { kind: "call" }, weight: pair ? 1 : 0 }];
        },
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2, heroFacesBet: 0.75, raiseCap: 1 },
    },
  },
  {
    id: "p25-probe-bet",
    module: "P2.5",
    title: "Taking the lead: probing the turn after the flop checked through",
    read: "Villain checked back the flop, so his range is weak — he folds his misses to a turn bet.",
    ask: "action",
    // PROBE bet: when the preflop raiser declines to c-bet, his checked-back range is capped/weak, so lead the
    // turn to take the pot. Hero AhTd paired the ten on the turn (Qc 7h 2d Ts); villain's missed hands (Kh Jh,
    // 9s 8s) fold to the probe. Betting (1.00) beats checking (0.76): attack the weakness he showed.
    state: {
      heroHand: hand("Ah", "Td"), board: hand("Qc", "7h", "2d", "Ts"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Jh"), weight: 1 }, { combo: hand("9s", "8s"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 1 }, { action: { kind: "call" }, weight: 0 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p25-check-raise-thin-value",
    module: "P2.5",
    title: "Taking the lead: check-raising for thin value",
    read: "You checked; villain bets a worse hand he'll call a raise with. He never re-raises.",
    ask: "action",
    // Check-raise for THIN value (not a monster, not a draw — a medium made hand). Hero Ac9c = top pair, medium
    // kicker on Ah 7d 3s. You check, villain bets a worse ace (Ad 5h) and pays off a raise. Raising (2.60) beats
    // just calling (1.20): check-raise even a middling made hand when a worse one will put more money in.
    state: {
      heroHand: hand("Ac", "9c"), board: hand("Ah", "7d", "3s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ad", "5h"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) => {
          const facing = legal.some((a) => a.kind === "fold");
          if (facing) return legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 }));
          return legal.map((a) => ({ action: a, weight: a.kind === "bet" ? 1 : 0 }));
        },
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2, heroFacesBet: 0.66, raiseCap: 1 },
    },
  },
  {
    id: "p25-give-up-no-cbet",
    module: "P2.5",
    title: "Taking the lead: when NOT to continuation-bet",
    read: "You raised before the flop and missed; villain is a station who never folds.",
    ask: "action",
    // The discipline of NOT c-betting — the negative-space partner to the c-bet drills. Hero KcQc is air on
    // 8h 5d 2c and villain never folds, so a c-bet only burns chips (EV -0.04) into a hand that always calls;
    // checking (0.28) keeps the pot small and takes a cheap look. Don't auto-c-bet when you have no equity and no folds.
    state: {
      heroHand: hand("Kc", "Qc"), board: hand("8h", "5d", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9s", "9d"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [0.75], streets: ["flop"], players: 2 },
    },
  },
  // ---- P3.4 Barreling: second barrel for value, as a bluff, or give up ----
  {
    id: "p34-value-barrel",
    module: "P3.4",
    title: "Barreling: an overpair on the turn after your flop bet was called",
    read: "You bet the flop and villain called with a worse hand he won't let go of.",
    ask: "action",
    // Second barrel for VALUE. Hero AsAd overpair (80%) on the turn 9h 6c 2s 5d; villain hangs on with a
    // worse pair (9c8h) and calls. Bet (1.24) beats check (0.80): keep firing for value.
    state: {
      heroHand: hand("As", "Ad"), board: hand("9h", "6c", "2s", "5d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("9c", "8h"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-bluff-barrel",
    module: "P3.4",
    title: "Barreling: a busted hand on the turn against a weak pair",
    read: "You bet the flop and villain called with a weak pair he'll fold to a second barrel.",
    ask: "action",
    // BLUFF barrel. Hero KcQc = air (only 14% vs the pair) on 9h 6c 2s 5d — you are BEHIND — but villain's
    // weak pair (7s7d) folds to a second barrel. Betting (1.00) steals the pot; checking (0.14) shows down
    // and loses. Fire the second barrel: fold equity wins even when your hand can't.
    state: {
      heroHand: hand("Kc", "Qc"), board: hand("9h", "6c", "2s", "5d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("7s", "7d"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 1 }, { action: { kind: "call" }, weight: 0 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-give-up",
    module: "P3.4",
    title: "Barreling: a busted hand on the turn against a sticky pair",
    read: "You bet the flop and villain called; this time his pair isn't going anywhere.",
    ask: "action",
    // GIVE UP — the discrimination partner of p34-bluff-barrel: SAME KcQc air, same board, but villain's
    // pair (7s7d) now CALLS. A second barrel just burns chips (EV -0.41) into a better hand; checking (0.14)
    // gives up the pot but wastes nothing. Barrel when they fold, give up when they don't.
    state: {
      heroHand: hand("Kc", "Qc"), board: hand("9h", "6c", "2s", "5d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("7s", "7d"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-barrel-a-blank",
    module: "P3.4",
    title: "Barreling: an overpair when the turn is a blank",
    read: "You bet the flop and villain called; the turn is a harmless brick that changes nothing.",
    ask: "action",
    // Read the turn CARD. Hero KsKd overpair on Qh 8h 4c; the turn 2c is a BLANK — villain still has a
    // drawing hand (JhTh flush draw) and a worse pair (Qs9s). Keep barreling for value/protection: bet
    // (1.27) beats check (0.81). Pairs with p34-scare-card-shutdown (same hand, a scary turn instead).
    state: {
      heroHand: hand("Ks", "Kd"), board: hand("Qh", "8h", "4c", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Jh", "Th"), weight: 1 }, { combo: hand("Qs", "9s"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-scare-card-shutdown",
    module: "P3.4",
    title: "Barreling: an overpair when the turn brings a scare card",
    read: "You bet the flop and villain called; now a card comes that completes the draws and beats you.",
    ask: "action",
    // Read the turn CARD — the discrimination partner of p34-barrel-a-blank: SAME KsKd, same flop Qh 8h 4c,
    // but the turn Ah COMPLETES the flush and brings an overcard. Villain's range is now a made flush (JhTh)
    // and top pair (AcTc) — both beat you. A second barrel bleeds chips (−0.69) into a range that's ahead;
    // shut down and check (0.02). The scare card flips barrel into give-up.
    state: {
      heroHand: hand("Ks", "Kd"), board: hand("Qh", "8h", "4c", "Ah"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Jh", "Th"), weight: 1 }, { combo: hand("Ac", "Tc"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0 }, { action: { kind: "call" }, weight: 1 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-semibluff-barrel",
    module: "P3.4",
    title: "Barreling: a big draw on the turn against a made hand",
    read: "You bet the flop and villain called with top pair; he folds a big second barrel about 40% of the time.",
    ask: "action",
    // SEMI-BLUFF second barrel — distinct from the pure bluff (no equity) and the value barrel (already ahead).
    // Hero Ah Kh = nut flush draw + two overcards on the turn Qh 8h 3c 2s; villain's top pair (Qc Jd) is AHEAD
    // now, but folds 40% to the barrel AND hero still has ~15 outs when called. Betting (0.46) beats checking
    // (0.34): the barrel wins two ways — fold equity now, and a huge draw when he calls.
    state: {
      heroHand: hand("Ah", "Kh"), board: hand("Qh", "8h", "3c", "2s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qc", "Jd"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0.4 }, { action: { kind: "call" }, weight: 0.6 }],
      },
      abstraction: { sizes: [0.75], streets: ["turn"], players: 2 },
    },
  },
  {
    id: "p34-river-barrel",
    module: "P3.4",
    title: "Barreling: a third barrel on the river with a busted draw",
    read: "You barreled the flop and turn; the river bricks your draw. Villain's bluff-catcher folds to a pot-sized third barrel about 55% of the time.",
    ask: "action",
    // THIRD barrel, on the RIVER (streets:["river"], a one-round decision with no more cards — the new shape
    // among the turn-rooted barrels). Hero Jh Th missed every draw on As Kd 5c 2h 3s and has NO showdown value,
    // so checking gives up (0.00). A pot-sized bet folds villain's bluff-catcher (Qc Qd) 55% -> +0.10. With a
    // hand that can only win by betting, fire the last barrel; give up only when you have something to show down.
    state: {
      heroHand: hand("Jh", "Th"), board: hand("As", "Kd", "5c", "2h", "3s"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qc", "Qd"), weight: 1 }],
        policy: (_combo: Combo) => [{ action: { kind: "fold" }, weight: 0.55 }, { action: { kind: "call" }, weight: 0.45 }],
      },
      abstraction: { sizes: [1.0], streets: ["river"], players: 2 },
    },
  },
  // ---- M4.5 Counting combos: how many ways can a holding be dealt (with blockers)? ----
  {
    id: "m45-combos-unpaired",
    module: "M4.5",
    title: "Counting combos: how many ways can they have ace-king?",
    read: "Count the combinations of A-K, given the cards you can already see.",
    ask: "combos",
    // Unpaired base count. No ace or king is visible (hero 5c5d, board 8h 7c 2d), so all
    // 4 aces x 4 kings are available -> 16 combos. (villain.range = the TARGET holding.)
    state: {
      heroHand: hand("5c", "5d"), board: hand("8h", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m45-combos-pair",
    module: "M4.5",
    title: "Counting combos: how many ways can they have pocket aces?",
    read: "Count the combinations of a pocket pair (aces), given what you can see.",
    ask: "combos",
    // Pocket-pair base count. No ace is visible, so all 4 aces are available -> C(4,2) = 6 combos.
    state: {
      heroHand: hand("5c", "5d"), board: hand("8h", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m45-combos-blocker",
    module: "M4.5",
    title: "Counting combos: pocket aces when you hold an ace",
    read: "You hold an ace — count how many combinations of pocket aces are left for villain.",
    ask: "combos",
    // Blocker effect (discrimination with m45-combos-pair: 6 -> 3). Hero holds the A of spades,
    // so only 3 aces remain -> C(3,2) = 3 combos of pocket aces. Your blocker halves their combos.
    state: {
      heroHand: hand("As", "5d"), board: hand("8h", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m45-combos-board-blocker",
    module: "M4.5",
    title: "Counting combos: ace-king when an ace is on the board",
    read: "An ace is on the board — count how many combinations of ace-king are left for villain.",
    ask: "combos",
    // BOARD blocker (discrimination with m45-combos-unpaired: 16 -> 12). A blocker on the board removes
    // combos exactly like one in your hand. An ace is on the board, so 3 aces x 4 kings = 12 combos of A-K.
    state: {
      heroHand: hand("5c", "5d"), board: hand("Ah", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("As", "Ks"), weight: 1 }] }, // target ranks A,K -> the board ace blocks it
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m45-combos-stacked-blockers",
    module: "M4.5",
    title: "Counting combos: ace-king with a blocker in hand and one on the board",
    read: "You hold an ace and a king is on the board — count the combinations of ace-king left.",
    ask: "combos",
    // STACKED blockers (16 -> 12 -> 9): blockers add up. Hero holds one ace (3 left) and a king is on the
    // board (3 left) -> 3 x 3 = 9 combos of A-K. One card in hand AND one on the board each cut a rank.
    state: {
      heroHand: hand("As", "5d"), board: hand("Kd", "7c", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M5.7 Balance math: the GTO frequency constants (pot/bet only, no solver) ----
  // These are pure-math spots — no board or hero hand. state.pot = the pot BEFORE
  // the bet; state.toCall = the bet. The UI renders the scenario from those two.
  {
    id: "m57-mdf-pot-bet",
    module: "M5.7",
    title: "Defend: villain bets the pot",
    read: "How much of your range must you continue with so a pure bluff can't print?",
    ask: "mdf",
    // MDF = pot/(pot+bet). Pot-sized bet -> 1/(1+1) = 50%. The anchor number.
    state: {
      board: [], pot: 1, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m57-mdf-small-bet",
    module: "M5.7",
    title: "Defend: villain bets a quarter pot",
    read: "A tiny bet risks little to steal — so you must defend a lot. What fraction?",
    ask: "mdf",
    // MDF = 1/(1+0.25) = 80%. Discrimination with the pot bet (50%): smaller bet, defend MORE.
    state: {
      board: [], pot: 1, toCall: 0.25, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m57-bluff-pot-bet",
    module: "M5.7",
    title: "Bluff: you bet the pot on the river",
    read: "What fraction of your betting range should be bluffs so a bluff-catcher can't just call?",
    ask: "bluffs",
    // Bluff fraction = bet/(pot+2*bet). Pot-sized bet -> 1/3 = 33.3%: one bluff per two value bets.
    state: {
      board: [], pot: 1, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m57-bluff-half-pot",
    module: "M5.7",
    title: "Bluff: you bet half the pot on the river",
    read: "Smaller bet, better price for villain to call — so how many bluffs can you have now?",
    ask: "bluffs",
    // Bluff fraction = 0.5/(1+1) = 25%. Discrimination with the pot bet (33%): smaller bet, FEWER bluffs.
    state: {
      board: [], pot: 1, toCall: 0.5, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- T1 Tournament ICM: chips are not money (pure stacks/payouts math, no tree) ----
  // These carry no board/hero/villain; state.stacks = chips per seat, state.payouts =
  // prize per finishing place (as a share of the pool), state.heroSeat = which seat is you.
  // The dummy villain satisfies the type; nothing here touches the tree.
  {
    id: "t1-icm-winner-take-all",
    module: "T1",
    title: "ICM: your share when it's winner-take-all",
    read: "Only first place is paid. What share of the prize pool is your equity?",
    ask: "icm",
    // Winner-take-all is the ONE case where chips = money: your $-share equals your chip fraction.
    // 6000 of 10000 chips = 60% of the chips = 60% of the (single) prize.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
      stacks: [6000, 3000, 1000], payouts: [1, 0, 0], heroSeat: 0,
    },
  },
  {
    id: "t1-icm-equal-stacks",
    module: "T1",
    title: "ICM: your share with equal stacks",
    read: "Three equal stacks; prizes are 50% / 30% / 20% of the pool. What's your share?",
    ask: "icm",
    // Equal stacks -> equal $: each of three players averages (50+30+20)/3 = 33.3% of the pool,
    // NOT the 50% first prize. Your equity is the average over every place you might finish.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
      stacks: [4000, 4000, 4000], payouts: [0.5, 0.3, 0.2], heroSeat: 0,
    },
  },
  {
    id: "t1-icm-chip-leader",
    module: "T1",
    title: "ICM: the chip leader's real share",
    read: "You have 70% of the chips; prizes are 50% / 30% / 20%. Is your equity 70% of the pool?",
    ask: "icm",
    // The core ICM lesson. 7000 of 10000 chips is 70% of the chips but only ~44% of the money: you
    // can't win more than first place, and the pay jumps compress a big stack's value. Chips are not money.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
      stacks: [7000, 2000, 1000], payouts: [0.5, 0.3, 0.2], heroSeat: 0,
    },
  },
  {
    id: "t1-icm-short-stack",
    module: "T1",
    title: "ICM: the short stack's real share",
    read: "Same table, but now you're the short stack with 10% of the chips. What's your share?",
    ask: "icm",
    // The mirror of the chip-leader drill (same table, heroSeat = the 1000 stack). 10% of the chips is worth
    // ~26% of the money: survival has value, so a short stack's chips are worth MORE per chip than a big stack's.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
      stacks: [7000, 2000, 1000], payouts: [0.5, 0.3, 0.2], heroSeat: 2,
    },
  },
  {
    id: "t1-icm-bubble",
    module: "T1",
    title: "ICM: the short stack on the bubble",
    read: "Four players left, three get paid (50% / 30% / 20%). You're the short stack. What's your share?",
    ask: "icm",
    // On the bubble the short stack still has real equity (~14.5% with 10% of the chips) because reaching the
    // money at all is worth something. Every pay jump matters, which is why survival tightens up short stacks.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 4 },
      stacks: [5000, 2500, 1500, 1000], payouts: [0.5, 0.3, 0.2], heroSeat: 3,
    },
  },
  // ---- T1 risk premium: how much equity you need to CALL an all-in under ICM ----
  {
    id: "t1-req-winner-take-all",
    module: "T1",
    title: "Risk premium: calling an all-in, winner-take-all",
    read: "Only first place is paid and you're heads-up. Villain shoves; you can call for your whole stack. What equity do you need to call?",
    ask: "callequity",
    // Baseline: with no pay ladder, chips = money, so you need exactly 50% (pot odds) — same as a cash game.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
      stacks: [5000, 5000], payouts: [1, 0], heroSeat: 0, villainSeat: 1,
    },
  },
  {
    id: "t1-req-in-the-money",
    module: "T1",
    title: "Risk premium: calling in the money with small pay jumps",
    read: "Three left, three paid (50% / 30% / 20%). The other big stack shoves; you can call for your stack. What equity do you need?",
    ask: "callequity",
    // Already in the money with modest jumps: ICM pressure is mild, so the threshold is only a hair over 50% (~0.523).
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 3 },
      stacks: [6000, 3000, 1000], payouts: [0.5, 0.3, 0.2], heroSeat: 0, villainSeat: 1,
    },
  },
  {
    id: "t1-req-bubble",
    module: "T1",
    title: "Risk premium: calling a coinflip on the bubble",
    read: "Four left, three paid (50% / 30% / 20%), everyone even-stacked. Villain shoves; calling risks your stack. What equity do you need?",
    ask: "callequity",
    // The core lesson. On the bubble, busting forfeits a guaranteed min-cash, so a coinflip isn't enough — you need
    // about 65% to call the SAME all-in that a cash game calls at 50%. Survival is worth a big risk premium.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 4 },
      stacks: [5000, 5000, 5000, 5000], payouts: [0.5, 0.3, 0.2], heroSeat: 0, villainSeat: 1,
    },
  },
  {
    id: "t1-req-bubble-extreme",
    module: "T1",
    title: "Risk premium: two big stacks with a short about to bust",
    read: "Four left, three paid; one player is down to a crumb and about to bust. Villain (an equal big stack) shoves. What equity do you need to call?",
    ask: "callequity",
    // The extreme case: with a short stack about to bust into the money, two big stacks must AVOID each other —
    // you need ~76% to call, because busting now (when you were almost guaranteed a cash) is catastrophic.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 4 },
      stacks: [4000, 4000, 4000, 100], payouts: [0.5, 0.3, 0.2], heroSeat: 0, villainSeat: 1,
    },
  },
  // ---- T2 Push/fold: short-stack shove/fold by chip-EV (pure arithmetic, no tree) ----
  // state.effStack = stack in bb, state.callFreq = how often the BB calls, state.eqWhenCalled =
  // hero's equity when called. The dummy villain/abstraction satisfy the type; nothing touches the tree.
  {
    id: "t2-shove-short-foldy",
    module: "T2",
    title: "Push/fold: a short stack against a tight big blind",
    read: "Folded to you in the small blind with 8 bb. The big blind only calls 15% of the time, and even when called you're about 30%. Shove or fold?",
    ask: "shove",
    // Fold equity carries it: 85% of the time you win the blind, and 8 bb is little to risk. shoveEV ≈ +0.37
    // vs folding's −0.5 — a clear shove. With a short stack and a foldy villain, you can shove almost anything.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
      effStack: 8, callFreq: 0.15, eqWhenCalled: 0.30,
    },
  },
  {
    id: "t2-fold-deeper",
    module: "T2",
    title: "Push/fold: the same spot with a deeper stack",
    read: "Same weak hand and the same tight big blind (calls 15%, you're ~30% when called) — but now you have 25 bb. Shove or fold?",
    ask: "shove",
    // The discrimination partner: only the STACK changed. Deeper means the times you're called and behind cost far
    // more, so the downside now outweighs the fold equity. shoveEV ≈ −0.65 < −0.5: fold. Shove shorter, not deeper.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
      effStack: 25, callFreq: 0.15, eqWhenCalled: 0.30,
    },
  },
  {
    id: "t2-fold-loose-caller",
    module: "T2",
    title: "Push/fold: a short stack against a calling station",
    read: "Folded to you in the small blind with 10 bb, but the big blind is a station who calls 45% of the time; you're ~35% when called. Shove or fold?",
    ask: "shove",
    // Less fold equity flips it: a loose caller means you rarely steal and often go to showdown behind. shoveEV ≈
    // −0.80 < −0.5: fold this hand. Against a station you shove TIGHTER — the fold equity that carries wide shoves is gone.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
      effStack: 10, callFreq: 0.45, eqWhenCalled: 0.35,
    },
  },
  {
    id: "t2-shove-premium",
    module: "T2",
    title: "Push/fold: a premium hand against a caller",
    read: "Folded to you in the small blind with 15 bb. The big blind calls 40% of the time, but you have a big hand — about 65% when called. Shove or fold?",
    ask: "shove",
    // With a real hand you WANT to get called: equity when called does the work, on top of the fold equity. shoveEV
    // ≈ +2.4, a huge shove. Wide shoves lean on fold equity; premium shoves lean on equity when called — both shove.
    state: {
      board: [], pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Kh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
      effStack: 15, callFreq: 0.40, eqWhenCalled: 0.65,
    },
  },
  // ---- M5.8 Range advantage: whose WHOLE range is ahead on this flop (same two ranges) ----
  {
    id: "m58-high-board-advantage",
    module: "M5.8",
    title: "Range advantage: a high, dry flop",
    read: "Your preflop raising range (big pairs, ace-broadway) against a caller's range (medium pairs, suited broadways). The flop is A♣ K♦ 5♥. What is YOUR range's equity?",
    ask: "rangeadv",
    // High, disconnected flop smashes the raiser: aces, kings and A-K all connect while the caller's medium range
    // mostly misses. ~92% -- a huge range advantage. This is a board you c-bet almost your entire range on.
    state: {
      heroRange: RA_RAISER, board: hand("Ac", "Kd", "5h"), pot: 1, toAct: "hero",
      villain: { range: RA_CALLER }, abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m58-coordinated-board-disadvantage",
    module: "M5.8",
    title: "Range advantage: a coordinated flop",
    read: "The SAME two ranges as the high-board spot, but the flop is J♣ T♦ 9♥. What is YOUR (the raiser's) range's equity now?",
    ask: "rangeadv",
    // The discrimination partner: same ranges, a coordinated middle flop. Now the CALLER is ahead -- sets, two
    // pair and made straights (Q-x, K-Q) hammer this board while the raiser's overpairs are vulnerable. ~31%: a
    // range DISADVANTAGE. On boards that hit the caller, check far more -- your big cards don't own this flop.
    state: {
      heroRange: RA_RAISER, board: hand("Jc", "Td", "9h"), pot: 1, toAct: "hero",
      villain: { range: RA_CALLER }, abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m58-paired-board-nut-advantage",
    module: "M5.8",
    title: "Range advantage: a paired ace-high flop",
    read: "The same ranges; the flop is A♣ A♦ 4♥. What is YOUR (the raiser's) range's equity?",
    ask: "rangeadv",
    // A paired, ace-high flop gives the raiser not just a range edge but a NUT advantage: you hold the aces and
    // big pairs, the caller has almost nothing that beats you. ~95%. Boards that lock up the nuts for one range are
    // where overbets and big polar bets come from -- the caller can never have the top of the range.
    state: {
      heroRange: RA_RAISER, board: hand("Ac", "Ad", "4h"), pot: 1, toAct: "hero",
      villain: { range: RA_CALLER }, abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m58-low-board-thin-advantage",
    module: "M5.8",
    title: "Range advantage: a low, connected flop",
    read: "The same ranges; the flop is 7♣ 6♦ 5♥. What is YOUR (the raiser's) range's equity?",
    ask: "rangeadv",
    // The middle ground: a low, connected flop. The raiser's overpairs are still ahead of the caller's range, but
    // only ~67% -- the caller's pairs and connectors have caught up a lot. Ahead but thin means a smaller c-bet or a
    // higher checking frequency, not the barrage you'd fire on A-K-5. Range advantage is a dial, not a switch.
    state: {
      heroRange: RA_RAISER, board: hand("7c", "6d", "5h"), pot: 1, toAct: "hero",
      villain: { range: RA_CALLER }, abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-polarized-range",
    module: "M5",
    title: "Equity vs a polarized range: a bluff-catcher vs nuts-or-air",
    ask: "estimate",
    state: {
      heroHand: hand("Ks", "Kd"), board: hand("Qh", "7d", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }, { combo: hand("Jh", "Th"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-set-vs-draws",
    module: "M5",
    title: "Equity vs a range: top set against a draw-heavy range",
    ask: "estimate",
    // Ahead of draws, but not as far ahead as it feels. Hero 7c7d = top set on the wet 7h 6h 2s; villain's
    // range is all flushes/straights in the making (Ah Th, 9h 8h, 5s 4s, Th 9h). A set is a big favorite (~68%)
    // yet every card that completes a draw beats it -- being "ahead" of draws is not the lock it looks like.
    state: {
      heroHand: hand("7c", "7d"), board: hand("7h", "6h", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Ah", "Th"), weight: 1 }, { combo: hand("9h", "8h"), weight: 1 },
        { combo: hand("5s", "4s"), weight: 1 }, { combo: hand("Th", "9h"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-dominated-flushdraw",
    module: "M5",
    title: "Equity vs a range: a dominated flush draw",
    ask: "estimate",
    // Not all flush draws are equal. Hero 8h9h is drawing to a flush on Kh 7h 2c, but villain's range is a
    // HIGHER flush draw (Ah Qh) plus a made top pair (Kc Qd). When a heart falls hero often makes the second-best
    // flush, and he is behind the made hand meanwhile -- so the draw is worth only ~30%, not the ~35% a clean draw is.
    state: {
      heroHand: hand("8h", "9h"), board: hand("Kh", "7h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Qh"), weight: 1 }, { combo: hand("Kc", "Qd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-flushdraw-vs-toppair",
    module: "M5",
    title: "Equity vs a range: a bare flush draw against top pair",
    ask: "estimate",
    // Draw-vs-made-hand, two cards to come. Hero Ah5h = nut flush draw (no pair) on Kh 7h 2c; villain's range
    // is top pair (Kc Qd / Ks Jc). Nine flush outs plus three aces run the draw to ~46% by the river -- a bare
    // draw against a made hand is close to a coin flip over two streets, not the underdog it looks on one card.
    state: {
      heroHand: hand("Ah", "5h"), board: hand("Kh", "7h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kc", "Qd"), weight: 1 }, { combo: hand("Ks", "Jc"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-overpair-vs-overcards",
    module: "M5",
    title: "Equity vs a range: an overpair against overcards",
    ask: "estimate",
    // An overpair is a big favorite over unpaired big cards. Hero TsTd on 9h 6c 2s vs {AK, QJ} -- the range has
    // two live cards apiece and some backdoors, so it isn't drawing dead, but the pair is ~75% ahead. Overcards
    // need to pair up (about a 1-in-4 shot each) to get there.
    state: {
      heroHand: hand("Ts", "Td"), board: hand("9h", "6c", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ks"), weight: 1 }, { combo: hand("Qh", "Jd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-two-pair-vs-draws",
    module: "M5",
    title: "Equity vs a range: top two pair on a wet board",
    ask: "estimate",
    // Top two pair is strong but a wet board keeps opponents live. Hero KcQd = top two on Kh Qh 5c vs a flush
    // draw (Ah Jh) and an underpair with a draw (Td Th) -- about 70%. Two pair is well ahead, but a heart or a
    // set gets there often enough that it's not a lock: bet to charge those draws.
    state: {
      heroHand: hand("Kc", "Qd"), board: hand("Kh", "Qh", "5c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Jh"), weight: 1 }, { combo: hand("Td", "Th"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-set-vs-overpair-range",
    module: "M5",
    title: "Equity vs a range: bottom set against overpairs",
    ask: "estimate",
    // A set is a monster against made pairs. Hero 7c7d = a set on 7h Kd 2s vs {AA, KQ} -- about 95%. Overpairs
    // and top pair are drawing to two outs (their own set) or runner-runner, so a set is nearly the nuts here.
    state: {
      heroHand: hand("7c", "7d"), board: hand("7h", "Kd", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }, { combo: hand("Kc", "Qh"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-nut-flush-vs-two-pair",
    module: "M5",
    title: "Equity vs a range: the nut flush against two pair",
    ask: "estimate",
    // Even the nuts isn't 100% while a card is to come. Hero Ah2h has made the nut flush on Kh 9h 4h Qc; villain's
    // two-pair hands (KQ, K9) can still pair the board and make a full house on the river, so the nut flush is
    // ~91%, not certain. A made hand can still lose when the board can pair.
    state: {
      heroHand: hand("Ah", "2h"), board: hand("Kh", "9h", "4h", "Qc"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kc", "Qd"), weight: 1 }, { combo: hand("Kd", "9d"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-combo-draw-vs-made",
    module: "M5",
    title: "Equity vs a range: a big combo draw against made hands",
    ask: "estimate",
    // A monster draw is a coin flip against strong made hands. Hero JhTh = a flush draw plus an open-ender on
    // Qh 9h 2c vs {two pair (Q9), an overpair (AA)} -- about 52%. With fifteen outs twice, even 'behind' is even.
    state: {
      heroHand: hand("Jh", "Th"), board: hand("Qh", "9h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qc", "9d"), weight: 1 }, { combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-tptk-vs-mixed-range",
    module: "M5",
    title: "Equity vs a range: top pair top kicker against a mixed range",
    ask: "estimate",
    // A strong made hand well ahead of a mix. Hero AsKd = top pair top kicker on Kh 8c 3d vs a worse pair (QQ)
    // and two draws (JT, 98 with backdoors) -- about 86%. Top pair top kicker beats the pairs and is ahead of
    // the draws, so it's a big favorite; bet to charge the draws and get value from the worse made hands.
    state: {
      heroHand: hand("As", "Kd"), board: hand("Kh", "8c", "3d"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Qc", "Qh"), weight: 1 }, { combo: hand("Jh", "Th"), weight: 1 }, { combo: hand("9h", "8h"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-ace-high-vs-wide-range",
    module: "M5",
    title: "Equity vs a range: ace-high against a wide range",
    ask: "estimate",
    // Ace-high is a bluff-catcher: it beats the misses and loses to the made hands. Hero AhQd on 8c 5h 2s vs a
    // wide range (draws Ts9s / 7h6h, a pair 44, an overcard hand KJ) is about 55% -- it wins against the two
    // draws and the KJ that misses, and loses only to the small pair. High card is worth more than it looks vs air.
    state: {
      heroHand: hand("Ah", "Qd"), board: hand("8c", "5h", "2s"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Ts", "9s"), weight: 1 }, { combo: hand("7h", "6h"), weight: 1 },
        { combo: hand("Kc", "Jd"), weight: 1 }, { combo: hand("4d", "4c"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-straight-vs-wet-range",
    module: "M5",
    title: "Equity vs a range: a made straight on a wet board",
    ask: "estimate",
    // A made hand that's very strong but not a lock. Hero 7h6h has a straight (5-6-7-8-9) on 9c 8d 5s Kh; villain's
    // range is a flush draw (Ah Jh) and two pair (K9). About 96% -- the flush draw can complete and two pair can
    // pair the board for a boat, so even a made straight isn't 100% while a card is to come. Bet to deny the draw.
    state: {
      heroHand: hand("7h", "6h"), board: hand("9c", "8d", "5s", "Kh"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Jh"), weight: 1 }, { combo: hand("Kc", "9d"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-middle-pair-vs-range",
    module: "M5",
    title: "Equity vs a range: a middle pair against a range",
    ask: "estimate",
    // A marginal made hand that's mostly behind. Hero 9c9d is a pair of nines on Ah Kd 4s vs two top pairs (AQ, KJ)
    // and a draw (76). About 36% -- it beats only the draw and is dominated by the pairs, so a small pair on a big
    // board is often a check-and-give-up, not a hand to build a pot with.
    state: {
      heroHand: hand("9c", "9d"), board: hand("Ah", "Kd", "4s"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Ac", "Qh"), weight: 1 }, { combo: hand("Kc", "Jh"), weight: 1 }, { combo: hand("7h", "6h"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-set-vs-big-draw",
    module: "M5",
    title: "Equity vs a range: a set on a super-wet board",
    ask: "estimate",
    // Even a set can be vulnerable. Hero 8c8d flopped bottom set on 8h 7h 6c, but the board is soaked: villain's
    // range is an overpair (AA) and a monster combo draw (Th9h = flush draw plus an open-ender). About 58% -- the
    // big draw is nearly a coin flip against the set. A set is usually the nuts, but not on the wettest boards.
    state: {
      heroHand: hand("8c", "8d"), board: hand("8h", "7h", "6c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }, { combo: hand("Th", "9h"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M2 coverage: convert outs -> equity across draw types and streets ----
  {
    id: "m2-flush-draw-flop",
    module: "M2",
    title: "Rule of 2 & 4: your equity with two cards to come",
    ask: "estimate",
    state: {
      // 9-out flush draw on the flop vs AA: 9 x 4 ≈ 36% (exact ≈ 0.366).
      heroHand: hand("8s", "3s"), board: hand("Ks", "Js", "2h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-flush-draw-turn",
    module: "M2",
    title: "Rule of 2 & 4: your equity with one card to come",
    ask: "estimate",
    state: {
      // Same 9-out flush draw, but on the TURN: 9 x 2 ≈ 18% (exact ≈ 0.205). Use x2, not x4.
      heroHand: hand("8s", "3s"), board: hand("Ks", "Js", "2h", "5d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ad", "Ac"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-gutshot-flop",
    module: "M2",
    title: "Rule of 2 & 4: count, then convert (two cards to come)",
    ask: "estimate",
    state: {
      // 4-out gutshot (a ten) on the flop vs AA: 4 x 4 ≈ 16% (exact ≈ 0.187). Small draws stay small.
      heroHand: hand("Kd", "Qc"), board: hand("Js", "9h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-overcards-flop",
    module: "M2",
    title: "Rule of 2 & 4: two big cards, two cards to come",
    ask: "estimate",
    state: {
      // Two overcards (6 outs) on the flop vs a small pair: 6 x 4 ≈ 24% (exact ≈ 0.256).
      heroHand: hand("As", "Kd"), board: hand("Qc", "7h", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("8s", "8h"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-combo-draw-turn",
    module: "M2",
    title: "Rule of 2 & 4: one card to come on a draw-heavy board",
    ask: "estimate",
    state: {
      // Big combo draw (flush + open-ender, ~15 outs) on the TURN: 15 x 2 ≈ 30% (exact ≈ 0.341) — not x4.
      heroHand: hand("Js", "Ts"), board: hand("9s", "8s", "2c", "4d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-oesd-flop",
    module: "M2",
    title: "Rule of 2 & 4: an open-ender on the flop",
    ask: "estimate",
    state: {
      // 8-out open-ender on the FLOP: 8 x 4 ≈ 32% (exact ≈ 0.342). Two cards to come, so use x4, not x2.
      heroHand: hand("Ts", "9s"), board: hand("8h", "7c", "2d"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-flushdraw-overcard-turn",
    module: "M2",
    title: "Rule of 2 & 4: a flush draw plus an overcard, one card to come",
    ask: "estimate",
    state: {
      // Flush draw (9) plus a live ace overcard (3) = 12 outs on the TURN: 12 x 2 ≈ 24% (exact ≈ 0.273). Count the
      // overcard outs too, but only x2 with one card to come. Hero Ah5h vs top pair Kc Qd on Kh 7h 2c Jd.
      heroHand: hand("Ah", "5h"), board: hand("Kh", "7h", "2c", "Jd"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kc", "Qd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-gutshot-turn",
    module: "M2",
    title: "Rule of 2 & 4: a gutshot, one card to come",
    ask: "estimate",
    // 4-out gutshot on the TURN: 4 x 2 ≈ 8% (exact ≈ 0.091). Small draws are worth very little on one card.
    state: {
      heroHand: hand("Kd", "Qc"), board: hand("Js", "9h", "2c", "5s"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-two-overcards-turn",
    module: "M2",
    title: "Rule of 2 & 4: two overcards, one card to come",
    ask: "estimate",
    // Two overcards = 6 outs on the TURN: 6 x 2 ≈ 12% (exact ≈ 0.136). Half of what they're worth on the flop.
    state: {
      heroHand: hand("Ah", "Kd"), board: hand("9c", "6s", "2d", "Jh"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qc", "Qd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-flushdraw-overcard-flop",
    module: "M2",
    title: "Rule of 2 & 4: a flush draw plus an overcard on the flop",
    ask: "estimate",
    // The flop twin of the turn version: flush draw (9) + a live ace (3) = 12 outs, x4 ≈ 48% (exact ≈ 0.481).
    // Two cards to come doubles the turn figure — count the overcard outs and use x4 on the flop.
    state: {
      heroHand: hand("Ah", "6h"), board: hand("7h", "5h", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Kc", "Kd"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m2-flushdraw-gutshot-flop",
    module: "M2",
    title: "Rule of 2 & 4: a flush draw with a gutshot on the flop",
    ask: "estimate",
    // Flush draw plus a straight gutshot -- a big combo draw. Hero Jh9h on Qh 8c 3h has a flush draw and a
    // gutshot (a ten makes Q-J-10-9-8). Roughly a dozen outs x4 lands near ~42% (exact ≈ 0.418) on the flop.
    state: {
      heroHand: hand("Jh", "9h"), board: hand("Qh", "8c", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M5 coverage: equity vs a range (weighting, condensed/polarized, domination) ----
  {
    id: "m5-overpair-vs-draws",
    module: "M5",
    title: "Equity vs range: your overpair against draws",
    ask: "estimate",
    state: {
      // QQ vs {flush draw, open-ender, a set}: ahead of the draws, crushed by the set -> ≈ 0.429, not a lock.
      heroHand: hand("Qs", "Qd"), board: hand("9h", "6h", "3s"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Kh", "Jh"), weight: 1 },
        { combo: hand("8c", "7c"), weight: 1 },
        { combo: hand("9c", "9d"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-underpair-vs-range",
    module: "M5",
    title: "Equity vs range: a small pair against a strong range",
    ask: "estimate",
    state: {
      // JJ on A-K-5 vs {AK, AA, KK, AQ}: behind every combo -> ≈ 0.056. Recognize a near-dead spot.
      heroHand: hand("Jh", "Jd"), board: hand("Ah", "Kc", "5d"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("As", "Kh"), weight: 1 },
        { combo: hand("Ac", "Ad"), weight: 1 },
        { combo: hand("Kd", "Ks"), weight: 1 },
        { combo: hand("Ad", "Qs"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-vs-condensed",
    module: "M5",
    title: "Equity vs range: a big hand against medium holdings",
    ask: "estimate",
    state: {
      // AA on K-8-3 vs a condensed range (top pairs + an underpair, no nuts/air): ahead of all -> ≈ 0.841.
      heroHand: hand("As", "Ad"), board: hand("Kc", "8d", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Kh", "Qs"), weight: 1 },
        { combo: hand("Kd", "Js"), weight: 1 },
        { combo: hand("Ks", "Th"), weight: 1 },
        { combo: hand("9c", "9h"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-weighted-range",
    module: "M5",
    title: "Equity vs range: mostly bluffs, a little value",
    ask: "estimate",
    state: {
      // KK bluff-catcher vs a range that's 3 parts air to 1 part value: weighting lifts equity to ≈ 0.705
      // (the same combos weighted evenly would be ≈ 0.498). Weight the range, don't just average combos.
      heroHand: hand("Ks", "Kd"), board: hand("Qh", "7d", "2c"),
      pot: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Jh", "Th"), weight: 3 }, { combo: hand("Ah", "Ad"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m5-dominated-kicker",
    module: "M5",
    title: "Equity vs range: top pair with a weak kicker",
    ask: "estimate",
    state: {
      // A-J (top pair, weak kicker) on A-8-3 vs {AK, AK, KK}: out-kicked by the AKs, ahead of KK -> ≈ 0.389.
      heroHand: hand("Ah", "Jc"), board: hand("As", "8d", "3h"),
      pot: 1, toAct: "hero",
      villain: { range: [
        { combo: hand("Ad", "Kc"), weight: 1 },
        { combo: hand("Ac", "Kd"), weight: 1 },
        { combo: hand("Ks", "Kh"), weight: 1 },
      ] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  // ---- M3.5 coverage: fold equity only helps when villain actually folds ----
  {
    id: "m35-no-fold-equity",
    module: "M3.5",
    title: "Fold equity: the same flush draw, a sticky villain",
    ask: "action",
    read: "Villain never folds — calls any bet.",
    state: {
      // Same draw as the flop semi-bluff, but villain never folds: with no fold equity, betting as the
      // underdog is worse than checking and realizing equity for free. Betting is the leak.
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Td"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "m35-oesd-semibluff",
    module: "M3.5",
    title: "Fold equity: an open-ended draw on the flop",
    ask: "action",
    read: "Villain folds about half the time.",
    state: {
      // Open-ender (8 outs) + fold equity: betting wins now when villain folds and later when the draw hits.
      heroHand: hand("Ts", "9s"), board: hand("Qh", "Jd", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Ad"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.5 : 0.5 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "m35-weak-draw-check",
    module: "M3.5",
    title: "Fold equity: a gutshot on the flop",
    ask: "action",
    read: "Villain rarely folds.",
    state: {
      // A 4-out gutshot with little fold equity: not enough folds + a weak draw means checking beats betting.
      heroHand: hand("Kd", "Qc"), board: hand("Js", "9h", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Ah", "Ad"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.2 : 0.8 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2 },
    },
  },
  // ---- M4 coverage: bet strong hands across streets for value ----
  {
    id: "m4-value-set",
    module: "M4",
    title: "Street sequencing: a flopped top set",
    ask: "action",
    read: "Villain calls any bet (calling station).",
    state: {
      // Top set vs a station: bet flop and turn to build the pot — checking leaves money behind.
      heroHand: hand("8s", "8d"), board: hand("8h", "Kc", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
    },
  },
  {
    id: "m4-overpair-protection",
    module: "M4",
    title: "Street sequencing: an overpair on a wet board",
    ask: "action",
    read: "Villain calls any bet with a draw.",
    state: {
      // Overpair on a draw-heavy board: bet across streets for value and to charge the draw, not check.
      heroHand: hand("As", "Ad"), board: hand("9h", "8h", "2c"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Qh"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
    },
  },
  {
    id: "m4-way-behind-check",
    module: "M4",
    title: "Street sequencing: a middling pair on a high board",
    ask: "action",
    read: "Villain has hit this board hard and calls any bet.",
    state: {
      // 9-9 on K-Q-2 vs villain's two pair, who never folds: betting only loses more (bet EV -0.71
      // vs check +0.10). The sequencing skill includes choosing NO streets — check back, cheap showdown.
      heroHand: hand("9h", "9d"), board: hand("Kc", "Qs", "2d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop"], players: 2 },
    },
  },
  {
    id: "m4-three-street-value",
    module: "M4",
    title: "Street sequencing: top set across all three streets",
    ask: "action",
    read: "Villain calls any bet (calling station).",
    state: {
      // Three streets, not two. Hero AsAd = top set on Ah Kc 7d; a station calls flop, turn AND river, so bet all
      // three to build the biggest pot -- checking any street leaves money behind. The line is the plan for the whole hand.
      heroHand: hand("As", "Ad"), board: hand("Ah", "Kc", "7d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Kh", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn", "river"], players: 2 },
    },
  },
  {
    id: "m4-thin-value-toppair",
    module: "M4",
    title: "Street sequencing: top pair top kicker for thin value",
    ask: "action",
    read: "Villain calls any bet with a worse pair (calling station).",
    state: {
      // Thinner value than a set/overpair, same lesson. Hero AsKs = top pair top kicker on Kc 8h 3d; a station
      // pays off with worse (Qh Qd, an underpair) on flop and turn, so bet both -- top pair is plenty to value bet
      // when a worse hand will call. Don't check strong-enough hands just because they aren't monsters.
      heroHand: hand("As", "Ks"), board: hand("Kc", "8h", "3d"),
      pot: 1, toAct: "hero",
      villain: {
        range: [{ combo: hand("Qh", "Qd"), weight: 1 }],
        strategy: (_s: NodeState, legal: Action[]) =>
          legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })),
      },
      abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
    },
  },
  // ---- M5.6 coverage: implied odds aren't always there ----
  {
    id: "m56-no-implied-odds",
    module: "M5.6",
    title: "Implied odds: a flush draw with nothing behind",
    ask: "action",
    read: "Stacks are shallow — there's little left to win later.",
    state: {
      // ~37% flush draw at 1-to-call into 1: immediate odds need 50%, and there are no future bets to win,
      // so implied odds can't rescue it. Calling is the leak (chases without odds).
      heroHand: hand("8s", "9s"), board: hand("As", "Ks", "4d"),
      pot: 1, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Ah", "Td"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
  {
    id: "m56-reverse-implied",
    module: "M5.6",
    title: "Implied odds: a draw that may be second-best",
    ask: "action",
    read: "Villain likely holds a bigger draw.",
    state: {
      // A low flush draw drawing nearly dead vs a higher flush draw (~11%): the cards that 'hit' often lose,
      // so even a 3-to-1 price is a fold. Reverse implied odds — discount the tainted outs.
      heroHand: hand("Jh", "2h"), board: hand("Ah", "Kh", "5c"),
      pot: 3, toCall: 1, toAct: "hero",
      villain: { range: [{ combo: hand("Qh", "Th"), weight: 1 }] },
      abstraction: { sizes: [], streets: [], players: 2 },
    },
  },
];
