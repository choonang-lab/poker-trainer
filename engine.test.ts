// Test suite — every assertion is exact or hand-checkable. Run: node engine.test.ts
import {
  score5, score7, cmpScore, equity, equityVsRange, outs,
  breakEven, callEV, decisionRegret, regret, estimateError, withinBand, brier,
  hand, parseCard, card, FULL_DECK,
  equityLeaf, bestResponseEV, bestAction, truth, buildTree, realizationFactor,
  fieldEquity, validateAbstraction, ABSTRACTION_LIMITS,
  actionEVs, grade,
  resultQuality, newReview, scheduleReview, dueReviews, nextReview,
  STARTER_DRILLS, newSession, nextDrill, gradeDrill, classifyLeak,
} from "./engine.ts";
import type { State, NodeState, Action, TreeNode, Abstraction, Response, Result, Review, Drill } from "./contract.ts";

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
  let s = session0;
  for (const d of STARTER_DRILLS) {
    const resp: Response = d.ask === "estimate"
      ? { kind: "estimate", value: 0.5 }
      : d.state.abstraction.sizes.length === 0
        ? { kind: "action", action: { kind: "call" } }   // pillar-1 call/fold
        : { kind: "action", action: { kind: "check" } }; // pillar-2 (legal at root)
    s = gradeDrill(s, d.id, resp, 0).session;
  }
  ok("nothing due immediately after grading the whole library", nextDrill(s, 0) === null);
  ok("drills come due again at now=1", nextDrill(s, 1) !== null);

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
  ok("P2 overbet -> bets_without_equity", tag("P2", "p2.overbet") === "p2.bets_without_equity");
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

  const overM1 = gradeDrill(session, "m1-flush-draw-outs", { kind: "estimate", value: 0.95 }, 0);
  ok("gradeDrill M1 overestimate -> m1.overcounts_outs",
    overM1.result.leakTag === "m1.overcounts_outs", overM1.result.leakTag);

  const overM5 = gradeDrill(session, "m5-overcards-vs-pairs", { kind: "estimate", value: 0.95 }, 0);
  ok("gradeDrill M5 overestimate -> m5.overrates_vs_range",
    overM5.result.leakTag === "m5.overrates_vs_range", overM5.result.leakTag);

  const foldM3 = gradeDrill(session, "m3-chop-potodds", { kind: "action", action: { kind: "fold" } }, 0);
  ok("gradeDrill M3 fold (priced in) -> m3.folds_when_priced_in",
    foldM3.result.leakTag === "m3.folds_when_priced_in", foldM3.result.leakTag);

  // The new estimate drills have computable, non-null truth (don't throw).
  ok("m1 drill truth is a number", typeof truth(byId("m1-flush-draw-outs").state) === "number");
  ok("m5 drill truth is a number", typeof truth(byId("m5-overcards-vs-pairs").state) === "number");
}

// silence unused-import noise without weakening the public surface
void [parseCard, card, ABSTRACTION_LIMITS];

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
