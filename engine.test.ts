// Test suite — every assertion is exact or hand-checkable. Run: node engine.test.ts
import {
  score5, score7, score7slow, cmpScore, equity, equityVsRange, outs,
  breakEven, callEV, decisionRegret, regret, estimateError, withinBand, brier, calibration, leakReport,
  hand, parseCard, card, rankOf, suitOf, FULL_DECK, madeHand, drawSuit, nutCategory, comboCount,
  minDefenseFreq, bluffFrequency,
  equityLeaf, bestResponseEV, bestAction, truth, buildTree, realizationFactor,
  fieldEquity, validateAbstraction, ABSTRACTION_LIMITS,
  actionEVs, grade,
  resultQuality, newReview, scheduleReview, dueReviews, nextReview,
  STARTER_DRILLS, newSession, nextDrill, gradeDrill, classifyLeak,
  serializeSession, loadSession,
} from "./engine.ts";
import { MODULES, PRIMER, EXPLAIN, moduleDone, moduleStatus, currentStreak } from "./curriculum.ts";
import type { State, NodeState, Action, TreeNode, Abstraction, Response, Result, Review, Drill, Score, RangePolicy } from "./contract.ts";

let pass = 0, fail = 0;
const approx = (a: number | null, b: number, eps = 1e-9): boolean => a !== null && Math.abs(a - b) < eps;
function ok(name: string, cond: boolean, detail: string | number = ""): void {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL: ${name} ${detail}`); }
}

// ---------- L1 evaluator: category ordering ----------
const royal = hand("As", "Ks", "Qs", "Js", "Ts");
const strFlush = hand("9s", "8s", "7s", "6s", "5s");
const quads = hand("9s", "9h", "9d", "9c", "Ks");
const boat = hand("9s", "9h", "9d", "Ks", "Kh");
const flush = hand("As", "Js", "8s", "5s", "2s");
const straight = hand("9s", "8h", "7d", "6c", "5s");
const trips = hand("9s", "9h", "9d", "Ks", "Qh");
const twoPair = hand("9s", "9h", "Ks", "Kh", "2d");
const pair = hand("9s", "9h", "Ks", "Qh", "2d");
const high = hand("As", "Jh", "8d", "5c", "2s");

const ladder = [high, pair, twoPair, trips, straight, flush, boat, quads, strFlush, royal];
for (let i = 0; i + 1 < ladder.length; i++) {
  ok(`ordering step ${i}`, cmpScore(score5(ladder[i]), score5(ladder[i + 1])) < 0,
    `cat ${score5(ladder[i])[0]} !< ${score5(ladder[i + 1])[0]}`);
}
ok("royal is category 8", score5(royal)[0] === 8);
ok("quads is category 7", score5(quads)[0] === 7);

// wheel straight: A-2-3-4-5, high card = 5
const wheel = hand("As", "2h", "3d", "4c", "5s");
ok("wheel is straight", score5(wheel)[0] === 4);
ok("wheel high card is 5", score5(wheel)[1] === 5);
// wheel loses to 6-high straight
ok("wheel < 6-high straight", cmpScore(score5(wheel), score5(hand("6s", "5h", "4d", "3c", "2s"))) < 0);

// kicker tiebreak: pair of 9s, A kicker beats pair of 9s, K kicker
ok("kicker tiebreak",
  cmpScore(score5(hand("9s", "9h", "As", "5d", "2c")), score5(hand("9d", "9c", "Ks", "5h", "2d"))) > 0);

// 7-card: picks best 5 (flush out of 7)
ok("score7 finds flush",
  score7(hand("As", "Js", "8s", "5s", "2s", "9h", "9d"))[0] === 5);

// ---------- L2 equity: EXACT combinatorial checks ----------
// Hero KsQd has an open-ended straight draw (K-Q-J-T needs A or 9), no flush
// possible (only 2 spades max). Villain AA is an overpair. One card to come.
// Hero wins ONLY on: 2 remaining aces (Broadway) + 4 nines = 6 cards. 44 unseen.
// No flushes possible for either side, no chops. => equity = 6/44 exactly.
{
  const hero = hand("Ks", "Qd");
  const board = hand("Jh", "Th", "2c", "3s");
  const villain = hand("Ah", "Ad");
  const e = equity(hero, board, villain);
  ok("straight draw 1-to-come == 6/44 exact", approx(e, 6 / 44),
    `got ${e}, want ${6 / 44}`);
}

// Deterministic showdown (river already out, 0 to come): hero nut flush vs trips -> 1.0
{
  const hero = hand("Ks", "Qs");
  const board = hand("As", "Js", "Ts", "2h", "2d"); // hero has royal-ish: A-K-Q-J-T spades = royal flush
  const villain = hand("Ah", "Ad");                 // full house aces over twos
  ok("nut flush/straight flush beats boat (eq=1)", equity(hero, board, villain) === 1);
}

// Identical hands play the board -> tie -> equity 0.5
{
  const board = hand("As", "Ks", "Qd", "Jc", "2h");
  ok("chopped pot == 0.5", equity(hand("3h", "4d"), board, hand("3c", "4s")) === 0.5);
}

// Drawing dead (0 to come): hero is beaten outright -> equity 0.
{
  // Board is aces-full (AAA KK). Villain holds the 4th ace -> quad aces.
  // Hero plays the board (aces full) and loses to quads. Single enumeration.
  const hero = hand("7h", "2d");
  const board = hand("As", "Ah", "Ad", "Kc", "Kd");
  const villain = hand("Ac", "5s");
  const e = equity(hero, board, villain);
  ok("drawing dead == 0", e === 0, `got ${e}`);
}

// ---------- outs ----------
{
  // hero open-ended? use simple flush-draw outs vs a fixed made hand = 9
  const hero = hand("2s", "5s");
  const board = hand("As", "9s", "7h"); // 3-card board, one to come (turn)
  const villain = hand("Ah", "Kc");     // top pair
  ok("flush draw has 9 outs", outs(hero, board, villain) === 9,
    `got ${outs(hero, board, villain)}`);
}

// ---------- madeHand + drawSuit (UI: highlight the made hand / flush draw) ----------
{
  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  // madeHand returns exactly 5 cards that score identically to best(7).
  const twoPair = [...hand("Ac", "Kd"), ...hand("Ah", "Kh", "7c", "3d", "2s")];
  ok("madeHand: 5 cards scoring identically to score7 (two pair)",
    madeHand(twoPair).length === 5 && cmpScore(score5(madeHand(twoPair)), score7(twoPair)) === 0);
  // broadway: picks A-K-Q-J-T (the ten plays; the 9 and the off 5 do not).
  const broadway = [...hand("Tc", "5d"), ...hand("As", "Kd", "Qc", "Jh", "9s")];
  const bw = new Set(madeHand(broadway));
  ok("madeHand: broadway uses the ten, not the 9 or the 5",
    bw.size === 5 && bw.has(hand("Tc", "5d")[0]) && !bw.has(hand("9s")[0]) && !bw.has(hand("5d")[0]));
  ok("madeHand throws on fewer than 5 cards", throws(() => madeHand(hand("As", "Ks"))));

  // drawSuit: exactly 4 of a suit is a draw; 5 is a made flush; rainbow is none.
  ok("drawSuit: a 4-card flush draw returns its suit",
    drawSuit(hand("Ah", "4h"), hand("Kh", "7h", "2c")) === suitOf(hand("Ah")[0]));
  ok("drawSuit: a made flush (5) is not a draw", drawSuit(hand("Ah", "4h"), hand("Kh", "7h", "2h")) === null);
  ok("drawSuit: a rainbow board has no flush draw", drawSuit(hand("Ah", "4d"), hand("Kh", "7c", "2s")) === null);
}

// ---------- nutCategory (M0 "name the nuts") ----------
{
  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  // 5 = flush, 4 = straight, 7 = quads, 3 = trips (see CATEGORY ladder).
  ok("nutCategory: three of a suit -> flush (5)", nutCategory(hand("As", "9s", "4s", "Kd", "2c")) === 5);
  ok("nutCategory: a connected board -> straight (4)", nutCategory(hand("Js", "Td", "9c", "4h", "2s")) === 4);
  ok("nutCategory: a paired board -> quads (7)", nutCategory(hand("Ks", "Kd", "8c", "5h", "2s")) === 7);
  ok("nutCategory: a dry disconnected board -> a set (3)", nutCategory(hand("Ks", "8d", "3c", "Qh", "2s")) === 3);
  ok("nutCategory: works on a flop too", nutCategory(hand("As", "Ks", "Qs")) >= 5); // 3 spades broadway -> flush or better
  ok("nutCategory throws on fewer than 3 cards", throws(() => nutCategory(hand("As", "Ks"))));
}

// ---------- L4 grading ----------
ok("break-even 1/2 pot", approx(breakEven(2, 1), 1 / 3)); // call 1 into pot 2 -> 1/3
ok("callEV positive when priced in", callEV(0.5, 2, 1) === 0.5 * 2 - 0.5 * 1);
ok("decisionRegret 0 when calling a +EV spot",
  decisionRegret(0.5, 2, 1, "call") === 0);
ok("decisionRegret > 0 when folding a +EV spot",
  decisionRegret(0.5, 2, 1, "fold") > 0);
ok("regret picks best action",
  regret({ call: 1.2, bet: 2.0, fold: 0 }, "call") === 0.8);
ok("estimateError", approx(estimateError(0.4, 0.35), 0.05));
ok("withinBand pass", withinBand(0.36, 0.35, 0.05) === true);
ok("withinBand fail", withinBand(0.50, 0.35, 0.05) === false);
ok("brier zero for perfect", brier([{ estimate: 0.3, truth: 0.3 }]) === 0);

// ---------- L3 Piece 1: TERM leaf + CHANCE averaging ----------
// The "one engine" identity: a CHANCE node fanning out per-card showdowns
// equals the L2 leaf's integrated equity, by law of total expectation.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const villC = hand("Ah", "Ad");
  const villain = { range: [{ combo: villC, weight: 1 }] };
  const known = new Set<number>([...heroH, ...board4, ...villC]);
  const unseen = FULL_DECK.filter((c) => !known.has(c)); // 44 cards
  const children = unseen.map((c) => ({
    node: {
      kind: "TERM",
      terminal: { type: "showdown", heroInvested: 0 },
      state: { heroHand: heroH, board: [...board4, c], pot: 1, villain },
    } satisfies TreeNode,
  }));
  const chance = { kind: "CHANCE", state: { heroHand: heroH, board: board4, pot: 1, villain }, children } satisfies TreeNode;
  ok("CHANCE has 44 children", children.length === 44, `got ${children.length}`);
  ok("CHANCE of showdowns == 6/44 exact", approx(bestResponseEV(chance), 6 / 44),
    `got ${bestResponseEV(chance)}`);
  ok("CHANCE == L2 equity (one-engine identity)",
    bestResponseEV(chance) === equity(heroH, board4, villC),
    `${bestResponseEV(chance)} != ${equity(heroH, board4, villC)}`);
}

// TERM showdown leaf mirrors the L2 equity cases, through the tree path.
{
  // made hand (royal vs boat) -> equityLeaf 1, EV = 1*pot = 1
  const node = {
    kind: "TERM", terminal: { type: "showdown", heroInvested: 0 },
    state: { heroHand: hand("Ks", "Qs"), board: hand("As", "Js", "Ts", "2h", "2d"),
             pot: 1, villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] } },
  } satisfies TreeNode;
  ok("TERM showdown made hand == 1", bestResponseEV(node) === 1, `got ${bestResponseEV(node)}`);
}
{
  // drawing dead -> equityLeaf 0, EV = 0
  const node = {
    kind: "TERM", terminal: { type: "showdown", heroInvested: 0 },
    state: { heroHand: hand("7h", "2d"), board: hand("As", "Ah", "Ad", "Kc", "Kd"),
             pot: 5, villain: { range: [{ combo: hand("Ac", "5s"), weight: 1 }] } },
  } satisfies TreeNode;
  ok("TERM showdown drawing dead == 0", bestResponseEV(node) === 0, `got ${bestResponseEV(node)}`);
}
{
  // chop -> equityLeaf 0.5, EV = 0.5*pot
  const node = {
    kind: "TERM", terminal: { type: "showdown", heroInvested: 0 },
    state: { heroHand: hand("3h", "4d"), board: hand("As", "Ks", "Qd", "Jc", "2h"),
             pot: 2, villain: { range: [{ combo: hand("3c", "4s"), weight: 1 }] } },
  } satisfies TreeNode;
  ok("TERM showdown chop == 0.5*pot == 1", bestResponseEV(node) === 1, `got ${bestResponseEV(node)}`);
}

// TERM fold leaves (net-chips convention).
{
  const state = { board: [], pot: 3, villain: { range: [] } };
  const villFolds = { kind: "TERM", terminal: { type: "fold", folder: "villain", heroInvested: 2 }, state } satisfies TreeNode;
  const heroFolds = { kind: "TERM", terminal: { type: "fold", folder: "hero", heroInvested: 2 }, state } satisfies TreeNode;
  ok("TERM villain folds -> pot - invested", bestResponseEV(villFolds) === 1, `got ${bestResponseEV(villFolds)}`);
  ok("TERM hero folds -> -invested", bestResponseEV(heroFolds) === -2, `got ${bestResponseEV(heroFolds)}`);
}

// ---------- L3 Piece 2: HERO max + VILL weighted sum ----------
// HERO maximizes. Hero KsQd vs AA on a 4-card board (equityLeaf = 6/44).
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] };
  const fold = { kind: "TERM", terminal: { type: "fold", folder: "hero", heroInvested: 0 },
                 state: { board: board4, pot: 1, villain } } satisfies TreeNode;

  // Mispriced call: showdown EV = 6/44*1 - 1 = -38/44 < 0 -> hero folds, EV 0.
  {
    const call = { kind: "TERM", terminal: { type: "showdown", heroInvested: 1 },
                   state: { heroHand: heroH, board: board4, pot: 1, villain } } satisfies TreeNode;
    const hero = { kind: "HERO", state: { heroHand: heroH, board: board4, pot: 1, villain },
                   children: [{ action: { kind: "fold" }, node: fold },
                              { action: { kind: "call" }, node: call }] } satisfies TreeNode;
    ok("HERO folds mispriced call -> EV 0", bestResponseEV(hero) === 0, `got ${bestResponseEV(hero)}`);
  }
  // Priced-in call: showdown EV = 6/44*10 - 1 = 16/44 > 0 -> hero calls.
  {
    const call = { kind: "TERM", terminal: { type: "showdown", heroInvested: 1 },
                   state: { heroHand: heroH, board: board4, pot: 10, villain } } satisfies TreeNode;
    const hero = { kind: "HERO", state: { heroHand: heroH, board: board4, pot: 10, villain },
                   children: [{ action: { kind: "fold" }, node: fold },
                              { action: { kind: "call" }, node: call }] } satisfies TreeNode;
    ok("HERO takes priced-in call -> EV 16/44", approx(bestResponseEV(hero), 16 / 44),
      `got ${bestResponseEV(hero)}`);
  }
}

// VILL weighted sum: villain folds 0.5 / calls 0.5.
//   fold child  -> villain folds, EV = pot - 0 = 1
//   call child  -> showdown 6/44 * 1 - 0 = 6/44
//   EV = 0.5*1 + 0.5*6/44 = 25/44
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const strat = (_state: NodeState, legal: Action[]) =>
    legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 0.5 : 0.5 }));
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy: strat };
  const state = { heroHand: heroH, board: board4, pot: 1, villain };
  const vill = {
    kind: "VILL", state,
    children: [
      { action: { kind: "fold" },
        node: { kind: "TERM", terminal: { type: "fold", folder: "villain", heroInvested: 0 }, state } },
      { action: { kind: "call" },
        node: { kind: "TERM", terminal: { type: "showdown", heroInvested: 0 }, state } },
    ],
  } satisfies TreeNode;
  ok("VILL weighted sum == 25/44", approx(bestResponseEV(vill), 25 / 44), `got ${bestResponseEV(vill)}`);
}

// ---------- L3 Piece 3: bestAction (argmax at a HERO node) ----------
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] };
  const fold = { kind: "TERM", terminal: { type: "fold", folder: "hero", heroInvested: 0 },
                 state: { board: board4, pot: 1, villain } } satisfies TreeNode;

  // Mispriced -> fold is best.
  {
    const call = { kind: "TERM", terminal: { type: "showdown", heroInvested: 1 },
                   state: { heroHand: heroH, board: board4, pot: 1, villain } } satisfies TreeNode;
    const hero = { kind: "HERO", state: { heroHand: heroH, board: board4, pot: 1, villain },
                   children: [{ action: { kind: "fold" }, node: fold },
                              { action: { kind: "call" }, node: call }] } satisfies TreeNode;
    ok("bestAction = fold when mispriced", bestAction(hero).kind === "fold", JSON.stringify(bestAction(hero)));
  }
  // Priced-in -> call is best.
  {
    const call = { kind: "TERM", terminal: { type: "showdown", heroInvested: 1 },
                   state: { heroHand: heroH, board: board4, pot: 10, villain } } satisfies TreeNode;
    const hero = { kind: "HERO", state: { heroHand: heroH, board: board4, pot: 10, villain },
                   children: [{ action: { kind: "fold" }, node: fold },
                              { action: { kind: "call" }, node: call }] } satisfies TreeNode;
    ok("bestAction = call when priced in", bestAction(hero).kind === "call", JSON.stringify(bestAction(hero)));
  }
}

// ---------- L3 Piece 4: truth() router + minimal builder ----------
// Pillar 1 (empty abstraction): truth IS the L2 equity leaf, no tree touched.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] };
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero", villain,
                  abstraction: { sizes: [], streets: [], players: 2 } };
  ok("truth pillar-1 == 6/44 (equity leaf)", approx(truth(state), 6 / 44), `got ${truth(state)}`);
  ok("truth pillar-1 == L2 equity", truth(state) === equity(heroH, board4, hand("Ah", "Ad")));
}

// Pillar 2: minimal tree. Hero KsQd vs AA, pot 1, one pot-size bet available.
//   check       -> showdown 6/44
//   bet 1.0     -> VILL: fold(0.5)->EV 1, call(0.5)->6/44*3-1 = -26/44
//                  => VILL EV = 0.5*1 + 0.5*(-26/44) = 9/44
//   HERO max(6/44, 9/44) = 9/44, best action = bet.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const splitStrat = (_state: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: 0.5 }));
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy: splitStrat };
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero", villain,
                  abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
  ok("truth pillar-2 == 9/44 (bet beats check)", approx(truth(state), 9 / 44), `got ${truth(state)}`);
  ok("truth == bestResponseEV(buildTree(state))",
    truth(state) === bestResponseEV(buildTree(state)));
  ok("bestAction on built tree = bet", bestAction(buildTree(state)).kind === "bet",
    JSON.stringify(bestAction(buildTree(state))));
}

// Pillar 2: villain never folds -> hero's bet has no fold equity, hero checks.
//   bet 1.0 -> VILL EV = 0*1 + 1*(-26/44) = -26/44 ; check = 6/44 -> max = 6/44.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const callStrat = (_state: NodeState, legal: Action[]) =>
    legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 }));
  const villain = { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy: callStrat };
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero", villain,
                  abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
  ok("truth pillar-2 == 6/44 (no fold equity -> check)", approx(truth(state), 6 / 44), `got ${truth(state)}`);
  ok("bestAction = check vs a never-folding villain", bestAction(buildTree(state)).kind === "check",
    JSON.stringify(bestAction(buildTree(state))));
}

// ---------- L3: realizationFactor (derived, not hardcoded) ----------
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const villC = hand("Ah", "Ad");

  // Pillar 1 / depth-0 realizes exactly its equity -> factor 1.
  {
    const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
                    villain: { range: [{ combo: villC, weight: 1 }] },
                    abstraction: { sizes: [], streets: [], players: 2 } };
    ok("realizationFactor pillar-1 == 1", realizationFactor(state) === 1, `got ${realizationFactor(state)}`);
  }

  // Fold equity lifts realization above 1: treeEV 9/44 over allInEV 6/44 = 1.5.
  {
    const splitStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: 0.5 }));
    const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
                    villain: { range: [{ combo: villC, weight: 1 }], strategy: splitStrat },
                    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
    ok("realizationFactor with fold equity == 1.5", approx(realizationFactor(state), 1.5),
      `got ${realizationFactor(state)}`);
  }

  // No fold equity (villain never folds) -> hero checks, realizes exactly equity = 1.
  {
    const callStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 }));
    const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
                    villain: { range: [{ combo: villC, weight: 1 }], strategy: callStrat },
                    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
    ok("realizationFactor no fold equity == 1", realizationFactor(state) === 1, `got ${realizationFactor(state)}`);
  }
}

// ---------- L3: multi-street builder ----------
const callStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 }));
const foldStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: a.kind === "fold" ? 1 : 0 }));

// Cross-street identity: with betting dominated, a 2-street tree (flop->turn,
// chance between, leaf integrates the river) integrates to exactly the L2 equity.
// Hero is drawing dead (villain has quad aces on the flop) -> every runout 0, so
// hero never profits from betting and bestResponseEV == equity == 0.
{
  const hero = hand("7h", "2d");
  const flop = hand("As", "Ah", "Ad");
  const villC = hand("Ac", "Kc"); // 4th ace -> quad aces, unbeatable
  const tree = buildTree({
    heroHand: hero, board: flop, pot: 1, toAct: "hero",
    villain: { range: [{ combo: villC, weight: 1 }], strategy: callStrat },
    abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
  });
  const ev = bestResponseEV(tree);
  ok("multi-street drawing dead == 0", ev === 0, `got ${ev}`);
  ok("multi-street == L2 equity (cross-street identity)", ev === equity(hero, flop, villC));
}

// The same identity at MID equity (0 < e < 1), where the CHANCE mean must actually
// average DISTINCT per-runout leaves — the drawing-dead(0)/nuts(1) cases above are
// trivially exact because every leaf is identical. Hero (AK) checks a 2-street tree
// through to showdown vs a set; the check line integrates to exactly the L2 equity
// (to float precision — the two summation orders differ by ~1e-17, so approx).
{
  const hero = hand("As", "Ks");
  const flop = hand("Qh", "7h", "2d");
  const villC = hand("7c", "7d"); // set of sevens
  const tree = buildTree({
    heroHand: hero, board: flop, pot: 1, toAct: "hero",
    villain: { range: [{ combo: villC, weight: 1 }], strategy: callStrat },
    abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
  });
  const eq = equity(hero, flop, villC);
  const checkEV = actionEVs(tree).find((e) => e.action.kind === "check")!.ev;
  ok("mid-equity spot is non-trivial (0 < e < 1)", eq > 0 && eq < 1, `eq ${eq}`);
  ok("mid-equity check-line == L2 equity (cross-street identity)", approx(checkEV, eq, 1e-12), `${checkEV} vs ${eq}`);
}

// 3-STREET proof + value-betting the nuts vs a never-folding villain.
// Hero flops a royal flush (eq=1 on every runout); pot-size bets get called each
// street. pots: 1 ->(bet1,call) 3 ->(bet3,call) 9 ->(bet9,call) 27; hero invests
// 1+3+9=13; EV = 1*27 - 13 = 14. Hero captures every street's call as profit.
{
  const hero = hand("Js", "Ts");
  const flop = hand("As", "Ks", "Qs"); // hero already holds a royal flush
  const villC = hand("2h", "2d");
  const tree = buildTree({
    heroHand: hero, board: flop, pot: 1, toAct: "hero",
    villain: { range: [{ combo: villC, weight: 1 }], strategy: callStrat },
    abstraction: { sizes: [1.0], streets: ["flop", "turn", "river"], players: 2 },
  });
  const ev = bestResponseEV(tree), ba = bestAction(tree);
  ok("3-street nuts value bet == 14", ev === 14, `got ${ev}`);
  ok("3-street nuts best action = bet", ba.kind === "bet", JSON.stringify(ba));
}

// Pure fold equity across streets: villain always folds, so hero bets and scoops
// the current pot (=1) regardless of cards/equity. EV == pot.
{
  const hero = hand("7h", "2d");
  const flop = hand("As", "Ks", "Qd");
  const villC = hand("9c", "9d");
  const tree = buildTree({
    heroHand: hero, board: flop, pot: 1, toAct: "hero",
    villain: { range: [{ combo: villC, weight: 1 }], strategy: foldStrat },
    abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
  });
  const ev = bestResponseEV(tree);
  ok("multi-street pure fold equity == pot (1)", ev === 1, `got ${ev}`);
}

// ---------- L3: multiway (aggregated-field APPROXIMATION) ----------
{
  const hero = hand("3h", "4d");
  const board = hand("As", "Ks", "Qd", "Jc", "2h");
  const villC = hand("3c", "4s"); // chops with hero -> base equity 0.5

  // players<=2 reduces to exact 2-player equity. (pot is unused by the leaf.)
  ok("fieldEquity players=2 == equityLeaf (exact)",
    fieldEquity({ heroHand: hero, board, pot: 0, players: 2, villain: { range: [{ combo: villC, weight: 1 }] } }) ===
      equityLeaf({ heroHand: hero, board, pot: 0, villain: { range: [{ combo: villC, weight: 1 }] } }));

  // players=3: independence approx -> 0.5^2 = 0.25.
  const eq3 = fieldEquity({ heroHand: hero, board, pot: 0, players: 3, villain: { range: [{ combo: villC, weight: 1 }] } });
  ok("fieldEquity players=3 == 0.5^2 = 0.25 (field approx)", approx(eq3, 0.25), `got ${eq3}`);

  // multiway showdown terminal: EV = fieldEquity * pot = 0.25 * 4 = 1.
  const node = {
    kind: "TERM", terminal: { type: "showdown", heroInvested: 0 },
    state: { heroHand: hero, board, pot: 4, players: 3, villain: { range: [{ combo: villC, weight: 1 }] } },
  } satisfies TreeNode;
  ok("multiway TERM showdown == 0.25*4 == 1", approx(bestResponseEV(node), 1), `got ${bestResponseEV(node)}`);
}

// ---------- L3: authoring-time abstraction budget ----------
{
  // Valid abstractions pass (return true).
  ok("validateAbstraction passes single street",
    validateAbstraction({ sizes: [1.0], streets: ["turn"], players: 2 }, hand("Jh", "Th", "2c", "3s")) === true);
  ok("validateAbstraction passes 2 sizes x 3 streets (=6 <= cap)",
    validateAbstraction({ sizes: [0.5, 1.0], streets: ["flop", "turn", "river"], players: 2 },
      hand("As", "Ks", "Qd")) === true);
  ok("validateAbstraction passes empty (pillar 1)",
    validateAbstraction({ sizes: [], streets: [], players: 2 }) === true);

  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  ok("rejects too many sizes",
    throws(() => validateAbstraction({ sizes: [0.25, 0.5, 0.75, 1.0, 1.5], streets: ["turn"], players: 2 })));
  ok("rejects sizes x streets over cap (4x3=12 > cap 9)",
    throws(() => validateAbstraction({ sizes: [0.25, 0.5, 0.75, 1.0], streets: ["flop", "turn", "river"], players: 2 })));
  ok("rejects non-contiguous streets",
    throws(() => validateAbstraction({ sizes: [1.0], streets: ["flop", "river"], players: 2 })));
  ok("rejects players < 2",
    throws(() => validateAbstraction({ sizes: [1.0], streets: ["turn"], players: 1 })));
  ok("rejects board/street mismatch",
    throws(() => validateAbstraction({ sizes: [1.0], streets: ["turn"], players: 2 }, hand("As", "Ks", "Qd"))));
  ok("rejects multiway (players > 2) with a betting tree",
    throws(() => validateAbstraction({ sizes: [1.0], streets: ["turn"], players: 3 }, hand("Jh", "Th", "2c", "3s"))));
  ok("buildTree enforces the budget",
    throws(() => buildTree({ heroHand: hand("Ks", "Qd"), board: hand("As", "Ks", "Qd"), pot: 1, toAct: "hero",
      villain: { range: [] },
      abstraction: { sizes: [0.25, 0.5, 0.75, 1.0], streets: ["flop", "turn", "river"], players: 2 } })));
}

// ---------- L3: entry points throw on degenerate spots ----------
{
  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");

  // No valid villain combo (empty range) -> truth/realizationFactor throw, not null.
  const emptyVill: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
    villain: { range: [] }, abstraction: { sizes: [], streets: [], players: 2 } };
  ok("truth throws on empty villain range", throws(() => truth(emptyVill)));
  ok("realizationFactor throws on empty villain range", throws(() => realizationFactor(emptyVill)));

  // Authoring guards: reject malformed shapes instead of grading them incoherently.
  const villC = hand("Ah", "Ad");
  ok("outs rejects a non-flop/turn board (river = 5 cards)",
    throws(() => outs(heroH, hand("As", "Ks", "Qd", "Jc", "2h"), villC)));
  ok("outs accepts a flop and a turn",
    !throws(() => outs(heroH, hand("As", "Ks", "Qd"), villC)) &&
    !throws(() => outs(heroH, board4, villC)));
  // An estimate response on a tree spot (non-empty abstraction) would compare a
  // [0,1] guess to a bb EV -> grade must reject it.
  const treeSpot: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
    villain: { range: [{ combo: villC, weight: 1 }], strategy: (_s, lg) => lg.map((a) => ({ action: a, weight: a.kind === "call" ? 1 : 0 })) },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
  ok("grade rejects an estimate on a non-empty abstraction",
    throws(() => grade(treeSpot, { kind: "estimate", value: 0.5 })));

  // Drawing dead (raw all-in equity 0) -> realization ratio undefined -> throws.
  const dead: State = { heroHand: hand("7h", "2d"), board: hand("As", "Ah", "Ad", "Kc", "Kd"), pot: 1,
    toAct: "hero", villain: { range: [{ combo: hand("Ac", "5s"), weight: 1 }] },
    abstraction: { sizes: [], streets: [], players: 2 } };
  ok("realizationFactor throws when raw equity is 0", throws(() => realizationFactor(dead)));
  // truth still works on a drawing-dead spot (it's a valid drill): equity 0.
  ok("truth returns 0 on a drawing-dead spot", truth(dead) === 0, `got ${truth(dead)}`);
}

// ---------- Grading: actionEVs + grade() -> Result ----------
// actionEVs at a HERO node: the 9/44 tree exposes check=6/44, bet=9/44.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const splitStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: 0.5 }));
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy: splitStrat },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
  const evs = actionEVs(buildTree(state));
  const check = evs.find((e) => e.action.kind === "check");
  const bet = evs.find((e) => e.action.kind === "bet");
  ok("actionEVs check == 6/44", approx(check ? check.ev : null, 6 / 44), `got ${check?.ev}`);
  ok("actionEVs bet == 9/44", approx(bet ? bet.ev : null, 9 / 44), `got ${bet?.ev}`);
}

// grade estimate (pillar 1): error vs truth (6/44), regretBb 0, structural tag.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }] },
    abstraction: { sizes: [], streets: [], players: 2 } };
  const close: Result = grade(state, { kind: "estimate", value: 0.15 });
  ok("grade estimate regretBb 0", close.regretBb === 0);
  ok("grade estimate error == |0.15-6/44|", approx(close.estimateError ?? null, Math.abs(0.15 - 6 / 44)),
    `got ${close.estimateError}`);
  ok("grade estimate close -> p1.ok", close.leakTag === "p1.ok", close.leakTag);
  ok("grade estimate high -> p1.overestimate",
    grade(state, { kind: "estimate", value: 0.30 }).leakTag === "p1.overestimate");
  ok("grade estimate low -> p1.underestimate",
    grade(state, { kind: "estimate", value: 0.05 }).leakTag === "p1.underestimate");
}

// grade action (pillar 1 call/fold): chop equity 0.5, pot 2, toCall 1.
//   callEV = 0.5*2 - 0.5*1 = 0.5 ; fold = 0 ; best = 0.5
{
  const state: State = { heroHand: hand("3h", "4d"), board: hand("As", "Ks", "Qd", "Jc", "2h"),
    pot: 2, toCall: 1, toAct: "hero",
    villain: { range: [{ combo: hand("3c", "4s"), weight: 1 }] },
    abstraction: { sizes: [], streets: [], players: 2 } };
  const callR = grade(state, { kind: "action", action: { kind: "call" } });
  const foldR = grade(state, { kind: "action", action: { kind: "fold" } });
  ok("grade call (priced in) regret 0", callR.regretBb === 0, `got ${callR.regretBb}`);
  ok("grade call -> p1.ok", callR.leakTag === "p1.ok", callR.leakTag);
  ok("grade fold (priced in) regret 0.5", approx(foldR.regretBb, 0.5), `got ${foldR.regretBb}`);
  ok("grade fold -> p1.overfold", foldR.leakTag === "p1.overfold", foldR.leakTag);
}

// grade action (pillar 2): 9/44 tree. bet is best (9/44); check costs 3/44.
{
  const heroH = hand("Ks", "Qd");
  const board4 = hand("Jh", "Th", "2c", "3s");
  const splitStrat = (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: 0.5 }));
  const state: State = { heroHand: heroH, board: board4, pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy: splitStrat },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 } };
  const betR = grade(state, { kind: "action", action: { kind: "bet", size: 1.0 } });
  const checkR = grade(state, { kind: "action", action: { kind: "check" } });
  ok("grade bet (optimal) regret 0", approx(betR.regretBb, 0), `got ${betR.regretBb}`);
  ok("grade bet -> p2.ok", betR.leakTag === "p2.ok", betR.leakTag);
  ok("grade check regret == 3/44", approx(checkR.regretBb, 3 / 44), `got ${checkR.regretBb}`);
  ok("grade check -> p2.missed_bet", checkR.leakTag === "p2.missed_bet", checkR.leakTag);

  // illegal action for the spot -> throws
  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };
  ok("grade throws on illegal action",
    throws(() => grade(state, { kind: "action", action: { kind: "fold" } })));
}

// ---------- L5: scheduling (SM-2, exact) ----------
{
  const r5e: Result = { regretBb: 0, estimateError: 0, leakTag: "p1.ok" };             // q5 (estimate)
  const r1e: Result = { regretBb: 0, estimateError: 0.30, leakTag: "p1.overestimate" }; // q1 (estimate)
  const r5a: Result = { regretBb: 0, leakTag: "p2.ok" };                                // q5 (action)
  const r2a: Result = { regretBb: 0.80, leakTag: "p2.overbet" };                        // q2 (action)

  ok("resultQuality estimate perfect = 5", resultQuality(r5e) === 5);
  ok("resultQuality estimate 0.05 = 4", resultQuality({ regretBb: 0, estimateError: 0.05, leakTag: "" }) === 4);
  ok("resultQuality estimate bad = 1", resultQuality(r1e) === 1);
  ok("resultQuality action perfect = 5", resultQuality(r5a) === 5);
  ok("resultQuality action regret 0.8 = 2", resultQuality(r2a) === 2);

  // New item is due immediately, ease 2.5, no reps.
  const a0 = newReview("draw-eq-01", 0);
  ok("newReview due now, ease 2.5", a0.due === 0 && a0.reps === 0 && a0.ease === 2.5 && a0.intervalDays === 0);

  // Success chain: 1 -> 6 -> round(6*ease) days; ease climbs +0.1 per q5.
  const a1 = scheduleReview(a0, r5e, 0);
  ok("review1 q5 -> reps1 interval1 due1", a1.reps === 1 && a1.intervalDays === 1 && a1.due === 1);
  ok("review1 ease 2.6", approx(a1.ease, 2.6));
  const a2 = scheduleReview(a1, r5e, 1);
  ok("review2 q5 -> reps2 interval6 due7", a2.reps === 2 && a2.intervalDays === 6 && a2.due === 7);
  ok("review2 ease 2.7", approx(a2.ease, 2.7));
  const a3 = scheduleReview(a2, r5e, 7);
  ok("review3 -> interval round(6*2.8)=17, due 24", a3.reps === 3 && a3.intervalDays === 17 && a3.due === 24);
  ok("review3 ease 2.8", approx(a3.ease, 2.8));

  // Lapse (q1): reps reset, interval 1, lapses++, ease drops by 0.54 to 2.26.
  const lap = scheduleReview(a3, r1e, 30);
  ok("lapse -> reps0 interval1 due31 lapses1",
    lap.reps === 0 && lap.intervalDays === 1 && lap.due === 31 && lap.lapses === 1);
  ok("lapse ease 2.26", approx(lap.ease, 2.26));

  // Ease floor at 1.3: hammer a low-ease item with lapses.
  let low: Review = { id: "z", ease: 1.4, reps: 0, intervalDays: 1, lapses: 0, due: 0 };
  low = scheduleReview(low, r1e, 0);
  ok("ease clamped to >= 1.3", low.ease === 1.3);

  // Selection: due items, most overdue first.
  const items: Review[] = [
    { id: "x", ease: 2.5, reps: 1, intervalDays: 1, lapses: 0, due: 5 },
    { id: "y", ease: 2.5, reps: 1, intervalDays: 1, lapses: 0, due: 2 },
    { id: "w", ease: 2.5, reps: 1, intervalDays: 1, lapses: 0, due: 20 },
  ];
  const due = dueReviews(items, 10);
  ok("dueReviews returns the 2 due, sorted by due", due.length === 2 && due[0].id === "y" && due[1].id === "x");
  ok("nextReview = most overdue", nextReview(items, 10)?.id === "y");
  ok("nextReview null when none due", nextReview(items, 1) === null);
}

// ---------- L6: content + session loop ----------
{
  const throws = (fn: () => unknown): boolean => { try { fn(); return false; } catch { return true; } };

  ok("STARTER_DRILLS spans >= 3 drills", STARTER_DRILLS.length >= 3);
  const session0 = newSession(STARTER_DRILLS);
  ok("newSession starts with no reviews", Object.keys(session0.reviews).length === 0);

  // Fresh session: every drill is due now -> first in library order.
  ok("nextDrill (fresh) = first drill", nextDrill(session0, 0)?.id === STARTER_DRILLS[0].id);

  // Grade the first drill (an estimate) perfectly: error 0, schedule advances.
  const d0 = STARTER_DRILLS[0];
  const out = gradeDrill(session0, d0.id, { kind: "estimate", value: truth(d0.state) }, 0);
  ok("gradeDrill estimate error 0", out.result.estimateError === 0, `got ${out.result.estimateError}`);
  ok("gradeDrill schedules reps1 due1", out.review.reps === 1 && out.review.due === 1);
  ok("gradeDrill returns a NEW session with the review", out.session.reviews[d0.id].due === 1);
  ok("gradeDrill is pure (input session untouched)", Object.keys(session0.reviews).length === 0);

  // d0 no longer due at now=0 -> loop advances to the next unseen drill.
  ok("nextDrill advances past the just-scheduled drill",
    nextDrill(out.session, 0)?.id === STARTER_DRILLS[1].id);

  // Run the whole library once at now=0 (any legal response); then nothing is due.
  // (Grading the preflop drill enumerates a full runout (~3s) — the suite pays it
  // once here, and we validate AA-vs-KK equity from its estimate error instead of
  // a second enumeration.)
  let s = session0;
  let preflopErr = -1, domErr = -1;
  for (const d of STARTER_DRILLS) {
    const resp: Response = d.ask === "estimate"
      ? { kind: "estimate", value: 0.5 }
      : d.ask === "category"
        ? { kind: "category", value: 2 }                 // M0 hand-reading
        : d.ask === "nuts"
          ? { kind: "nuts", value: 5 }                   // M0 name-the-nuts (board-only)
          : d.ask === "outs"
          ? { kind: "outs", value: 8 }                   // M1 out-counting
          : d.ask === "combos"
          ? { kind: "combos", value: 6 }                 // M4.5 counting combos
          : d.ask === "mdf"
          ? { kind: "mdf", value: 0.5 }                  // M5.7 minimum defense frequency
          : d.ask === "bluffs"
          ? { kind: "bluffs", value: 0.33 }              // M5.7 bluff frequency
          : (d.state.abstraction.sizes.length === 0 || d.state.abstraction.heroFacesBet !== undefined)
            ? { kind: "action", action: { kind: "call" } } // pillar-1 call/fold OR hero-faces-bet root
            : { kind: "action", action: { kind: "check" } }; // pillar-2 (legal at root)
    const out = gradeDrill(s, d.id, resp, 0);
    s = out.session;
    if (d.id === "p1-aa-vs-kk-preflop" && out.result.estimateError !== undefined) preflopErr = out.result.estimateError;
    if (d.id === "p1-ak-vs-aq" && out.result.estimateError !== undefined) domErr = out.result.estimateError;
  }
  ok("nothing due immediately after grading the whole library", nextDrill(s, 0) === null);
  ok("drills come due again at now=1", nextDrill(s, 1) !== null);
  ok("preflop AA vs KK truth ~0.826 (error from a 0.5 estimate)", approx(preflopErr, 0.8264 - 0.5, 0.005),
    `err ${preflopErr}`);
  ok("preflop AK vs AQ domination truth ~0.740 (error from a 0.5 estimate)", approx(domErr, 0.7402 - 0.5, 0.005),
    `err ${domErr}`);

  ok("gradeDrill throws on an unknown drill id",
    throws(() => gradeDrill(session0, "no-such-drill", { kind: "estimate", value: 0.5 }, 0)));
}

// ---------- L6: richer leak taxonomy + expanded content ----------
{
  // classifyLeak maps grade()'s structural tag -> a module-specific named leak.
  const mk = (module: string): Drill =>
    ({ id: "t", module, title: "", ask: "estimate", state: STARTER_DRILLS[0].state });
  const tag = (module: string, structural: string): string =>
    classifyLeak(mk(module), { regretBb: 0, estimateError: 0, leakTag: structural });

  ok("M1 over -> overcounts_outs", tag("M1", "p1.overestimate") === "m1.overcounts_outs");
  ok("M1 under -> undercounts_outs", tag("M1", "p1.underestimate") === "m1.undercounts_outs");
  ok("M2 over -> overestimates_equity", tag("M2", "p1.overestimate") === "m2.overestimates_equity");
  ok("M5 over -> overrates_vs_range", tag("M5", "p1.overestimate") === "m5.overrates_vs_range");
  ok("M3 overfold -> folds_when_priced_in", tag("M3", "p1.overfold") === "m3.folds_when_priced_in");
  ok("M3 spew -> calls_when_overpriced", tag("M3", "p1.spew") === "m3.calls_when_overpriced");
  ok("P2 missed_bet -> misses_thin_value", tag("P2", "p2.missed_bet") === "p2.misses_thin_value");
  ok("P2 overbet -> bets_too_big", tag("P2", "p2.overbet") === "p2.bets_too_big");
  ok("P1 over -> overvalues_holding", tag("P1", "p1.overestimate") === "p1.overvalues_holding");
  ok("P1 under -> undervalues_holding", tag("P1", "p1.underestimate") === "p1.undervalues_holding");
  // Fallbacks: 'ok' and unmapped modules become module-scoped structural tags.
  ok("M2 ok -> m2.ok (fallback)", tag("M2", "p1.ok") === "m2.ok");
  ok("unmapped module -> module-scoped structural", tag("P3", "p2.overfold") === "p3.overfold");

  // Expanded content covers M1/M2/M3/M5/P2.
  const modules = new Set(STARTER_DRILLS.map((d) => d.module));
  ok("STARTER_DRILLS spans M1,M2,M3,M5,P2",
    ["M1", "M2", "M3", "M5", "P2"].every((m) => modules.has(m)), [...modules].join(","));

  const byId = (id: string): Drill => STARTER_DRILLS.find((d) => d.id === id)!;
  const session = newSession(STARTER_DRILLS);

  // gradeDrill emits the refined module tag (not grade()'s raw structural tag).
  const overM2 = gradeDrill(session, "m2-kqo-vs-aa", { kind: "estimate", value: 0.95 }, 0);
  ok("gradeDrill M2 overestimate -> m2.overestimates_equity",
    overM2.result.leakTag === "m2.overestimates_equity", overM2.result.leakTag);

  const overM1 = gradeDrill(session, "m1-flush-draw-outs", { kind: "outs", value: 12 }, 0);
  ok("gradeDrill M1 overcount -> m1.overcounts_outs",
    overM1.result.leakTag === "m1.overcounts_outs", overM1.result.leakTag);
  const underM1 = gradeDrill(session, "m1-flush-draw-outs", { kind: "outs", value: 6 }, 0);
  ok("gradeDrill M1 undercount -> m1.undercounts_outs",
    underM1.result.leakTag === "m1.undercounts_outs", underM1.result.leakTag);
  const exactM1 = gradeDrill(session, "m1-flush-draw-outs", { kind: "outs", value: 9 }, 0);
  ok("gradeDrill M1 exact (9 outs) -> m1.ok", exactM1.result.leakTag === "m1.ok", exactM1.result.leakTag);

  const overM5 = gradeDrill(session, "m5-overcards-vs-pairs", { kind: "estimate", value: 0.95 }, 0);
  ok("gradeDrill M5 overestimate -> m5.overrates_vs_range",
    overM5.result.leakTag === "m5.overrates_vs_range", overM5.result.leakTag);

  const foldM3 = gradeDrill(session, "m3-chop-potodds", { kind: "action", action: { kind: "fold" } }, 0);
  ok("gradeDrill M3 fold (priced in) -> m3.folds_when_priced_in",
    foldM3.result.leakTag === "m3.folds_when_priced_in", foldM3.result.leakTag);

  // M1 out-counting grades against the exact out count (flush draw = 9).
  const m1s = byId("m1-flush-draw-outs").state;
  ok("m1 flush draw has 9 outs", outs(m1s.heroHand!, m1s.board, m1s.villain.range[0].combo) === 9);
  ok("m5 drill truth is a number", typeof truth(byId("m5-overcards-vs-pairs").state) === "number");
}

// ---------- L6 #2: more drills (M3.5 fold equity, P3 multi-street, P4 multiway) ----------
{
  const byId = (id: string): Drill => STARTER_DRILLS.find((d) => d.id === id)!;
  const session = newSession(STARTER_DRILLS);

  // P4 multiway: truth is field-aware (chop 0.5 vs a 2-opponent field = 0.5^2).
  const p4 = byId("p4-multiway-field");
  ok("P4 truth = fieldEquity = 0.25", truth(p4.state) === 0.25, `got ${truth(p4.state)}`);
  ok("P4 overestimate -> p4.overrates_field",
    gradeDrill(session, p4.id, { kind: "estimate", value: 0.5 }, 0).result.leakTag === "p4.overrates_field");
  ok("P4 calibrated -> p4.ok",
    gradeDrill(session, p4.id, { kind: "estimate", value: 0.25 }, 0).result.leakTag === "p4.ok");

  // M3.5 fold equity: betting a semi-bluff is best -> checking is the leak.
  const m35 = byId("m35-semibluff-flushdraw");
  ok("M3.5 best action is bet (fold equity)", bestAction(buildTree(m35.state)).kind === "bet");
  ok("M3.5 check -> m35.gives_up_fold_equity",
    gradeDrill(session, m35.id, { kind: "action", action: { kind: "check" } }, 0).result.leakTag
      === "m35.gives_up_fold_equity");

  // P3 multi-street value: nuts value-bet across flop+turn; checking leaves 3 bb.
  const p3 = byId("p3-value-two-streets");
  const p3check = gradeDrill(session, p3.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("P3 check regret == 3 bb", approx(p3check.result.regretBb, 3), `got ${p3check.result.regretBb}`);
  ok("P3 check -> p3.misses_multistreet_value", p3check.result.leakTag === "p3.misses_multistreet_value");

  // P5 exploit: villain over-folds, so bluffing (bet) is best; checking is the leak.
  const p5 = byId("p5-exploit-overfolder");
  ok("P5 best action is bet (exploit overfold)", bestAction(buildTree(p5.state)).kind === "bet");
  const p5check = gradeDrill(session, p5.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("P5 check regret == 0.6 bb", approx(p5check.result.regretBb, 0.6), `got ${p5check.result.regretBb}`);
  ok("P5 check -> p5.misses_exploit", p5check.result.leakTag === "p5.misses_exploit");

  // Street-aware villain (floats the flop, folds the turn): bet the flop and double-barrel.
  const fl = byId("p5-exploit-floater");
  ok("exploit floater: best flop action is bet (double-barrel plan)", bestAction(buildTree(fl.state)).kind === "bet");
  const flcheck = gradeDrill(session, fl.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("exploit floater: checking the flop -> p5.misses_exploit",
    flcheck.result.regretBb > 0 && flcheck.result.leakTag === "p5.misses_exploit", flcheck.result.leakTag);

  // Maniac (call down) vs nit (fold to): the read overrides hand strength.
  ok("exploit maniac: best is call (weak hand, over-bluffer)", bestAction(buildTree(byId("p5-exploit-maniac").state)).kind === "call");
  ok("exploit maniac: folding -> p5.overfolds_vs_a_bluffer",
    gradeDrill(session, "p5-exploit-maniac", { kind: "action", action: { kind: "fold" } }, 0).result.leakTag === "p5.overfolds_vs_a_bluffer");
  ok("exploit nit: best is fold (strong hand, never bluffs)", bestAction(buildTree(byId("p5-exploit-nit").state)).kind === "fold");
  ok("exploit nit: calling -> p5.pays_off_a_nit",
    gradeDrill(session, "p5-exploit-nit", { kind: "action", action: { kind: "call" } }, 0).result.leakTag === "p5.pays_off_a_nit");

  // M4 sequencing: nuts value across flop+turn; checking the flop leaves 3 bb.
  const m4 = byId("m4-sequence-two-streets");
  const m4check = gradeDrill(session, m4.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("M4 check regret == 3 bb", approx(m4check.result.regretBb, 3), `got ${m4check.result.regretBb}`);
  ok("M4 check -> m4.misses_street_sequence", m4check.result.leakTag === "m4.misses_street_sequence");

  ok("STARTER_DRILLS now spans 108 drills incl M0/M3.5/M4/M4.5/M5.6/M5.7/P0/P1/P2/P2.5/P3/P3.4/P3.5/P4/P5",
    STARTER_DRILLS.length === 108 &&
    ["M0", "M3.5", "M4", "M4.5", "M5.6", "M5.7", "P0", "P1", "P3", "P4", "P5"].every((m) => STARTER_DRILLS.some((d) => d.module === m)));

  // M4.5 combo counting: base counts and blocker removal, all hand-checkable.
  ok("comboCount: A-K unpaired, no blockers = 16", comboCount(hand("Ah", "Kh"), []) === 16);
  ok("comboCount: pocket aces, no blockers = 6", comboCount(hand("Ah", "Ad"), []) === 6);
  ok("comboCount: pocket aces with one ace visible = 3", comboCount(hand("Ah", "Ad"), hand("As")) === 3);
  ok("comboCount: A-K with an ace and a king visible = 9", comboCount(hand("Ah", "Kh"), hand("As", "Ks")) === 9);
  const combSess = newSession(STARTER_DRILLS);
  const combUnp = gradeDrill(combSess, "m45-combos-unpaired", { kind: "combos", value: 16 }, 0).result;
  ok("m45-combos-unpaired: 16 is exact (error 0)", combUnp.estimateError === 0);
  const combPair = gradeDrill(combSess, "m45-combos-pair", { kind: "combos", value: 6 }, 0).result;
  ok("m45-combos-pair: 6 is exact (error 0)", combPair.estimateError === 0);
  const combBlock = gradeDrill(combSess, "m45-combos-blocker", { kind: "combos", value: 3 }, 0).result;
  ok("m45-combos-blocker: 3 is exact (error 0)", combBlock.estimateError === 0);
  const combOver = gradeDrill(combSess, "m45-combos-pair", { kind: "combos", value: 9 }, 0).result;
  ok("m45-combos overcount -> m45.overcounts_combos", combOver.leakTag === "m45.overcounts_combos");

  // M5.7 balance math: the frequency constants, all pure functions of pot & bet.
  ok("minDefenseFreq: pot-sized bet = 0.5", minDefenseFreq(1, 1) === 0.5);
  ok("minDefenseFreq: quarter-pot bet = 0.8", Math.abs(minDefenseFreq(1, 0.25) - 0.8) < 1e-12);
  ok("bluffFrequency: pot-sized bet = 1/3", Math.abs(bluffFrequency(1, 1) - 1 / 3) < 1e-12);
  ok("bluffFrequency: half-pot bet = 0.25", bluffFrequency(1, 0.5) === 0.25);
  ok("MDF + alpha identity: defend + fold = 1", Math.abs(minDefenseFreq(3, 2) + 2 / (3 + 2) - 1) < 1e-12);
  const balSess = newSession(STARTER_DRILLS);
  const mdfPot = gradeDrill(balSess, "m57-mdf-pot-bet", { kind: "mdf", value: 0.5 }, 0).result;
  ok("m57-mdf-pot-bet: 50% is exact (error 0, ok tag)", mdfPot.estimateError === 0 && mdfPot.leakTag.endsWith(".ok"));
  const mdfUnder = gradeDrill(balSess, "m57-mdf-pot-bet", { kind: "mdf", value: 0.3 }, 0).result;
  ok("m57-mdf underdefend (30% vs 50%) -> m57.underdefends", mdfUnder.leakTag === "m57.underdefends");
  const mdfSmall = gradeDrill(balSess, "m57-mdf-small-bet", { kind: "mdf", value: 0.8 }, 0).result;
  ok("m57-mdf-small-bet: 80% is exact (ok)", mdfSmall.leakTag.endsWith(".ok"));
  const bluffPot = gradeDrill(balSess, "m57-bluff-pot-bet", { kind: "bluffs", value: 0.333 }, 0).result;
  ok("m57-bluff-pot-bet: 33.3% within tolerance (ok)", bluffPot.leakTag.endsWith(".ok"));
  const bluffOver = gradeDrill(balSess, "m57-bluff-half-pot", { kind: "bluffs", value: 0.5 }, 0).result;
  ok("m57-bluff-half-pot overbluff (50% vs 25%) -> m57.overbluffs", bluffOver.leakTag === "m57.overbluffs");

  // Check-raise-range drill: villain raises only what beats hero (policy + raise).
  const cr = byId("p5-vs-checkraise-range");
  const crVill = buildTree(cr.state).children!.find((c) => c.action!.kind === "bet")!.node;
  ok("check-raise range: villain node offers fold/call/raise", (crVill.children ?? []).length === 3);
  ok("check-raise range: best action is check", bestAction(buildTree(cr.state)).kind === "check");
  ok("check-raise range: betting EV ~ -0.2 (raised when behind, folds out the rest)",
    approx(actionEVs(buildTree(cr.state)).find((e) => e.action.kind === "bet")!.ev, -0.2));
  const crBet = gradeDrill(session, cr.id, { kind: "action", action: { kind: "bet", size: 1.0 } }, 0);
  ok("check-raise range: betting -> p5.bets_into_strong_range",
    crBet.result.regretBb > 0 && crBet.result.leakTag === "p5.bets_into_strong_range", crBet.result.leakTag);

  // Range-narrowing drill: betting runs into a strong calling range; check is best.
  const tv = byId("p5-thin-value-vs-range");
  ok("range narrowing: best action is check", bestAction(buildTree(tv.state)).kind === "check");
  const betThin = gradeDrill(session, tv.id, { kind: "action", action: { kind: "bet", size: 1.0 } }, 0);
  ok("range narrowing: betting thin -> p5.bets_into_strong_range",
    betThin.result.regretBb > 0 && betThin.result.leakTag === "p5.bets_into_strong_range", betThin.result.leakTag);
  ok("range narrowing: check shows down vs the FULL range (no narrowing on a check)",
    approx(actionEVs(buildTree(tv.state)).find((e) => e.action.kind === "check")!.ev,
      equityVsRange(hand("As", "Js"), hand("Ad", "8c", "3h", "2s"),
        [{ combo: hand("Ah", "Kh"), weight: 1 }, { combo: hand("Qh", "Qc"), weight: 1 }]) ?? -1));

  // Pot control (P3): a medium top pair on the turn -> checking beats betting into a
  // range whose callers all beat you and whose folders are near-dead.
  const pc = byId("p3-pot-control");
  ok("pot control: best action is check", bestAction(buildTree(pc.state)).kind === "check");
  const betPc = gradeDrill(session, pc.id, { kind: "action", action: { kind: "bet", size: 1.0 } }, 0);
  ok("pot control: betting a medium hand -> p3.overbets_multistreet",
    betPc.result.regretBb > 0 && betPc.result.leakTag === "p3.overbets_multistreet", betPc.result.leakTag);

  // Deeper raise trees: 3-bet the nuts at the root (heroFacesBet + raiseCap 1).
  const tb = byId("p3-3bet-the-nuts");
  const tbEvs = actionEVs(buildTree(tb.state));
  ok("3-bet: root offers fold/call/raise", tbEvs.length === 3);
  ok("3-bet: raise EV 5 > call EV 2 (nuts re-raised, paid off)",
    tbEvs.find((e) => e.action.kind === "bet")!.ev === 5 && tbEvs.find((e) => e.action.kind === "call")!.ev === 2);
  ok("3-bet: best action is the raise", bestAction(buildTree(tb.state)).kind === "bet");
  const flat = gradeDrill(session, tb.id, { kind: "action", action: { kind: "call" } }, 0);
  ok("3-bet: flatting the nuts -> p3.flats_instead_of_raising (regret 3)",
    flat.result.regretBb === 3 && flat.result.leakTag === "p3.flats_instead_of_raising",
    `${flat.result.regretBb} ${flat.result.leakTag}`);

  // P3.5 River decisions: raise / call-thin / call-bluffcatch / fold-multiway, each
  // graded through the heroFacesBet river tree; wrong actions map to p35.* leaks.
  const rbest = (id: string): string => bestAction(buildTree(byId(id).state)).kind;
  const rleak = (id: string, a: Action): string =>
    gradeDrill(session, id, { kind: "action", action: a }, 0).result.leakTag;
  // the raise action in a heroFacesBet tree carries a chain-computed size, not 1.0.
  const raiseOf = (id: string): Action => actionEVs(buildTree(byId(id).state)).find((e) => e.action.kind === "bet")!.action;
  ok("river value-raise: best is raise", rbest("p35-river-value-raise") === "bet");
  ok("river value-raise: flatting -> p35.flats_a_value_raise",
    rleak("p35-river-value-raise", { kind: "call" }) === "p35.flats_a_value_raise");
  ok("river thin-value: best is call (raising is too thin)", rbest("p35-river-thin-value") === "call");
  ok("river thin-value: raising -> p35.raises_into_better",
    rleak("p35-river-thin-value", raiseOf("p35-river-thin-value")) === "p35.raises_into_better");
  ok("river bluff-catch: best is call", rbest("p35-river-bluff-catch") === "call");
  ok("river bluff-catch: folding -> p35.overfolds_the_river",
    rleak("p35-river-bluff-catch", { kind: "fold" }) === "p35.overfolds_the_river");
  ok("river multiway: best is fold (condensed range)", rbest("p35-river-multiway-fold") === "fold");
  ok("river multiway: calling -> p35.pays_off_the_river",
    rleak("p35-river-multiway-fold", { kind: "call" }) === "p35.pays_off_the_river");
  // The discrimination: SAME hero hand (AsKd top pair) is a CALL heads-up but a FOLD
  // four-way (range condensed to value) — the module's multiway lesson.
  ok("river discrimination: same top pair -> call heads-up, fold multiway",
    rbest("p35-river-bluff-catch") === "call" && rbest("p35-river-multiway-fold") === "fold");

  // Reading the bet SIZE: same KcQd top pair -> call a small bet (bluffy), fold a big overbet (value).
  ok("size read: call a small bet (bluff-catch)", rbest("p35-call-small-bet") === "call");
  ok("size read: folding the small bet -> p35.overfolds_the_river",
    rleak("p35-call-small-bet", { kind: "fold" }) === "p35.overfolds_the_river");
  ok("size read: fold a big overbet (value range)", rbest("p35-fold-an-overbet") === "fold");
  ok("size read: calling the overbet -> p35.pays_off_the_river",
    rleak("p35-fold-an-overbet", { kind: "call" }) === "p35.pays_off_the_river");
  ok("size read discrimination: same hand -> call small, fold overbet",
    rbest("p35-call-small-bet") === "call" && rbest("p35-fold-an-overbet") === "fold");

  // raiseCap 2 builds & evaluates a re-raise chain (hero re-raises villain's raise).
  const deep: State = {
    heroHand: hand("9s", "8s"), board: hand("7s", "6s", "5s", "2d"), pot: 1, toAct: "hero",
    villain: {
      range: [{ combo: hand("Kh", "Kd"), weight: 1 }],
      strategy: (_s: NodeState, legal: Action[]) =>
        legal.map((a) => ({ action: a, weight: a.kind === "bet" || a.kind === "call" ? 1 : 0 })),
    },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2, raiseCap: 2 },
  };
  ok("raiseCap 2 builds & evaluates a deeper raise chain", Number.isFinite(bestResponseEV(buildTree(deep))));

  // Magnitude-aware tagger: a sizing drill distinguishes under- from over-betting.
  const sz = byId("p2-size-up-nuts");
  const szEvs = actionEVs(buildTree(sz.state));
  ok("sizing: bigger bet is best (EV 2 > 1.5 > check 1)",
    szEvs.find((e) => e.action.kind === "bet" && e.action.size === 1.0)!.ev === 2 &&
    szEvs.find((e) => e.action.kind === "bet" && e.action.size === 0.5)!.ev === 1.5 &&
    szEvs.find((e) => e.action.kind === "check")!.ev === 1);
  const small = gradeDrill(session, sz.id, { kind: "action", action: { kind: "bet", size: 0.5 } }, 0);
  ok("sizing: under-bet -> p2.bets_too_small (regret 0.5)",
    small.result.regretBb === 0.5 && small.result.leakTag === "p2.bets_too_small",
    `${small.result.regretBb} ${small.result.leakTag}`);
  const big = gradeDrill(session, sz.id, { kind: "action", action: { kind: "bet", size: 1.0 } }, 0);
  ok("sizing: best size -> regret 0, p2.ok", big.result.regretBb === 0 && big.result.leakTag === "p2.ok");
  const chk = gradeDrill(session, sz.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("sizing: checking the nuts -> p2.misses_thin_value", chk.result.leakTag === "p2.misses_thin_value");

  // Sizing DEPTH (size-dependent villains): small for thin value, big to deny equity, overbet a capped range.
  const bestSz = (id: string): string => { const b = bestAction(buildTree(byId(id).state)); return b.kind === "bet" ? `bet${b.size}` : b.kind; };
  ok("sizing: thin value -> bet SMALL (0.33) is best", bestSz("p2-bet-small-thin-value") === "bet0.33");
  ok("sizing: thin value over-sizing -> p2.bets_too_big",
    gradeDrill(session, "p2-bet-small-thin-value", { kind: "action", action: { kind: "bet", size: 1.0 } }, 0).result.leakTag === "p2.bets_too_big");
  ok("sizing: deny equity -> bet BIG (1.5) is best", bestSz("p2-bet-big-deny-equity") === "bet1.5");
  ok("sizing: deny equity under-sizing -> p2.bets_too_small",
    gradeDrill(session, "p2-bet-big-deny-equity", { kind: "action", action: { kind: "bet", size: 0.5 } }, 0).result.leakTag === "p2.bets_too_small");
  ok("sizing: overbet a capped range -> bet 2x is best (not the 3x)", bestSz("p2-overbet-capped-range") === "bet2");
  ok("sizing: overbet too much (3x) -> p2.bets_too_big",
    gradeDrill(session, "p2-overbet-capped-range", { kind: "action", action: { kind: "bet", size: 3.0 } }, 0).result.leakTag === "p2.bets_too_big");
  ok("overbet bluff: overbetting the air is best (bet 1.5)", bestSz("p2-overbet-bluff") === "bet1.5");
  ok("overbet bluff: a small bet gets called -> p2.bets_too_small",
    gradeDrill(session, "p2-overbet-bluff", { kind: "action", action: { kind: "bet", size: 0.5 } }, 0).result.leakTag === "p2.bets_too_small");

  // Raise SIZING (raiseSizes): choose how big to raise; villain calls up to a point then folds.
  const rsEvs = actionEVs(buildTree(byId("p2-raise-sizing").state));
  ok("raise sizing: root offers fold/call + 3 raise sizes", rsEvs.length === 5);
  ok("raise sizing: best is the pot-sized raise (size 3), not the biggest (6)",
    bestSz("p2-raise-sizing") === "bet3", bestSz("p2-raise-sizing"));
  ok("raise sizing: raising too small -> p2.bets_too_small",
    gradeDrill(session, "p2-raise-sizing", { kind: "action", action: { kind: "bet", size: 1.5 } }, 0).result.leakTag === "p2.bets_too_small");
  ok("raise sizing: raising too big (folds him out) -> p2.bets_too_big",
    gradeDrill(session, "p2-raise-sizing", { kind: "action", action: { kind: "bet", size: 6.0 } }, 0).result.leakTag === "p2.bets_too_big");
  ok("raise sizing: flatting the nuts -> p2.flats_instead_of_raising",
    gradeDrill(session, "p2-raise-sizing", { kind: "action", action: { kind: "call" } }, 0).result.leakTag === "p2.flats_instead_of_raising");

  // P2.5 Taking the lead: c-bet, donk lead (both bet best), and check-raise (raise best).
  ok("c-bet: betting is best", bestSz("p25-cbet") === "bet0.75");
  ok("c-bet: checking -> p25.checks_instead_of_betting",
    gradeDrill(session, "p25-cbet", { kind: "action", action: { kind: "check" } }, 0).result.leakTag === "p25.checks_instead_of_betting");
  ok("donk lead: betting is best", bestSz("p25-donk-lead") === "bet0.75");
  ok("donk lead: checking -> p25.checks_instead_of_betting",
    gradeDrill(session, "p25-donk-lead", { kind: "action", action: { kind: "check" } }, 0).result.leakTag === "p25.checks_instead_of_betting");
  ok("check-raise: raising is best", bestAction(buildTree(byId("p25-check-raise").state)).kind === "bet");
  ok("check-raise: flatting -> p25.flats_instead_of_raising",
    gradeDrill(session, "p25-check-raise", { kind: "action", action: { kind: "call" } }, 0).result.leakTag === "p25.flats_instead_of_raising");

  // P3.4 Barreling: value barrel (bet), bluff barrel (bet, behind but fold equity), give up (check).
  ok("value barrel: betting is best", bestSz("p34-value-barrel") === "bet0.75");
  ok("bluff barrel: betting is best (behind, but they fold)", bestSz("p34-bluff-barrel") === "bet0.75");
  ok("bluff barrel: checking -> p34.misses_a_barrel",
    gradeDrill(session, "p34-bluff-barrel", { kind: "action", action: { kind: "check" } }, 0).result.leakTag === "p34.misses_a_barrel");
  ok("give up: checking is best (same hand, sticky villain)", bestSz("p34-give-up") === "check");
  ok("give up: barreling anyway -> p34.barrels_without_fold_equity",
    gradeDrill(session, "p34-give-up", { kind: "action", action: { kind: "bet", size: 0.75 } }, 0).result.leakTag === "p34.barrels_without_fold_equity");
  // The discrimination: SAME KcQc air -> barrel when they fold, give up when they don't.
  ok("barreling discrimination: same hand, bet vs check by villain tendency",
    bestSz("p34-bluff-barrel") === "bet0.75" && bestSz("p34-give-up") === "check");

  // Read the turn CARD: same KsKd overpair -> barrel a blank turn, shut down on a scare card.
  ok("barrel a blank: betting is best", bestSz("p34-barrel-a-blank") === "bet0.75");
  ok("scare card: checking (shutdown) is best", bestSz("p34-scare-card-shutdown") === "check");
  ok("scare card: barreling anyway -> p34.barrels_without_fold_equity",
    gradeDrill(session, "p34-scare-card-shutdown", { kind: "action", action: { kind: "bet", size: 0.75 } }, 0).result.leakTag === "p34.barrels_without_fold_equity");
  ok("scare-card discrimination: same overpair -> bet a blank, check a scare card",
    bestSz("p34-barrel-a-blank") === "bet0.75" && bestSz("p34-scare-card-shutdown") === "check");

  // Added module depth: M2 big-draw, M5 wider range (cheap), P1 race (preflop).
  const m2c = gradeDrill(session, "m2-combo-draw", { kind: "estimate", value: 0.95 }, 0);
  ok("M2 big-draw overestimate -> m2.overestimates_equity",
    m2c.result.leakTag === "m2.overestimates_equity" && (m2c.truth ?? 1) < 0.95, m2c.result.leakTag);
  // Pin the board: Js Ts on 9s 8s 2c is the 15-out combo (flush + open-ender) the
  // title/EXPLAIN teach -> 56.3%. Guards the 8h/8s typo that made it an 8-out spot.
  ok("M2 combo draw is the 15-out flush+straight (~0.563)", approx(m2c.truth ?? 0, 0.563, 0.005), `${m2c.truth}`);
  const m5w = gradeDrill(session, "m5-wide-range", { kind: "estimate", value: 0.95 }, 0);
  ok("M5 wide-range overestimate -> m5.overrates_vs_range",
    m5w.result.leakTag === "m5.overrates_vs_range" && (m5w.truth ?? 1) < 0.95, m5w.result.leakTag);
  const race = STARTER_DRILLS.find((d) => d.id === "p1-akx-vs-qq-race")!;
  ok("P1 race drill is a preflop estimate", race.ask === "estimate" && race.state.board.length === 0);

  // Villain raises (flag-gated): facing hero's bet, villain can fold/call/RAISE.
  const vr = byId("p5-value-vs-raiser");
  const vrVill = buildTree(vr.state).children!.find((c) => c.action!.kind === "bet")!.node;
  const p2Vill = buildTree(byId("p2-bet-or-check").state).children!.find((c) => c.action!.kind === "bet")!.node;
  ok("villainRaises: villain has fold/call/raise (3 options)", (vrVill.children ?? []).length === 3);
  ok("default: villain only fold/call (2 options)", (p2Vill.children ?? []).length === 2);

  const vrEvs = actionEVs(buildTree(vr.state));
  ok("villain-raise check EV == 1 (nuts, just showdown)",
    vrEvs.find((e) => e.action.kind === "check")!.ev === 1);
  ok("villain-raise bet EV == 5 (raised, hero re-calls the nuts)",
    vrEvs.find((e) => e.action.kind === "bet")!.ev === 5);
  ok("villain-raise best action is bet", bestAction(buildTree(vr.state)).kind === "bet");
  const vrCheck = gradeDrill(session, vr.id, { kind: "action", action: { kind: "check" } }, 0);
  ok("villain-raise: checking misses value -> regret 4, p5.misses_exploit",
    vrCheck.result.regretBb === 4 && vrCheck.result.leakTag === "p5.misses_exploit",
    `${vrCheck.result.regretBb} ${vrCheck.result.leakTag}`);

  // P1 preflop drill is well-formed (board empty); equity is validated in the loop above.
  const p1 = STARTER_DRILLS.find((d) => d.module === "P1")!;
  ok("P1 drill is a preflop estimate", p1.ask === "estimate" && p1.state.board.length === 0);

  // M5.6 implied odds — a REAL multi-street tree (heroFacesBet + a villain that pays
  // off the turn), not an effective-pot shortcut: the immediate price rejects the
  // open-ender, but the future payoff makes calling +EV; folding leaks.
  const m56 = byId("m56-implied-odds-oesd");
  ok("M5.6 implied-odds drill is a genuine tree (heroFacesBet, non-empty abstraction)",
    m56.state.abstraction.sizes.length > 0 && m56.state.abstraction.heroFacesBet !== undefined);
  const m56call = gradeDrill(session, m56.id, { kind: "action", action: { kind: "call" } }, 0);
  const m56fold = gradeDrill(session, m56.id, { kind: "action", action: { kind: "fold" } }, 0);
  ok("M5.6 call (implied odds) is optimal", m56call.result.regretBb === 0, `got ${m56call.result.regretBb}`);
  ok("M5.6 fold leaks implied odds", m56fold.result.regretBb > 0 &&
    m56fold.result.leakTag === "m56.folds_with_implied_odds", m56fold.result.leakTag);
}

// ---------- Persistence: serializeSession / loadSession ----------
{
  const s0 = newSession(STARTER_DRILLS);
  const s1 = gradeDrill(s0, "m2-kqo-vs-aa", { kind: "estimate", value: truth(STARTER_DRILLS[0].state) }, 0).session;
  const s2 = gradeDrill(s1, "m3-chop-potodds", { kind: "action", action: { kind: "call" } }, 0).session;

  const json = serializeSession(s2);
  ok("serialized JSON carries version + reviews", json.includes("\"version\"") && json.includes("\"reviews\""));

  const restored = loadSession(STARTER_DRILLS, json);
  ok("round-trip preserves both reviews", Object.keys(restored.reviews).length === 2);
  for (const id of ["m2-kqo-vs-aa", "m3-chop-potodds"]) {
    const a = s2.reviews[id], b = restored.reviews[id];
    ok(`round-trip ${id} intact`,
      b.due === a.due && b.reps === a.reps && b.intervalDays === a.intervalDays &&
      b.lapses === a.lapses && approx(b.ease, a.ease));
  }
  ok("restored session keeps the full drill library", restored.drills.length === STARTER_DRILLS.length);

  // Reviews for drills no longer in the library are dropped on load.
  const smaller = STARTER_DRILLS.filter((d) => d.id !== "m3-chop-potodds");
  const pruned = loadSession(smaller, json);
  ok("unknown drill id dropped on load",
    pruned.reviews["m2-kqo-vs-aa"] !== undefined && pruned.reviews["m3-chop-potodds"] === undefined);

  // Missing / malformed input -> fresh session (lenient, never throws).
  ok("no json -> fresh", Object.keys(loadSession(STARTER_DRILLS).reviews).length === 0);
  ok("empty string -> fresh", Object.keys(loadSession(STARTER_DRILLS, "").reviews).length === 0);
  ok("garbage -> fresh", Object.keys(loadSession(STARTER_DRILLS, "{not json").reviews).length === 0);
}

// ---------- Fast 7-card evaluator: cross-validate vs the reference ----------
{
  const eqScore = (a: Score, b: Score): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  // deterministic LCG (no Math.random) so the cross-check is reproducible
  let seed = 123456789;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const N = 4000;
  let mism = 0;
  for (let i = 0; i < N; i++) {
    const picked = new Set<number>();
    while (picked.size < 7) picked.add(Math.floor(rnd() * 52));
    const seven = [...picked];
    if (!eqScore(score7(seven), score7slow(seven))) mism++;
  }
  ok(`fast score7 == reference on ${N} random 7-card hands`, mism === 0, `${mism} mismatches`);

  const same = (cs: string[]): boolean => eqScore(score7(hand(...cs)), score7slow(hand(...cs)));
  ok("edge: wheel straight", same(["As", "2h", "3d", "4c", "5s", "Kd", "Qc"]));
  ok("edge: wheel straight flush", same(["As", "2s", "3s", "4s", "5s", "Kd", "Qc"]));
  ok("edge: royal flush + noise", same(["As", "Ks", "Qs", "Js", "Ts", "2h", "2d"]));
  ok("edge: two trips -> full house", same(["9s", "9h", "9d", "8s", "8h", "8d", "2c"]));
  ok("edge: three pairs -> two pair", same(["As", "Ah", "Ks", "Kh", "Qs", "Qh", "2c"]));
  ok("edge: quads + kicker", same(["7s", "7h", "7d", "7c", "Ks", "Qd", "2c"]));
  ok("edge: flush over a paired board", same(["As", "Js", "8s", "5s", "2s", "Kh", "Kd"]));
  ok("edge: full house beats a flush draw", same(["9s", "9h", "9d", "Ks", "Kh", "2s", "3s"]));
  ok("edge: straight (not flush)", same(["9s", "8h", "7d", "6c", "5s", "2h", "2d"]));
  ok("edge: 6-high straight beats the wheel", same(["6s", "5h", "4d", "3c", "2s", "As", "Kd"]));
}

// ---------- M6: calibration report ----------
{
  ok("calibration empty -> n0, brier null, no buckets",
    (() => { const c = calibration([]); return c.n === 0 && c.brier === null && c.buckets.length === 0; })());

  // Perfectly calibrated: estimate == truth everywhere -> brier 0, every gap 0.
  const perfect = calibration([{ estimate: 0.3, truth: 0.3 }, { estimate: 0.7, truth: 0.7 }]);
  ok("calibration perfect -> brier 0", perfect.brier === 0);
  ok("calibration perfect -> 2 buckets, all gaps 0",
    perfect.buckets.length === 2 && perfect.buckets.every((b) => b.gap === 0));

  // Overconfident: high estimates, lower truths -> one bucket, positive gap.
  const over = calibration([{ estimate: 0.80, truth: 0.40 }, { estimate: 0.85, truth: 0.40 }]);
  ok("calibration overconfident -> one bucket [0.8,0.9)",
    over.buckets.length === 1 && over.buckets[0].lo === 0.8);
  ok("calibration gap = meanEstimate - meanTruth",
    approx(over.buckets[0].gap, (0.80 + 0.85) / 2 - 0.40));
  ok("calibration brier = mean squared error",
    approx(over.brier ?? -1, ((0.80 - 0.40) ** 2 + (0.85 - 0.40) ** 2) / 2));

  // Bucket edges: estimate 1.0 -> last bucket [0.9,1.0]; 0.0 -> first [0,0.1).
  const edge = calibration([{ estimate: 1.0, truth: 0.9 }, { estimate: 0.0, truth: 0.1 }]);
  ok("calibration bucket edges (0 and 1)",
    edge.buckets.length === 2 && edge.buckets[0].lo === 0 && edge.buckets[1].hi === 1);

  // gradeDrill exposes the ground truth for estimate drills (for calibration sets).
  const out = gradeDrill(newSession(STARTER_DRILLS), "m2-kqo-vs-aa", { kind: "estimate", value: 0.2 }, 0);
  ok("gradeDrill exposes truth for estimates", approx(out.truth ?? -1, 6 / 44), `got ${out.truth}`);
  // action drills carry no truth value
  const act = gradeDrill(newSession(STARTER_DRILLS), "m3-chop-potodds", { kind: "action", action: { kind: "call" } }, 0);
  ok("gradeDrill has no truth for actions", act.truth === undefined);
}

// ---------- Villain strategy is a distribution: EV is normalized ----------
{
  // A declared strategy is a probability distribution over the villain's legal
  // actions; bestResponseEV must normalize by the total weight, so authoring
  // weights that don't pre-sum to 1 can't silently scale the EV. KsQd vs AA with
  // one pot bet: a 50/50 fold/call villain yields the true 9/44. Doubling both
  // weights (sum 2) must give the SAME EV, not 2x; an all-zero dist must throw.
  const mk = (strategy: (s: NodeState, legal: Action[]) => { action: Action; weight: number }[]): State => ({
    heroHand: hand("Ks", "Qd"), board: hand("Jh", "Th", "2c", "3s"), pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ah", "Ad"), weight: 1 }], strategy },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
  });
  const betEV = (s: State): number => actionEVs(buildTree(s)).find((e) => e.action.kind === "bet")!.ev;
  const w = (v: number) => (_s: NodeState, legal: Action[]) => legal.map((a) => ({ action: a, weight: v }));
  ok("villain strategy summing to 1 gives 9/44", approx(betEV(mk(w(0.5))), 9 / 44, 1e-9), `${betEV(mk(w(0.5)))}`);
  ok("doubling all weights (sum 2) gives the SAME EV, not 2x",
    approx(betEV(mk(w(1.0))), betEV(mk(w(0.5))), 1e-9), `${betEV(mk(w(1.0)))}`);
  let threw = false;
  try { betEV(mk(w(0))); } catch { threw = true; }
  ok("an all-zero villain distribution throws (malformed)", threw);
}

// ---------- Villain-leads builder (flag-gated) + P0 ----------
{
  const byId = (id: string): Drill => STARTER_DRILLS.find((d) => d.id === id)!;
  const session = newSession(STARTER_DRILLS);

  // Flag gating: villainLeads -> hero's check leads to a VILL node (villain may
  // bet); default -> straight to showdown (villain never leads).
  const p0 = byId("p0-oop-no-equity");
  const p2 = byId("p2-bet-or-check");
  ok("villainLeads: hero-check -> VILL node", buildTree(p0.state).children![0].node.kind === "VILL");
  ok("default builder: hero-check -> showdown (not VILL)", buildTree(p2.state).children![0].node.kind !== "VILL");

  // P0 exact EVs: with 0 equity OOP, check-fold realizes 0; bluffing into a caller
  // is -1 (loses the bet). So checking is best; betting is the leak.
  const evs = actionEVs(buildTree(p0.state));
  const ck = evs.find((e) => e.action.kind === "check")!;
  const bt = evs.find((e) => e.action.kind === "bet")!;
  ok("P0 check EV == 0 (check then fold to the bet)", ck.ev === 0, `got ${ck.ev}`);
  ok("P0 bet EV == -1 (called while drawing dead)", bt.ev === -1, `got ${bt.ev}`);
  ok("P0 best action is check", bestAction(buildTree(p0.state)).kind === "check");

  const betGrade = gradeDrill(session, p0.id, { kind: "action", action: { kind: "bet", size: 1.0 } }, 0);
  ok("P0 bet regret 1 -> p0.bets_without_fold_equity",
    betGrade.result.regretBb === 1 && betGrade.result.leakTag === "p0.bets_without_fold_equity",
    `${betGrade.result.regretBb} ${betGrade.result.leakTag}`);

  // P0 in-position mirror: no villainLeads, so a hero check ENDS the street (free
  // river). The same 9-out draw realizes its full equity (check EV 9/44,
  // realizationFactor 1); betting has no fold equity vs a never-folder (EV -17/44).
  // This is the positive half of the position lesson: IP you realize, OOP you don't.
  const p0ip = byId("p0-ip-realize-equity");
  ok("P0-IP default builder: hero-check -> showdown (not VILL)",
    buildTree(p0ip.state).children![0].node.kind !== "VILL");
  const ipEvs = actionEVs(buildTree(p0ip.state));
  const ipCk = ipEvs.find((e) => e.action.kind === "check")!;
  const ipBt = ipEvs.find((e) => e.action.kind === "bet")!;
  ok("P0-IP check EV == 9/44 (free river realizes the draw)", approx(ipCk.ev, 9 / 44, 1e-9), `got ${ipCk.ev}`);
  ok("P0-IP bet EV == -17/44 (no fold equity vs a never-folder)", approx(ipBt.ev, -17 / 44, 1e-9), `got ${ipBt.ev}`);
  ok("P0-IP best action is check", bestAction(buildTree(p0ip.state)).kind === "check");
  ok("P0-IP realizationFactor == 1 (position realizes full equity)", approx(realizationFactor(p0ip.state), 1, 1e-9));
  // The falsifiable contrast: the SAME draw, moved out of position, realizes 0 --
  // the check now faces a bet and folds. Build the OOP mirror inline (villainLeads
  // + a villain that bets when checked to) so the comparison is hand-for-hand.
  const p0oopMirror = {
    ...p0ip.state,
    villain: {
      range: [{ combo: hand("Ah", "Td"), weight: 1 }],
      strategy: (_s: any, legal: any[]) =>
        legal.map((a: any) => ({ action: a, weight: (a.kind === "bet" || a.kind === "call") ? 1 : 0 })),
    },
    abstraction: { ...p0ip.state.abstraction, villainLeads: true },
  };
  const oopCk = actionEVs(buildTree(p0oopMirror)).find((e) => e.action.kind === "check")!;
  ok("position pays: same draw realizes 9/44 IP but 0 OOP",
    approx(ipCk.ev, 9 / 44, 1e-9) && oopCk.ev === 0, `IP ${ipCk.ev} OOP ${oopCk.ev}`);

  // True multi-street implied odds: hero faces an overbet at the root (fold|call);
  // immediate odds say fold a ~37% draw, but villain pays off the turn -> calling +EV.
  const m56t = byId("m56-true-implied-odds");
  const tEvs = actionEVs(buildTree(m56t.state));
  const callEv = tEvs.find((e) => e.action.kind === "call")!.ev;
  const foldEv = tEvs.find((e) => e.action.kind === "fold")!.ev;
  ok("implied odds: hero faces a bet at root (fold|call)",
    tEvs.length === 2 && tEvs.some((e) => e.action.kind === "fold") && tEvs.some((e) => e.action.kind === "call"));
  ok("implied odds: calling is +EV and best", callEv > 0 && foldEv === 0 && bestAction(buildTree(m56t.state)).kind === "call");
  ok("implied odds: immediate price alone says fold (so implied odds matter)",
    equity(hand("8s", "9s"), hand("As", "Ks", "4d"), hand("Ah", "Td")) < 2 / (1 + 2 * 2));
  const m56tFold = gradeDrill(session, m56t.id, { kind: "action", action: { kind: "fold" } }, 0);
  ok("implied odds: folding leaks -> m56.folds_with_implied_odds",
    m56tFold.result.regretBb > 0 && m56tFold.result.leakTag === "m56.folds_with_implied_odds",
    `${m56tFold.result.regretBb} ${m56tFold.result.leakTag}`);
}

// ---------- M0: hand-reading (category) ----------
{
  const m0 = STARTER_DRILLS.find((d) => d.module === "M0")!;
  // hero AcKd on AhKh7c = two pair (category 2).
  ok("M0 grade(): true category is two pair (2)",
    grade(m0.state, { kind: "category", value: 2 }).estimateError === 0);
  ok("M0 grade(): error is distance from the true category",
    grade(m0.state, { kind: "category", value: 5 }).estimateError === 3); // guessed flush (5)

  const correct = gradeDrill(newSession(STARTER_DRILLS), m0.id, { kind: "category", value: 2 }, 0);
  ok("M0 correct read -> error 0, m0.ok",
    correct.result.estimateError === 0 && correct.result.leakTag === "m0.ok", correct.result.leakTag);
  const misread = gradeDrill(newSession(STARTER_DRILLS), m0.id, { kind: "category", value: 0 }, 0);
  ok("M0 misread -> m0.misreads_hand (off by 2)",
    misread.result.estimateError === 2 && misread.result.leakTag === "m0.misreads_hand",
    `${misread.result.estimateError} ${misread.result.leakTag}`);
  ok("M0 carries no truth/regret (not an equity/EV drill)",
    correct.truth === undefined && correct.result.regretBb === 0);
}

// ---------- P6: EV calibration / leak-trend report ----------
{
  ok("leakReport empty", (() => {
    const r = leakReport([]); return r.n === 0 && r.totalRegret === 0 && r.meanRegret === 0 && r.leaks.length === 0;
  })());

  const r = leakReport([
    { leakTag: "m3.folds_when_priced_in", regretBb: 0.5 },
    { leakTag: "m3.folds_when_priced_in", regretBb: 0.5 },
    { leakTag: "p2.misses_thin_value", regretBb: 0.3 },
    { leakTag: "p2.ok", regretBb: 0 },             // correct decision -> excluded from leaks
    { leakTag: "m5.overrates_vs_range", regretBb: 0 }, // estimate leak, 0 regret, still listed
  ]);
  ok("leakReport counts all results", r.n === 5);
  ok("leakReport overall regret", approx(r.totalRegret, 1.3) && approx(r.meanRegret, 1.3 / 5));
  ok("leakReport excludes *.ok from the leaks list",
    r.leaks.every((l) => !l.leakTag.endsWith(".ok")) && r.leaks.length === 3);
  // sorted by total regret desc: m3 (1.0) > p2 (0.3) > m5 (0.0)
  ok("leakReport ranks biggest leak first",
    r.leaks[0].leakTag === "m3.folds_when_priced_in" && r.leaks[0].count === 2 && approx(r.leaks[0].totalRegret, 1.0));
  ok("leakReport mean regret per leak", approx(r.leaks[0].meanRegret, 0.5));
  ok("leakReport keeps zero-regret leaks last",
    r.leaks[1].leakTag === "p2.misses_thin_value" && r.leaks[2].leakTag === "m5.overrates_vs_range");
}

// ---------- Range narrowing: per-combo villain policy ----------
{
  // Villain calls only with aces, folds everything else -> a call means his range
  // is just the aces (the showdown narrows accordingly).
  const policy: RangePolicy = (combo) => {
    const hasAce = rankOf(combo[0]) === 14 || rankOf(combo[1]) === 14;
    return [{ action: { kind: "fold" }, weight: hasAce ? 0 : 1 },
            { action: { kind: "call" }, weight: hasAce ? 1 : 0 }];
  };
  const state: State = {
    heroHand: hand("Ks", "Qs"), board: hand("Ah", "7d", "2c", "3s"), pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ac", "Ad"), weight: 1 }, { combo: hand("7h", "5h"), weight: 1 }], policy },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2 },
  };
  const tree = buildTree(state);
  const vill = tree.children!.find((c) => c.action!.kind === "bet")!.node;
  ok("policy villain -> VILL with fold/call", vill.kind === "VILL" && (vill.children ?? []).length === 2);

  const callChild = vill.children!.find((c) => c.action!.kind === "call")!.node;
  ok("call line range NARROWS to the calling combos (aces only)",
    callChild.state.villain.range.length === 1 &&
    (rankOf(callChild.state.villain.range[0].combo[0]) === 14 || rankOf(callChild.state.villain.range[0].combo[1]) === 14));

  const dist = vill.state.villain.strategy!(vill.state, [{ kind: "fold" }, { kind: "call" }]);
  ok("policy aggregates to fold 0.5 / call 0.5",
    approx(dist.find((d) => d.action.kind === "fold")!.weight, 0.5) &&
    approx(dist.find((d) => d.action.kind === "call")!.weight, 0.5));

  // The call-line showdown uses ONLY the calling range (vs aces), not the full range.
  const showdown = callChild; // single street -> call leads straight to the showdown leaf
  ok("call showdown equity = vs the narrowed range (aces), not the full range",
    approx(equityLeaf(showdown.state) ?? -1, equity(hand("Ks", "Qs"), hand("Ah", "7d", "2c", "3s"), hand("Ac", "Ad"))));
}

// ---------- Multi-street range narrowing ----------
{
  // Villain: AA always calls; KK calls the flop but folds the turn; trash folds.
  // So flop-call narrows to {AA, KK}, and turn-call narrows further to {AA}.
  const policy: RangePolicy = (combo, state) => {
    const r0 = rankOf(combo[0]), r1 = rankOf(combo[1]);
    const isAA = r0 === 14 && r1 === 14;
    const isKK = r0 === 13 && r1 === 13;
    const call = isAA || (isKK && state.board.length === 3); // KK continues only on the flop
    return [{ action: { kind: "fold" }, weight: call ? 0 : 1 }, { action: { kind: "call" }, weight: call ? 1 : 0 }];
  };
  const state: State = {
    heroHand: hand("Js", "Ts"), board: hand("9h", "8h", "2c"), pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ac", "Ad"), weight: 1 }, { combo: hand("Kc", "Kd"), weight: 1 },
                       { combo: hand("7s", "5s"), weight: 1 }], policy },
    abstraction: { sizes: [1.0], streets: ["flop", "turn"], players: 2 },
  };
  const tree = buildTree(state);
  const flopBet = tree.children!.find((c) => c.action!.kind === "bet")!.node;       // VILL (flop)
  const flopCall = flopBet.children!.find((c) => c.action!.kind === "call")!.node;  // CHANCE -> turn
  ok("flop-call narrows the range to {AA, KK} (trash folds)", flopCall.state.villain.range.length === 2);

  const turnHero = flopCall.children![0].node;                                       // HERO (turn)
  const turnBet = turnHero.children!.find((c) => c.action!.kind === "bet")!.node;    // VILL (turn)
  const turnCall = turnBet.children!.find((c) => c.action!.kind === "call")!.node;   // showdown
  ok("turn-call narrows further to {AA} (KK folds the turn)",
    turnCall.state.villain.range.length === 1 &&
    rankOf(turnCall.state.villain.range[0].combo[0]) === 14 && rankOf(turnCall.state.villain.range[0].combo[1]) === 14);

  // Checking the turn (villain doesn't act again) shows down vs the flop range {AA, KK}.
  const turnCheck = turnHero.children!.find((c) => c.action!.kind === "check")!.node; // showdown
  ok("turn-check shows down vs the flop-narrowed range (no further narrowing on a check)",
    turnCheck.state.villain.range.length === 2);
}

// ---------- Policy villain that also raises (narrowing + raise chain) ----------
{
  // AA raises, KK calls, trash folds -> the range splits by action: call -> {KK},
  // raise -> {AA}. Hero then faces the raise against {AA}.
  const policy: RangePolicy = (combo) => {
    const r0 = rankOf(combo[0]), r1 = rankOf(combo[1]);
    const isAA = r0 === 14 && r1 === 14;
    const isKK = r0 === 13 && r1 === 13;
    return [{ action: { kind: "fold" }, weight: isAA || isKK ? 0 : 1 },
            { action: { kind: "call" }, weight: isKK ? 1 : 0 },
            { action: { kind: "bet", size: 1 }, weight: isAA ? 1 : 0 }]; // size ignored (matched by kind)
  };
  const state: State = {
    heroHand: hand("Js", "Ts"), board: hand("9h", "8h", "2c", "3s"), pot: 1, toAct: "hero",
    villain: { range: [{ combo: hand("Ac", "Ad"), weight: 1 }, { combo: hand("Kc", "Kd"), weight: 1 },
                       { combo: hand("7s", "5s"), weight: 1 }], policy },
    abstraction: { sizes: [1.0], streets: ["turn"], players: 2, raiseCap: 1 },
  };
  const vill = buildTree(state).children!.find((c) => c.action!.kind === "bet")!.node;
  ok("policy villain can fold/call/raise (3 actions)", (vill.children ?? []).length === 3);

  const callShow = vill.children!.find((c) => c.action!.kind === "call")!.node; // showdown
  ok("call line narrows to the callers {KK}",
    callShow.state.villain.range.length === 1 && rankOf(callShow.state.villain.range[0].combo[0]) === 13);

  const heroFacesRaise = vill.children!.find((c) => c.action!.kind === "bet")!.node; // HERO faces the raise
  ok("hero faces the raise (fold/call)", heroFacesRaise.kind === "HERO" && (heroFacesRaise.children ?? []).length === 2);
  const raiseShow = heroFacesRaise.children!.find((c) => c.action!.kind === "call")!.node; // showdown
  ok("raise line narrows to the raisers {AA}",
    raiseShow.state.villain.range.length === 1 && rankOf(raiseShow.state.villain.range[0].combo[0]) === 14);
}

// ---------- More content drills (variety within modules) ----------
{
  const byId = (id: string): Drill => STARTER_DRILLS.find((d) => d.id === id)!;
  const session = newSession(STARTER_DRILLS);

  // M0: read a straight (category 4).
  const m0s = byId("m0-read-straight");
  ok("M0 straight read correct (cat 4)",
    gradeDrill(session, m0s.id, { kind: "category", value: 4 }, 0).result.estimateError === 0);
  ok("M0 straight misread -> m0.misreads_hand",
    gradeDrill(session, m0s.id, { kind: "category", value: 8 }, 0).result.leakTag === "m0.misreads_hand");

  // M0: the misread-trap drills, each graded at its true category (and a wrong read -> m0.misreads_hand).
  const cat = (id: string, v: number): string =>
    gradeDrill(session, id, { kind: "category", value: v }, 0).result.leakTag;
  ok("M0 board pair -> two pair", cat("m0-counts-board-pair", 2) === "m0.ok");
  ok("M0 board pair misread as one pair", cat("m0-counts-board-pair", 1) === "m0.misreads_hand");
  ok("M0 wheel -> straight", cat("m0-wheel", 4) === "m0.ok");
  ok("M0 wheel misread as high card", cat("m0-wheel", 0) === "m0.misreads_hand");
  ok("M0 board straight -> straight (play the board)", cat("m0-play-the-board-straight", 4) === "m0.ok");
  ok("M0 board straight misread as one pair", cat("m0-play-the-board-straight", 1) === "m0.misreads_hand");
  ok("M0 four-to-a-flush -> one pair", cat("m0-flush-trap", 1) === "m0.ok");
  ok("M0 four-to-a-flush misread as flush", cat("m0-flush-trap", 5) === "m0.misreads_hand");
  ok("M0 made flush (2 hole + 3 board) -> flush", cat("m0-flush-count", 5) === "m0.ok");
  ok("M0 pocket pair + board pair -> full house", cat("m0-fullhouse-pocket-pair", 6) === "m0.ok");
  ok("M0 full house misread as trips", cat("m0-fullhouse-pocket-pair", 3) === "m0.misreads_hand");
  ok("M0 straight flush -> cat 8", cat("m0-straight-flush", 8) === "m0.ok");
  ok("M0 straight flush misread as flush", cat("m0-straight-flush", 5) === "m0.misreads_hand");
  // ladder completion: trips (3), quads (7), high card (0)
  ok("M0 trips -> cat 3", cat("m0-trips", 3) === "m0.ok");
  ok("M0 trips over-read as full house", cat("m0-trips", 6) === "m0.misreads_hand");
  ok("M0 quads -> cat 7", cat("m0-quads", 7) === "m0.ok");
  ok("M0 quads under-read as full house", cat("m0-quads", 6) === "m0.misreads_hand");
  ok("M0 high card -> cat 0", cat("m0-high-card", 0) === "m0.ok");
  ok("M0 high card over-read as a pair", cat("m0-high-card", 1) === "m0.misreads_hand");
  // Nut recognition: hero's ten completes broadway on A-K-Q-J-9 -> the nut straight (4).
  ok("M0 broadway nuts -> straight (cat 4)", cat("m0-nut-broadway", 4) === "m0.ok");
  ok("M0 broadway misread as high card", cat("m0-nut-broadway", 0) === "m0.misreads_hand");
  // "Name the nuts" drills (board-only, ask:"nuts") — graded by distance to the nut
  // category; a wrong read tags m0.misreads_nuts (distinct from misreads_hand).
  const nuts = (id: string, v: number): string =>
    gradeDrill(session, id, { kind: "nuts", value: v }, 0).result.leakTag;
  ok("M0 nuts: flush board -> flush (5)", nuts("m0-nuts-flush", 5) === "m0.ok");
  ok("M0 nuts: flush board misread -> m0.misreads_nuts", nuts("m0-nuts-flush", 3) === "m0.misreads_nuts");
  ok("M0 nuts: connected board -> straight (4)", nuts("m0-nuts-straight", 4) === "m0.ok");
  ok("M0 nuts: paired board -> quads (7)", nuts("m0-nuts-quads", 7) === "m0.ok");

  // every rung of the 0..8 ladder now has a category drill whose true cat is that rung.
  // (only category drills carry a hero hand; nuts drills are board-only, so exclude them.)
  const trueCat = (id: string): number => {
    for (let v = 0; v <= 8; v++) if (cat(id, v) === "m0.ok") return v;
    return -1;
  };
  const isCat = (id: string): boolean => STARTER_DRILLS.find((d) => d.id === id)!.ask === "category";
  const m0cats = new Set(MODULES.find((m) => m.id === "M0")!.drillIds.filter(isCat).map(trueCat));
  ok("M0 covers the full 0..8 category ladder", [0, 1, 2, 3, 4, 5, 6, 7, 8].every((c) => m0cats.has(c)),
    [...m0cats].sort((a, b) => a - b).join(","));

  // M1: open-ended straight draw out-counting (true = 8 outs).
  const m1os = byId("m1-open-ender").state;
  ok("m1 open-ender has 8 outs", outs(m1os.heroHand!, m1os.board, m1os.villain.range[0].combo) === 8);
  const m1g = gradeDrill(session, "m1-open-ender", { kind: "outs", value: 12 }, 0);
  ok("M1 open-ender overcount -> m1.overcounts_outs",
    m1g.result.leakTag === "m1.overcounts_outs", m1g.result.leakTag);

  // M1: the commonly-miscounted spots, graded against the exact out count.
  const trueOuts = (id: string): number => {
    const s = byId(id).state;
    return outs(s.heroHand!, s.board, s.villain.range[0].combo);
  };
  const outsLeakOf = (id: string, v: number): string =>
    gradeDrill(session, id, { kind: "outs", value: v }, 0).result.leakTag;
  ok("M1 gutshot = 4 outs (not 8)", trueOuts("m1-gutshot") === 4);
  ok("M1 gutshot answered 8 -> overcounts_outs", outsLeakOf("m1-gutshot", 8) === "m1.overcounts_outs");
  ok("M1 gutshot answered 4 -> m1.ok", outsLeakOf("m1-gutshot", 4) === "m1.ok");
  ok("M1 two overcards = 6 outs", trueOuts("m1-overcards") === 6);
  ok("M1 overcards answered 6 -> m1.ok", outsLeakOf("m1-overcards", 6) === "m1.ok");
  ok("M1 combo draw = 15 outs (not 17)", trueOuts("m1-combo-draw-outs") === 15);
  ok("M1 combo draw double-counted as 17 -> overcounts_outs", outsLeakOf("m1-combo-draw-outs", 17) === "m1.overcounts_outs");
  ok("M1 combo draw answered 15 -> m1.ok", outsLeakOf("m1-combo-draw-outs", 15) === "m1.ok");
  ok("M1 tainted flush = 8 clean outs (not 9)", trueOuts("m1-tainted-flush-out") === 8);
  ok("M1 tainted flush counted as 9 -> overcounts_outs", outsLeakOf("m1-tainted-flush-out", 9) === "m1.overcounts_outs");
  ok("M1 tainted flush answered 8 -> m1.ok", outsLeakOf("m1-tainted-flush-out", 8) === "m1.ok");

  // M1: the additional coverage drills (second instances + more archetypes).
  ok("M1 gutshot #2 = 4 outs", trueOuts("m1-gutshot-2") === 4);
  ok("M1 gutshot #2 answered 4 -> m1.ok", outsLeakOf("m1-gutshot-2", 4) === "m1.ok");
  ok("M1 flush draw #2 = 9 outs", trueOuts("m1-flush-draw-2") === 9);
  ok("M1 flush draw #2 answered 9 -> m1.ok", outsLeakOf("m1-flush-draw-2", 9) === "m1.ok");
  ok("M1 one overcard = 3 outs", trueOuts("m1-one-overcard") === 3);
  ok("M1 one overcard miscounted as 6 -> overcounts_outs", outsLeakOf("m1-one-overcard", 6) === "m1.overcounts_outs");
  ok("M1 flush + gutshot = 12 outs (not 13)", trueOuts("m1-flush-plus-gutshot") === 12);
  ok("M1 flush + gutshot double-counted as 13 -> overcounts_outs", outsLeakOf("m1-flush-plus-gutshot", 13) === "m1.overcounts_outs");
  ok("M1 flush + gutshot answered 12 -> m1.ok", outsLeakOf("m1-flush-plus-gutshot", 12) === "m1.ok");
  ok("M1 double gutshot = 8 outs", trueOuts("m1-double-gutshot") === 8);
  ok("M1 double gutshot undercounted as 4 -> undercounts_outs", outsLeakOf("m1-double-gutshot", 4) === "m1.undercounts_outs");
  ok("M1 double gutshot answered 8 -> m1.ok", outsLeakOf("m1-double-gutshot", 8) === "m1.ok");

  // M3: fold a weak draw at a bad price; calling is the leak.
  ok("M3 fold (bad price) is correct (regret 0)",
    gradeDrill(session, "m3-bad-odds-fold", { kind: "action", action: { kind: "fold" } }, 0).result.regretBb === 0);
  ok("M3 calling a bad price -> m3.calls_when_overpriced",
    gradeDrill(session, "m3-bad-odds-fold", { kind: "action", action: { kind: "call" } }, 0).result.leakTag === "m3.calls_when_overpriced");

  // P4: strong hand multiway (field equity = base^2).
  const p4g = gradeDrill(session, "p4-strong-multiway", { kind: "estimate", value: 0.99 }, 0);
  ok("P4 strong-multiway overestimate -> p4.overrates_field",
    p4g.result.leakTag === "p4.overrates_field" && (p4g.truth ?? 1) < 0.99, p4g.result.leakTag);

  // M2: a set crushes an overpair (truth is high, ~0.9).
  const setg = gradeDrill(session, "m2-set-vs-overpair", { kind: "estimate", value: 0.5 }, 0);
  ok("M2 set underestimate -> m2.underestimates_equity",
    setg.result.leakTag === "m2.underestimates_equity" && (setg.truth ?? 0) > 0.5, `${setg.result.leakTag} ${setg.truth}`);

  // M3.5: turn semi-bluff (fold equity) -> betting is best; checking gives it up.
  const m35t = byId("m35-turn-semibluff");
  ok("M3.5 turn semi-bluff: best action is bet", bestAction(buildTree(m35t.state)).kind === "bet");
  ok("M3.5 turn semi-bluff: checking -> m35.gives_up_fold_equity",
    gradeDrill(session, m35t.id, { kind: "action", action: { kind: "check" } }, 0).result.leakTag === "m35.gives_up_fold_equity");

  // P2: thin value vs a worse hand that calls -> betting is best.
  const tv2 = byId("p2-thin-value");
  ok("P2 thin value: best action is bet", bestAction(buildTree(tv2.state)).kind === "bet");
  ok("P2 thin value: checking -> p2.misses_thin_value",
    gradeDrill(session, tv2.id, { kind: "action", action: { kind: "check" } }, 0).result.leakTag === "p2.misses_thin_value");

  // M5: bluff-catcher vs a polarized range.
  const m5p = gradeDrill(session, "m5-polarized-range", { kind: "estimate", value: 0.95 }, 0);
  ok("M5 polarized overestimate -> m5.overrates_vs_range",
    m5p.result.leakTag === "m5.overrates_vs_range" && (m5p.truth ?? 1) < 0.95, m5p.result.leakTag);
}

// ---------- M2 (rule of 2 & 4) + M5 (equity vs range) expanded coverage ----------
{
  const s = newSession(STARTER_DRILLS);
  const tru = (x: string): number => truth(STARTER_DRILLS.find((d) => d.id === x)!.state);
  const leak = (x: string, v: number): string =>
    gradeDrill(s, x, { kind: "estimate", value: v }, 0).result.leakTag;

  // M2: exact equities line up with the rule-of-2-and-4 estimates.
  ok("M2 flush draw flop ≈ 0.366", approx(tru("m2-flush-draw-flop"), 0.366, 0.004));
  ok("M2 flush draw turn ≈ 0.205 (x2 not x4)", approx(tru("m2-flush-draw-turn"), 0.205, 0.004));
  ok("M2 gutshot flop ≈ 0.187", approx(tru("m2-gutshot-flop"), 0.187, 0.004));
  ok("M2 overcards flop ≈ 0.256", approx(tru("m2-overcards-flop"), 0.256, 0.004));
  ok("M2 combo draw turn ≈ 0.341", approx(tru("m2-combo-draw-turn"), 0.341, 0.004));
  ok("M2 overestimate -> m2.overestimates_equity", leak("m2-flush-draw-flop", 0.7) === "m2.overestimates_equity");
  ok("M2 underestimate -> m2.underestimates_equity", leak("m2-flush-draw-flop", 0.1) === "m2.underestimates_equity");

  // M5: exact range equities, including that weighting actually moves the number.
  ok("M5 overpair vs draws ≈ 0.429", approx(tru("m5-overpair-vs-draws"), 0.429, 0.004));
  ok("M5 underpair crushed ≈ 0.056", approx(tru("m5-underpair-vs-range"), 0.056, 0.004));
  ok("M5 vs condensed ≈ 0.841", approx(tru("m5-vs-condensed"), 0.841, 0.004));
  ok("M5 weighted (3:1 bluffs) ≈ 0.705 (not 0.498)", approx(tru("m5-weighted-range"), 0.705, 0.004));
  ok("M5 dominated kicker ≈ 0.389", approx(tru("m5-dominated-kicker"), 0.389, 0.004));
  ok("M5 overestimate -> m5.overrates_vs_range", leak("m5-vs-condensed", 0.99) === "m5.overrates_vs_range");
  ok("M5 underestimate -> m5.underrates_vs_range", leak("m5-vs-condensed", 0.5) === "m5.underrates_vs_range");
}

// ---------- M3 (pot odds): the price decides call vs fold ----------
{
  const s = newSession(STARTER_DRILLS);
  const act = (id: string, kind: "call" | "fold"): string =>
    gradeDrill(s, id, { kind: "action", action: { kind } }, 0).result.leakTag;
  // Small bet -> call; the SAME draw vs a big bet -> fold (price flips the decision).
  ok("M3 flush draw, small bet: call is best", act("m3-flush-draw-call", "call") === "m3.ok");
  ok("M3 flush draw, small bet: fold -> folds_when_priced_in", act("m3-flush-draw-call", "fold") === "m3.folds_when_priced_in");
  ok("M3 flush draw, big bet: fold is best", act("m3-flush-draw-fold", "fold") === "m3.ok");
  ok("M3 flush draw, big bet: call -> calls_when_overpriced", act("m3-flush-draw-fold", "call") === "m3.calls_when_overpriced");
  // Small draw folds; big combo draw calls.
  ok("M3 gutshot: call -> calls_when_overpriced", act("m3-gutshot-fold", "call") === "m3.calls_when_overpriced");
  ok("M3 gutshot: fold is best", act("m3-gutshot-fold", "fold") === "m3.ok");
  ok("M3 combo draw: call is best", act("m3-combo-draw-call", "call") === "m3.ok");
  ok("M3 combo draw: fold -> folds_when_priced_in", act("m3-combo-draw-call", "fold") === "m3.folds_when_priced_in");
}

// ---------- Rest of Pillar 1: M3.5 fold equity, M4 sequencing, M5.6 implied odds ----------
{
  const s = newSession(STARTER_DRILLS);
  const st = (id: string): State => STARTER_DRILLS.find((d) => d.id === id)!.state;
  const best = (id: string): string => bestAction(buildTree(st(id))).kind;
  const lk = (id: string, resp: Response): string => gradeDrill(s, id, resp, 0).result.leakTag;
  const bet: Response = { kind: "action", action: { kind: "bet", size: 1 } };
  const check: Response = { kind: "action", action: { kind: "check" } };
  const callR: Response = { kind: "action", action: { kind: "call" } };

  // M3.5: fold equity only pays off when villain actually folds.
  ok("M3.5 semibluff (folds often): best is bet", best("m35-semibluff-flushdraw") === "bet");
  ok("M3.5 no fold equity (sticky): best is check", best("m35-no-fold-equity") === "check");
  ok("M3.5 no fold equity: betting -> bluffs_without_fold_equity",
    lk("m35-no-fold-equity", bet) === "m35.bluffs_without_fold_equity");
  ok("M3.5 OESD semibluff: best is bet", best("m35-oesd-semibluff") === "bet");
  ok("M3.5 OESD semibluff: checking -> gives_up_fold_equity",
    lk("m35-oesd-semibluff", check) === "m35.gives_up_fold_equity");
  ok("M3.5 weak draw, low fold equity: best is check", best("m35-weak-draw-check") === "check");
  ok("M3.5 weak draw: betting -> bluffs_without_fold_equity",
    lk("m35-weak-draw-check", bet) === "m35.bluffs_without_fold_equity");

  // M4: bet strong hands across streets (checking leaves money behind).
  ok("M4 top set: best is bet", best("m4-value-set") === "bet");
  ok("M4 top set: checking -> misses_street_sequence", lk("m4-value-set", check) === "m4.misses_street_sequence");
  ok("M4 overpair on a wet board: best is bet", best("m4-overpair-protection") === "bet");
  // ...and the contrast: way behind vs a station, choose NO streets.
  ok("M4 way behind: best is check", best("m4-way-behind-check") === "check");
  ok("M4 way behind: betting -> bets_when_way_behind", lk("m4-way-behind-check", bet) === "m4.bets_when_way_behind");

  // M5.6: implied odds aren't always there.
  ok("M5.6 reverse-implied draw is near-dead (~0.11)", approx(truth(st("m56-reverse-implied")), 0.107, 0.01));
  ok("M5.6 no implied odds: calling -> chases_without_odds", lk("m56-no-implied-odds", callR) === "m56.chases_without_odds");
  ok("M5.6 reverse implied: calling -> chases_without_odds", lk("m56-reverse-implied", callR) === "m56.chases_without_odds");

  // the villain's tendency drives these answers, so the drill must carry a read.
  ok("strategy drills carry a villain read",
    !!STARTER_DRILLS.find((d) => d.id === "m35-no-fold-equity")!.read &&
    !!STARTER_DRILLS.find((d) => d.id === "m4-value-set")!.read);
}

// ---------- Curriculum: module integrity + progress + streak ----------
{
  // Every drill belongs to exactly one module, and every module drillId exists.
  const allModuleIds = MODULES.flatMap((m) => m.drillIds);
  ok("every drill is covered by exactly one module",
    STARTER_DRILLS.every((d) => allModuleIds.filter((id) => id === d.id).length === 1),
    `drills ${STARTER_DRILLS.length} vs module-listed ${allModuleIds.length}`);
  ok("every module drillId is a real drill",
    allModuleIds.every((id) => STARTER_DRILLS.some((d) => d.id === id)));
  ok("module list covers all drills", allModuleIds.length === STARTER_DRILLS.length);
  ok("every module has preface, 3 objectives, an example",
    MODULES.every((m) => m.preface.length > 0 && m.objectives.length === 3 && m.example.length > 0));
  ok("every module has >=2 well-formed key terms",
    MODULES.every((m) => m.concepts.length >= 2 && m.concepts.every((c) => c.term.length > 0 && c.def.length > 0)));
  ok("primer has sections with non-empty heading + body",
    PRIMER.length >= 5 && PRIMER.every((s) => s.heading.length > 0 && s.body.length > 0 && s.body.every((p) => p.length > 0)));
  // Every drill (both pillars) has a post-answer explanation, and no entry is orphaned.
  ok("every drill has an EXPLAIN entry",
    STARTER_DRILLS.every((d) => (EXPLAIN[d.id] ?? "").length > 0),
    STARTER_DRILLS.filter((d) => !(EXPLAIN[d.id] ?? "").length).map((d) => d.id).join(","));
  ok("no EXPLAIN entry points at a missing drill",
    Object.keys(EXPLAIN).every((id) => STARTER_DRILLS.some((d) => d.id === id)));
  // A Pillar-2 action drill's best line depends on the villain's hidden strategy,
  // so each must carry a read that surfaces that tendency to the player.
  const p2ActionIds = MODULES.filter((m) => m.track === "P2").flatMap((m) => m.drillIds)
    .map((id) => STARTER_DRILLS.find((d) => d.id === id)!).filter((d) => d.ask === "action");
  ok("every Pillar-2 action drill carries a villain read",
    p2ActionIds.every((d) => (d.read ?? "").length > 0),
    p2ActionIds.filter((d) => !(d.read ?? "").length).map((d) => d.id).join(","));
  // ---- Content quality: an action drill must teach a DISTINGUISHABLE choice ----
  // The learner is graded by regret, so the gap between the best action and the
  // runner-up IS the penalty for picking the sensible alternative. If that gap is
  // ~0, the drill grades a coin-flip as a leak and schedules reps for guessing.
  // Two guards, because a sizing drill's lesson is the SIZE, not "bet vs check":
  //   (1) every action drill: best vs runner-up >= 0.05bb
  //   (2) sizing drills (best is a bet, >1 bet size offered): best size vs the
  //       next-best SIZE >= 0.15bb — the size contrast must be decisive.
  // Guard (2) is the one that catches the real failure: p2-bet-big-deny-equity
  // originally left 0.045bb between its two sizes while "which size?" was the
  // entire lesson (re-authored 2026-07-20 to a 15-out combo draw, now 0.182bb).
  const actionDrills = STARTER_DRILLS.filter((d) => d.ask === "action");
  const thinAny: string[] = [], thinSize: string[] = [];
  for (const d of actionDrills) {
    const evs = actionEVs(buildTree(d.state)).sort((a, b) => b.ev - a.ev);
    if (evs.length < 2) continue;
    if (evs[0].ev - evs[1].ev < 0.05) thinAny.push(`${d.id} ${(evs[0].ev - evs[1].ev).toFixed(4)}`);
    const bets = evs.filter((e) => e.action.kind === "bet");
    if (evs[0].action.kind === "bet" && bets.length >= 2 && bets[0].ev - bets[1].ev < 0.15)
      thinSize.push(`${d.id} ${(bets[0].ev - bets[1].ev).toFixed(4)}`);
  }
  ok("every action drill's best beats the runner-up by >= 0.05bb", thinAny.length === 0, thinAny.join(","));
  ok("every sizing drill's best SIZE beats the next size by >= 0.15bb", thinSize.length === 0, thinSize.join(","));

  // Pillar 1 modules all precede Pillar 2 (so P2 unlocks only after P1).
  const lastP1 = MODULES.map((m, i) => (m.track === "P1" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const firstP2 = MODULES.findIndex((m) => m.track === "P2");
  ok("tracks are ordered P1 then P2", firstP2 > lastP1);

  // Progress: fresh session -> first module current, rest locked.
  const s0 = newSession(STARTER_DRILLS);
  ok("fresh: M0 is current", moduleStatus("M0", s0) === "current");
  ok("fresh: M1 is locked", moduleStatus("M1", s0) === "locked");
  ok("fresh: P0 is locked (Pillar 2 gated)", moduleStatus("P0", s0) === "locked");

  // Complete M0's drills -> M0 done, M1 current. (M0 mixes category + board-only
  // nuts drills, so pick a valid response kind per drill.)
  let s = s0;
  for (const id of MODULES.find((m) => m.id === "M0")!.drillIds) {
    const ask = STARTER_DRILLS.find((d) => d.id === id)!.ask;
    const resp: Response = ask === "nuts" ? { kind: "nuts", value: 5 } : { kind: "category", value: 2 };
    s = gradeDrill(s, id, resp, 0).session;
  }
  ok("after M0 drills: M0 done", moduleStatus("M0", s) === "done" && moduleDone(MODULES[0], s));
  ok("after M0 drills: M1 current", moduleStatus("M1", s) === "current");
  ok("after M0 drills: M2 still locked", moduleStatus("M2", s) === "locked");

  // Streak: consecutive days ending today (or yesterday as grace); else 0.
  ok("streak counts consecutive days to today", currentStreak([3, 4, 5], 5) === 3);
  ok("streak allows a one-day grace (yesterday)", currentStreak([3, 4], 5) === 2);
  ok("streak breaks with a gap", currentStreak([1, 2, 5], 5) === 1);
  ok("streak is 0 when stale", currentStreak([1, 2], 10) === 0);
  ok("streak is 0 when empty", currentStreak([], 5) === 0);
}

// silence unused-import noise without weakening the public surface
void [parseCard, card, ABSTRACTION_LIMITS];

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
