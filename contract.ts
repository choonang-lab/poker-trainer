// Poker Trainer — Interface Contract
// The shared seam between L1/L2/L4 + L3 (all implemented in engine.ts) and
// L5/L6/L7 above. Types are the agreement; pillar 1 and pillar 2 both speak this
// vocabulary so there is ONE engine, not two. engine.ts implements every
// signature below; contract.conformance.ts proves it at compile time.

// ===========================================================================
// L1 — cards (implemented, tested)
// ===========================================================================
export type Card = number;        // 0..51 = (rank-2)*4 + suit ; rank 2..14, suit 0..3
export type Score = number[];     // comparable: [category, ...tiebreakers], higher better

export declare function card(rank: number, suit: number): Card;
export declare function rankOf(c: Card): number;
export declare function suitOf(c: Card): number;
export declare function score5(cards: Card[]): Score;     // exactly 5 cards
export declare function score7(cards: Card[]): Score;     // best 5 of 7
export declare function cmpScore(a: Score, b: Score): number;  // <0,0,>0
export declare function madeHand(cards: Card[]): Card[];        // the best-scoring 5 of 5-7 cards

// ===========================================================================
// L2 — equity by exact enumeration (implemented, tested)
// ===========================================================================
export type Board = Card[];                       // length 0 | 3 | 4 | 5
export type Combo = [Card, Card];                 // a two-card holding
export type Range = { combo: Combo; weight: number }[];

export declare function equity(hero: Combo, board: Board, villain: Combo): number;        // [0,1]
export declare function equityVsRange(hero: Combo, board: Board, range: Range): number | null;
export declare function outs(hero: Combo, board: Board, villain: Combo): number;          // 1 to come
export declare function drawSuit(hero: Combo, board: Board): number | null;               // suit of a 4-card flush draw, else null
export declare function nutCategory(board: Board): number;                                 // category (0-8) of the best hand this board allows
export declare function comboCount(combo: Combo, known: Board): number;                     // # of 2-card combos of a holding, given removed cards
export declare function minDefenseFreq(pot: number, bet: number): number;                   // pot/(pot+bet): fraction to defend vs a bet
export declare function bluffFrequency(pot: number, bet: number): number;                   // bet/(pot+2*bet): bluff share of a betting range
export declare function icmEquity(stacks: number[], payouts: number[]): number[];           // Malmuth-Harville ICM: expected prize (same units as payouts) per seat
export declare function requiredEquity(stacks: number[], payouts: number[], heroSeat: number, villainSeat: number): number; // ICM-adjusted equity to call an all-in for the effective stack (0.5 = cash-game baseline)
export declare function shoveEV(stack: number, callFreq: number, eqWhenCalled: number): number; // chip-EV (net bb) of shoving the small blind; compare to folding (-0.5)
export declare function rangeVsRange(heroRange: Range, villRange: Range, board: Board): number; // hero range's average equity vs villain range on a board (card-removal aware)
export declare function boardTexture(board: Board): { paired: boolean; suitedness: "rainbow" | "two-tone" | "mono"; connected: boolean; topRank: number }; // pure board classification for range-interaction reads
export declare function semiBluffBreakeven(pot: number, bet: number, equity: number): number; // fold frequency a semi-bluff needs to break even (0 = +EV even if never folded)
export declare function spr(stack: number, pot: number): number; // stack-to-pot ratio: effective stack / pot
export declare function riskOfRuin(winRate: number, stdDev: number, bankroll: number): number; // probability of busting the bankroll (1 if not a winner)
export declare function nutShare(range: Range, villRange: Range, board: Board, threshold?: number): number; // fraction of a range that's a near-lock (equity >= threshold) vs villain's range — measures nut advantage

// ===========================================================================
// L4 — grading primitives (implemented, tested)
// ===========================================================================
export declare function breakEven(pot: number, call: number): number;
export declare function callEV(eq: number, pot: number, call: number): number;
export declare function regret(evByAction: Record<string, number>, chosen: string): number;
export declare function decisionRegret(eq: number, pot: number, call: number, chosen: "call" | "fold"): number;
export declare function estimateError(estimate: number, truth: number): number;
export declare function withinBand(estimate: number, truth: number, band: number): boolean;
export declare function brier(samples: { estimate: number; truth: number }[]): number | null;

// ===========================================================================
// THE UNIFYING TYPES — where pillar 1 and pillar 2 must agree
// ===========================================================================

// Villain is ONE type for both pillars. Pillar 1 reads only `range`.
// Pillar 2 also reads `strategy` (declared, fixed) at each tree node.
export interface Villain {
  range: Range;
  strategy?: NodeStrategy;          // undefined ⇒ pillar-1 mode (no betting model)
  policy?: RangePolicy;             // per-combo play ⇒ the showdown range NARROWS by action
                                    // (e.g. villain calls AA / folds 72 ⇒ a call means AA). v1:
                                    // applied at a villain bet-facing node (fold/call), single street.
}

// How a SPECIFIC villain combo plays at a node. Drives range narrowing: the EV
// weight of an action is Σ combo.weight·policy(combo)→a, and that action's child
// carries only the combos that took it.
export type RangePolicy = (combo: Combo, state: NodeState, legal: Action[]) => { action: Action; weight: number }[];

// Abstraction is set by pillar 2; empty ⇒ pillar-1 mode (pure equity, no tree).
export interface Abstraction {
  sizes: number[];                  // pot-relative bet sizes, e.g. [0.33, 0.75, 1.0]
  streets: ("flop" | "turn" | "river")[];
  players: number;                  // 2 default; >2 uses the aggregated-field model (P4)
  villainLeads?: boolean;           // if set, villain may bet after hero checks (so hero can
                                    // FACE a bet) — enables P0 (IP/OOP) & true implied-odds spots.
                                    // Default off: hero is the sole aggressor (villain only fold/calls).
  heroFacesBet?: number;            // if set, the tree ROOTS at hero facing a villain bet of this
                                    // pot-relative size (fold | call -> remaining streets). Models a
                                    // call/fold where calling realizes future winnings (true implied odds).
  preflopBet?: number;              // if set (board empty), the tree ROOTS at a PREFLOP call/fold facing a
                                    // villain bet of this pot-relative size; calling deals a REPRESENTATIVE
                                    // flop (labelled approximation) and plays the postflop streets. Lets a
                                    // preflop decision be graded by the equity it will actually realize.
  threeBet?: number;                // with preflopBet: hero may also 3-BET to this pot-relative size. Adds
                                    // villain's per-combo preflop response (fold / call / 4-bet) via villain.policy —
                                    // the second actor layer. The 4-bet is a shove to `effStack` (equity leaf).
  effStack?: number;                // 3-bet drills: the effective stack a 4-bet shoves for (all-in equity leaf).
  heroIn?: number;                  // chips hero has ALREADY committed (sunk) before this re-raise decision:
                                    // 0 facing an open (3-bet), hero's open facing a 3-bet (4-bet). Cancels out
                                    // of pots; shifts each branch's hero investment so folding stays EV 0.
  villainRaises?: boolean;          // sugar for raiseCap = 1 (villain may raise hero's bet once).
  raiseCap?: number;                // max raises in a betting sequence (pot-sized, alternating actors).
                                    // 0 = fold/call only; 1 = one raise; 2 = re-raise (3-bet); etc.
  raiseSizes?: number[];            // HERO's raise-size choices, as multipliers on the pot-sized raise
                                    // (1.0 = raise the pot; 0.5 = half-pot raise; 2.0 = over-pot raise).
                                    // Default [1.0] — unchanged. Villain raises stay single pot-sized.
}
export declare const NO_ABSTRACTION: Abstraction; // { sizes: [], streets: [], players: 2 }

// The public decision state (a single drill spot). `truth()` / `buildTree()`
// consume this; abstraction is always present (empty ⇒ pillar 1).
export interface State {
  heroHand?: Combo;                 // a specific holding (single-decision drills)
  heroRange?: Range;                // or a range
  board: Board;
  pot: number;
  toCall?: number;                  // amount hero must call (pillar-1 call/fold drills)
  toAct: "hero" | "villain" | "chance";
  villain: Villain;
  abstraction: Abstraction;
  stacks?: number[];                // ICM drills (T1): chip stacks per seat (no board/villain/tree)
  payouts?: number[];               // ICM drills (T1): prize for each finishing place (fractions of the pool)
  heroSeat?: number;                // ICM drills (T1): which seat in `stacks` is hero (default 0)
  villainSeat?: number;             // T1 risk-premium drills: the seat shoving all-in that hero may call
  effStack?: number;                // T2 push/fold: effective stack in big blinds
  callFreq?: number;                // T2 push/fold: how often the big blind calls a shove (0-1)
  eqWhenCalled?: number;            // T2 push/fold: hero's equity when the shove is called (0-1)
  winRate?: number;                 // M5.10 bankroll: win rate in bb / 100 hands
  stdDev?: number;                  // M5.10 bankroll: standard deviation in bb / 100 hands
  bankroll?: number;                // M5.10 bankroll: bankroll in big blinds
  opponents?: Combo[];              // P4 exact multiway: the specific opponent hands in an all-in
  position?: Position;              // P1.4 opening ranges: hero's seat, for the raise-first-in chart lookup
}
export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB"; // 6-max seats, tightest to widest opening range

// The leaner state carried INSIDE the tree. A node only needs the board/pot/
// villain to evaluate; toAct/abstraction/players are informational and optional.
// (The builder threads `players` here so the showdown leaf can size the field.)
export interface NodeState {
  heroHand?: Combo;
  heroRange?: Range;
  board: Board;
  pot: number;
  villain: Villain;
  players?: number;
  abstraction?: Abstraction;
  toAct?: "hero" | "villain" | "chance";
}

// Grading output — one schema so L5 (scheduling) and L7 (UI) never branch on pillar.
export interface Result {
  regretBb: number;                 // chips/bb left vs best line; 0 = optimal
  estimateError?: number;           // present for estimation drills
  leakTag: string;                  // namespaced, e.g. "p1.mispriced_draw", "p2.oop_overfold"
}

// ===========================================================================
// L3 — the game tree (implemented in engine.ts). Pillar 1 = depth-0 case.
// ===========================================================================
export type Action =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "bet"; size: number };   // size is one of Abstraction.sizes

// Villain's declared, fixed strategy: a distribution over legal actions at a node.
export type NodeStrategy = (state: NodeState, legal: Action[]) => { action: Action; weight: number }[];

// How a TERM node resolves (the reconciliation point the JS reference flagged):
// a leaf carries its resolution + hero's post-decision investment so the pure
// walker can price it without re-deriving the line.
export type Terminal =
  | { type: "showdown"; heroInvested: number }
  | { type: "fold"; folder: "hero" | "villain"; heroInvested: number };

export interface TreeNode {
  state: NodeState;
  kind: "HERO" | "VILL" | "CHANCE" | "TERM";
  terminal?: Terminal;                              // present iff kind === "TERM"
  children?: { action?: Action; node: TreeNode }[];
}

// The leaf evaluator: hero's raw equity at a (possibly incomplete) board.
// `fieldEquity` is the multiway aggregated-field APPROXIMATION (P4), reducing to
// the exact 2-player equity when players <= 2.
export declare function equityLeaf(state: NodeState): number | null;
export declare function fieldEquity(state: NodeState): number | null;
export declare function multiwayEquity(hero: Combo, opponents: Combo[], board: Board): number; // EXACT N-way equity vs specific hands by enumeration (splits ties); no independence approximation
export declare function sidePots(commits: number[]): { amount: number; eligible: number[] }[]; // split per-player commitments into main + side pots (P4.5); exact
export declare function allInEV(hands: Combo[], commits: number[], deadPot: number, board: Board): number; // hero's chip EV in an all-in showdown with side pots (hands[0] = hero)
export declare function sidePotCallEV(state: State): number; // hero's call EV for a 3-way all-in decision (stacks + opponents on an empty abstraction)
export declare function handClass(combo: Combo): string;     // canonical hand class, e.g. "AKs" / "AKo" / "77" (P1.4)
export declare const OPENING_RANGES: Record<Position, ReadonlySet<string>>; // raise-first-in ranges by seat (hand classes)
export declare function openAction(position: Position, combo: Combo): "open" | "fold"; // the chart's verdict for this hand at this seat

// Best-response EV via expectimax (villain fixed). The leaf evaluator IS L2 equity.
//   HERO   node: max over children
//   VILL   node: Σ strategy(a)·EV(child)
//   CHANCE node: mean over dealt cards
//   TERM   node: fold payoff, or showdown via equity()/equityVsRange()
export declare function bestResponseEV(node: TreeNode): number;  // in bb
export declare function bestAction(node: TreeNode): Action;      // argmax at a HERO node

// Tree construction + the authoring-time abstraction budget (cap sizes × streets
// so a drill can never build an intractable tree at runtime).
export declare const ABSTRACTION_LIMITS: { maxSizes: number; maxStreets: number; maxSizeStreetProduct: number };
export declare function validateAbstraction(abstraction: Abstraction, board?: Board): boolean;
export declare function buildTree(state: State): TreeNode;
export declare function representativeFlops(): Board[]; // deterministic stride subsample of C(52,3) flops behind a preflop decision (labelled approximation)

// The single ground-truth entry point. UI/grading call ONLY this; it routes:
//   empty abstraction → fieldEquity()   (pillar 1; heads-up equity or multiway field approx)
//   otherwise         → bestResponseEV() (pillar 2)
// Throws on a malformed spot (no villain combo possible) so the failure surfaces
// at its cause, not as a null deep in grading. The low-level leaves below stay
// nullable (number | null) — null there means "no data" for a math primitive.
export declare function truth(state: State): number;

// Equity realization, derived (not hardcoded): tree-EV / raw all-in equity.
// Throws when the ratio is undefined (no villain combo, or raw all-in equity 0).
export declare function realizationFactor(state: State): number;

// ===========================================================================
// GRADING — turn a user's response into a Result (consumed by L5/L6/L7)
// ===========================================================================
export type Response =
  | { kind: "estimate"; value: number }        // an equity estimate in [0,1]
  | { kind: "action"; action: Action }         // a chosen action
  | { kind: "category"; value: number }        // a made-hand category guess (0=high..8=straight flush), M0
  | { kind: "outs"; value: number }            // a count of outs (cards that improve to the best hand), M1
  | { kind: "nuts"; value: number }            // the category (0-8) of the best hand the board allows, M0
  | { kind: "combos"; value: number }          // # of combinations of a holding (given card removal), M4.5
  | { kind: "mdf"; value: number }             // minimum defense frequency (0-1) from pot/bet, M5.7
  | { kind: "bluffs"; value: number }          // optimal bluff fraction of a betting range (0-1), M5.7
  | { kind: "icm"; value: number }             // hero's tournament $-equity as a share (0-1) of the prize pool, T1
  | { kind: "callequity"; value: number }      // ICM-adjusted equity (0-1) needed to CALL an all-in, T1 risk premium
  | { kind: "shove"; action: "shove" | "fold" }  // a short-stack push/fold decision, T2
  | { kind: "rangeadv"; value: number }          // hero's whole-range equity (0-1) vs villain's range, M5.8
  | { kind: "semibluff"; value: number }         // fold frequency (0-1) a semi-bluff needs to break even, M5.7
  | { kind: "spr"; value: number }               // stack-to-pot ratio (a plain number), M5.9
  | { kind: "ror"; value: number }               // risk of ruin (0-1) from win rate, std dev, bankroll, M5.10
  | { kind: "overbet"; action: "overbet" | "small" } // whether to overbet, from nut advantage, M5.8
  | { kind: "multiway"; value: number }          // hero's EXACT equity (0-1) vs specific opponents in an all-in, P4
  | { kind: "open"; action: "open" | "fold" };   // raise-first-in decision vs a positional opening chart, P1.4

// Per-action EVs at a HERO node — the source bestAction argmaxes and grade()
// computes regret from.
export declare function actionEVs(heroNode: TreeNode): { action: Action; ev: number }[];

// Grade a response against ground truth. Estimates → estimateError (regretBb 0);
// actions → regretBb (best EV − chosen EV). leakTag is a namespaced, structural
// classification meant to be refined by L6 content. Throws on an illegal action
// or a malformed spot (same degeneracy guard as truth()).
export declare function grade(state: State, response: Response): Result;

// ===========================================================================
// L5 — scheduling: spaced repetition over Result (pure, deterministic)
// ===========================================================================
// SM-2 over a continuous grade. `now` is an injected day-number (never
// Date.now()) so schedules are exactly reproducible. Consumes ONLY Result.
export interface Review {
  id: string;
  ease: number;          // SM-2 ease factor (>= 1.3)
  reps: number;          // consecutive successful reviews
  intervalDays: number;
  lapses: number;
  due: number;           // day-number, same unit as the injected `now`
}
export declare function resultQuality(result: Result): number;   // 0..5
export declare function newReview(id: string, now?: number): Review;
export declare function scheduleReview(item: Review, result: Result, now: number): Review;
export declare function dueReviews(items: Review[], now: number): Review[];
export declare function nextReview(items: Review[], now: number): Review | null;

// ===========================================================================
// L6 — content + session: authored drills and the (pure) training loop
// ===========================================================================
// A Drill is an authored spot (a State) + presentation metadata + which response
// the user gives. A Session bundles a drill library with per-drill scheduling
// state. The loop is pure; persistence/IO is L7's concern.
export interface Drill {
  id: string;
  module: string;                   // curriculum tag, e.g. "M2", "M3", "P2"
  title: string;                    // human-facing label
  ask: "estimate" | "action" | "category" | "outs" | "nuts" | "combos" | "mdf" | "bluffs" | "icm" | "callequity" | "shove" | "rangeadv" | "semibluff" | "spr" | "ror" | "overbet" | "multiway" | "open";  // the response kind this drill expects
  read?: string;                    // optional villain read/situational note (the strategy isn't visible from cards alone)
  state: State;
}
export interface Session {
  drills: Drill[];
  reviews: Record<string, Review>;  // scheduling state by drill id
}
export interface GradeOutcome {
  result: Result;
  review: Review;
  session: Session;                 // a NEW session carrying the updated schedule
  truth?: number;                   // equity graded against (present for estimate drills);
                                    // lets callers build a calibration set without re-enumerating
}
export declare function newSession(drills: Drill[]): Session;
export declare function nextDrill(session: Session, now: number): Drill | null;
export declare function gradeStep(drill: Drill, response: Response): { result: Result; truth?: number }; // grade one spot, no scheduling
export declare function gradeDrill(session: Session, drillId: string, response: Response, now: number): GradeOutcome;

// L6.5 play-by-play: a Hand is one hand played decision by decision. Each step is a
// gradeable spot (a Drill); the shown line is authored (on rails for v1), but every
// decision is still graded on its true EV. gradeHand sums the chips leaked and flags
// the worst call.
export interface Hand {
  id: string;
  title: string;
  setup: string;                    // one-line table context, e.g. "6-max · 100bb · you're in the big blind"
  steps: Drill[];                   // ordered decisions; each step's `read` carries the play-by-play narrative
}
export interface HandStepOutcome { index: number; drillId: string; result: Result; truth?: number; }
export interface HandRecap {
  outcomes: HandStepOutcome[];
  totalRegretBb: number;            // total chips leaked across the hand (sum of per-decision regret)
  worst: { index: number; drillId: string; leakTag: string; regretBb: number } | null; // the single biggest leak (null if clean)
}
export declare function gradeHand(hand: Hand, responses: Response[]): HandRecap;
export declare const STARTER_HANDS: Hand[];

// L6.6 BRANCHING play-by-play: a hand that follows the USER'S line. Instead of
// authored on-rails steps, it walks the real buildTree(state): the user's action
// picks the branch, the villain plays its MODAL declared action, and the board is
// the scripted `reveal`. Each decision is graded (by regret) at the node actually
// reached — so a wrong choice leads somewhere, and you're graded there.
export interface BranchHand {
  id: string;
  title: string;
  setup: string;                    // preflop narrative; the flop is state.board
  state: State;                     // flop-start, hero-as-aggressor, villain {range, policy}, streets flop..river
  reveal: Card[];                   // the turn then river card, dealt as the hand advances
}
export interface BranchOutcome {
  narrative: string[];              // the running story: setup, cards dealt, and each actor's action
  decisions: { street: string; result: Result }[]; // the user's graded decisions so far (regret at the node reached)
  pending: { board: Board; heroHand?: Combo; pot: number; legal: Action[] } | null; // the current decision (null if the hand is over)
  done: boolean;                    // true once the hand has reached a terminal
}
// Replay the walk for the user's `actions` so far (pure): resolve villain/chance
// nodes automatically, grade each hero decision, and return the pending decision or
// the final recap. The UI calls this with the growing action list.
export declare function branchHand(hand: BranchHand, actions: Action[]): BranchOutcome;
export declare const STARTER_BRANCH_HANDS: BranchHand[];
// Deal an endless supply of GENERATED branching hands, one per seed — pure and
// deterministic (same seed → same hand), so it's reproducible and exact-test-safe.
export declare function dealBranchHand(seed: number): BranchHand;

// Module-aware leak classification. grade() emits structural pillar tags (it has
// no module context); gradeDrill refines them into named, curriculum-specific
// leaks via this, falling back to a module-scoped structural tag when unmapped.
export declare function classifyLeak(drill: Drill, result: Result): string;

// Persistence (pure; IO is the caller's job). Only the plain `reviews` data is
// serialized — drills carry `strategy` functions and are supplied in-code.
// loadSession rehydrates reviews against the given library (unknown ids dropped;
// missing/malformed json → a fresh session).
export declare function serializeSession(session: Session): string;
export declare function loadSession(drills: Drill[], json?: string | null): Session;

// M6 — calibration: are your estimates well-calibrated across many samples?
// (When you say 30%, do you win ~30%?) Aggregates {estimate, truth} pairs into a
// Brier score (reuses brier()) plus per-bucket reliability. A cross-cutting
// report over estimate drills, not a single drill.
export interface CalibrationBucket {
  lo: number;            // estimate-range [lo, hi)
  hi: number;
  count: number;
  meanEstimate: number;  // average predicted equity in this bucket
  meanTruth: number;     // average true equity observed
  gap: number;           // meanEstimate - meanTruth (>0 overconfident, <0 under)
}
export interface CalibrationReport {
  n: number;
  brier: number | null;          // mean squared (estimate - truth); null if no samples
  buckets: CalibrationBucket[];   // only non-empty buckets, ascending
}
export declare function calibration(
  samples: { estimate: number; truth: number }[], bins?: number,
): CalibrationReport;

// P6 — EV calibration: the decision analogue of M6. Aggregates graded results
// (leakTag + regretBb) into recurring leaks ranked by total regret, so a user
// sees which mistakes cost the most. Pure; the caller supplies the history.
export interface LeakStat {
  leakTag: string;
  count: number;
  totalRegret: number;   // summed regretBb across occurrences
  meanRegret: number;
}
export interface LeakReport {
  n: number;             // total graded results fed in
  totalRegret: number;
  meanRegret: number;    // average regret per result
  leaks: LeakStat[];      // non-"*.ok" tags, sorted by totalRegret desc then count desc
}
export declare function leakReport(entries: { leakTag: string; regretBb: number }[]): LeakReport;

// ===========================================================================
// Curriculum — the guided "learn" path layered over the L6 drills (consumed by
// the web UI). A Module groups drills with a preface, objectives, and a worked
// example; modules unlock in order. Pure helpers derive progress from the Session.
// ===========================================================================
export interface Concept { term: string; def: string; }  // a key-term definition
export interface Module {
  id: string;                 // e.g. "M1"
  track: "P1" | "P2";         // Pillar 1 (estimate) | Pillar 2 (decide)
  title: string;
  preface: string;            // why it matters
  concepts: Concept[];        // key terms this module's lessons use
  objectives: string[];       // what you'll be able to do
  example: string;            // a worked example
  drillIds: string[];         // the module's drills, in teaching order
}
export declare const MODULES: Module[];
export declare function moduleDone(module: Module, session: Session): boolean;
export declare function moduleStatus(moduleId: string, session: Session): "done" | "current" | "locked";
export declare function currentStreak(activeDays: number[], today: number): number;

// A beginner orientation shown before any module (the "Start here" primer). Pure
// data — drill-free reading, surfaced by the web UI from a pinned map card.
export interface PrimerSection { heading: string; body: string[]; }  // body = paragraphs
export declare const PRIMER: PrimerSection[];

// Post-answer explanations keyed by drill id (the "why", shown after grading).
export declare const EXPLAIN: Record<string, string>;

// ===========================================================================
// Build status
//   L1, L2, L4   implemented in engine.ts, exact tests + AA/KK benchmark passing
//   L3           expectimax + multi-street builder + multiway field approx + budget
//   truth()      router: empty-abstraction path is tree-independent (pillar 1 lives)
//   L5/L6/L7     scheduling, content, UI — consume Result + truth(); not started
// ===========================================================================
