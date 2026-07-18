// Curriculum — the guided "learn" path over the L6 drills. Pure data + helpers;
// the web UI consumes it. Modules unlock in array order (Pillar 1 then Pillar 2);
// progress is derived from the Session's reviews (a drill is "seen" once graded).
import type { Module, PrimerSection, Session } from "./contract.ts";

// A beginner orientation shown before any module, surfaced from a pinned "Start
// here" card on the Learn map. Drill-free reading; teaches the shared vocabulary
// (pot, board, streets, equity, blinds) the modules assume.
export const PRIMER: PrimerSection[] = [
  {
    heading: "What you're trying to do",
    body: [
      "Poker is a betting game, not a card-collecting game. You win the chips in the middle — sometimes by holding the best hand, sometimes by betting so confidently that everyone else folds.",
      "Good poker isn't about playing every hand well; it's about making decisions that win chips on average over thousands of hands. That one skill is what this trainer builds.",
    ],
  },
  {
    heading: "A hand of Texas Hold'em, start to finish",
    body: [
      "You're dealt two private cards — your hole cards. Then five shared cards, the board, are revealed in stages: the flop (3 at once), the turn (1 more), and the river (1 last card).",
      "Each stage is called a street, and after each one there's a round of betting. You make your best five-card hand from any mix of your two cards and the five on the board. If two or more players remain after the river, they show down and the best hand wins.",
    ],
  },
  {
    heading: "The chips: pot and betting",
    body: [
      "The pot is the pile of chips in the middle — what everyone's fighting over. On your turn you can check (do nothing, when no one has bet — it's free), bet (put chips in), call (match a bet to stay in), raise (put in more), or fold (give up the hand, losing nothing further).",
      "The blinds. Before any cards are dealt, two players post forced bets so there's always something to play for. A rotating marker, the dealer button, marks who deals; the player to its left posts the small blind and the next player posts the big blind — usually double the small blind (a \"$1/$2 game\" = a $1 and a $2 blind). The big blind also sets the minimum bet for the first round. The button moves one seat each hand, so everyone pays the blinds in turn.",
    ],
  },
  {
    heading: "Hand rankings (weakest → strongest)",
    body: [
      "Every hand is five cards. Higher number = stronger — and this is exactly the 0–8 scale you'll use in the first module:",
      "0 · High card — none of the below; your top card plays",
      "1 · One pair — two of the same rank (J J x x x)",
      "2 · Two pair — two pairs (A A 9 9 x)",
      "3 · Three of a kind — three of a rank (\"trips\" or \"a set\")",
      "4 · Straight — five in a row, mixed suits (8 9 10 J Q)",
      "5 · Flush — five of one suit, any order (A♦ J♦ 8♦ 5♦ 2♦)",
      "6 · Full house — three of a rank + a pair (K K K 7 7)",
      "7 · Four of a kind — all four of a rank (\"quads\")",
      "8 · Straight flush — five in a row, all one suit (5♥ 6♥ 7♥ 8♥ 9♥)",
    ],
  },
  {
    heading: "Equity — the one number behind everything",
    body: [
      "Equity is your share of the pot right now: the percentage of the time your hand would win if every remaining card were dealt out. If you'd win 6 times out of 10, you have 60% equity.",
      "Almost everything comes back to this number — half the trainer (Pillar 1) is about estimating your equity quickly, and the other half (Pillar 2) is about using it to bet, call, or fold well.",
    ],
  },
  {
    heading: "Three words you'll meet soon",
    body: [
      "You'll see these constantly. Here's just enough to recognize them — each gets its own module, so don't worry about mastering them yet:",
      "Outs — the cards still to come that would improve you to the winning hand.",
      "Pot odds — the price you're offered: what you must call versus what you can win.",
      "Position — whether you act last in the betting. Acting last is a real edge, because you've already seen what everyone else did.",
    ],
  },
  {
    heading: "How this trainer works",
    body: [
      "The Learn tab unlocks modules in order — finish one to open the next. Each module starts with a short theory page like this one, then a few quick lessons.",
      "The Review tab brings past lessons back on a spaced schedule so they actually stick, and a daily streak keeps you moving. You'll go all the way from reading a board to making winning bets.",
    ],
  },
];

export const MODULES: Module[] = [
  // ---- Pillar 1 · estimate ----
  {
    id: "M0", track: "P1", title: "Hand reading",
    preface: "Before you can judge equity you have to read the board: what is your made hand right now, and what beats it? Fast, accurate hand-reading is the foundation everything else builds on.",
    concepts: [
      { term: "Made hand", def: "the best five-card hand you actually have right now." },
      { term: "Board", def: "the shared face-up cards everyone can use." },
      { term: "Category", def: "which rung of the rankings your hand is (pair, two pair, …)." },
      { term: "Pocket pair", def: "two cards of the same rank dealt to you (e.g. 9♠ 9♦)." },
      { term: "Top pair", def: "pairing the highest card on the board with one of your cards." },
      { term: "Overpair", def: "a pocket pair higher than every card on the board." },
      { term: "Kicker", def: "the unpaired side card that breaks ties (A-K beats A-Q with a pair of aces because the King out-kicks the Queen)." },
      { term: "Nuts", def: "the best possible hand on a given board." },
    ],
    objectives: ["Name your made hand's category at a glance", "Spot the nut hands a board allows", "Avoid misreading straights, flushes, and full houses"],
    example: "On A♠ K♥ 7♣ holding A♦ K♦ you have two pair (aces and kings) — not just 'top pair'.",
    drillIds: [
      "m0-read-two-pair", "m0-counts-board-pair", "m0-trips", "m0-read-straight", "m0-wheel",
      "m0-play-the-board-straight", "m0-high-card", "m0-flush-trap", "m0-flush-count",
      "m0-fullhouse-pocket-pair", "m0-quads", "m0-straight-flush", "m0-nut-broadway",
      "m0-nuts-flush", "m0-nuts-straight", "m0-nuts-quads",
    ],
  },
  {
    id: "M1", track: "P1", title: "Counting outs",
    preface: "After the flop you usually have a draw, not the best hand. Your outs are the cards that complete it — counting them is the first step to equity.",
    concepts: [
      { term: "Draw", def: "a hand that isn't best yet but could improve (e.g. four to a flush)." },
      { term: "Outs", def: "the cards still to come that would make you the winner." },
      { term: "Flush draw", def: "four of one suit, needing a fifth (9 outs)." },
      { term: "Straight draw", def: "open-ended (8 outs, either end completes) vs. gutshot (4 outs, one rank)." },
      { term: "Overcards", def: "hole cards higher than every board card; pairing one can give top pair (~6 outs)." },
      { term: "Backdoor draw", def: "a draw needing both the turn and river to complete (weak — worth ~1.5 outs)." },
      { term: "Discounting outs", def: "subtracting any 'out' that would also hand your opponent a better hand; it isn't really an out." },
    ],
    objectives: ["Count cards that improve you to the best hand", "Recognize draw types: flush 9, open-ender 8, gutshot 4", "Subtract outs that complete a better hand"],
    example: "A flush draw has 9 outs — 13 cards of the suit minus the 4 you can see.",
    drillIds: [
      "m1-flush-draw-outs", "m1-gutshot", "m1-open-ender", "m1-one-overcard",
      "m1-overcards", "m1-flush-draw-2", "m1-gutshot-2", "m1-double-gutshot",
      "m1-flush-plus-gutshot", "m1-combo-draw-outs", "m1-tainted-flush-out",
    ],
  },
  {
    id: "M2", track: "P1", title: "Rule of 2 and 4",
    preface: "Turn outs into equity with the rule of 2 and 4: multiply outs by 4 with two cards to come, by 2 with one. It's an estimate — big draws need a small correction down.",
    concepts: [
      { term: "Rule of 2 and 4", def: "fast equity estimate: outs × 4 with two cards to come, × 2 with one." },
      { term: "Two cards to come", def: "on the flop with turn and river still to be dealt → use ×4." },
      { term: "One card to come", def: "only the river left → use ×2." },
      { term: "Equity", def: "your % chance to win the pot (from the primer)." },
      { term: "The big-draw correction", def: "with many outs (≈9+), ×4 overshoots a little; shade it down a couple percent." },
      { term: "Combo draw", def: "two draws at once (e.g. flush + straight draw), giving lots of outs." },
    ],
    objectives: ["Convert outs to equity with ×2 and ×4", "Apply the correction when you have many outs", "Estimate combo-draw and made-hand equity"],
    example: "9 outs × 4 ≈ 36% by the flop; the exact figure is about 35%.",
    drillIds: [
      "m2-flush-draw-flop", "m2-gutshot-flop", "m2-overcards-flop", "m2-combo-draw",
      "m2-kqo-vs-aa", "m2-flush-draw-turn", "m2-combo-draw-turn", "m2-set-vs-overpair",
    ],
  },
  {
    id: "M3", track: "P1", title: "Pot odds",
    preface: "A draw is only worth chasing if the price is right. Pot odds compare what you must call to what you stand to win.",
    concepts: [
      { term: "Pot odds", def: "the price you're offered: what you must call vs. the total you'd win." },
      { term: "Pot odds as a ratio", def: "e.g. call 1 to win 3 = '3-to-1'; turn it into a % with call ÷ (pot + call)." },
      { term: "Break-even %", def: "the equity a call needs to be profitable = call ÷ (pot + call)." },
      { term: "+EV / −EV", def: "a decision that wins chips on average (+EV) or loses them (−EV); calling above break-even is +EV." },
    ],
    objectives: ["Compute the break-even percentage", "Call when equity is at or above break-even", "Fold when the price is wrong"],
    example: "Calling 1 to win a pot of 2 needs 1 / 3 ≈ 33% equity.",
    drillIds: [
      "m3-chop-potodds", "m3-flush-draw-call", "m3-flush-draw-fold",
      "m3-gutshot-fold", "m3-combo-draw-call", "m3-bad-odds-fold",
    ],
  },
  {
    id: "M3.5", track: "P1", title: "Fold equity",
    preface: "Betting can win two ways: your opponent folds, or you make the best hand. That extra 'fold equity' often makes a semi-bluff better than checking.",
    concepts: [
      { term: "Bluff", def: "betting a weak hand hoping a better hand folds." },
      { term: "Fold equity", def: "the extra value a bet earns from the chance your opponent folds." },
      { term: "Semi-bluff", def: "betting a draw: you win now if they fold, or later if you hit." },
      { term: "Equity when called", def: "the other half of a bet's value: actually winning the pot when they don't fold." },
    ],
    objectives: ["See how folds add value to a bet", "Combine fold equity with a draw's equity", "Pick spots where betting beats checking"],
    example: "Betting a flush draw wins now when they fold, and later when you hit.",
    drillIds: [
      "m35-semibluff-flushdraw", "m35-no-fold-equity", "m35-oesd-semibluff",
      "m35-weak-draw-check", "m35-turn-semibluff", "p2-bet-or-check",
    ],
  },
  {
    id: "M4", track: "P1", title: "Street sequencing",
    preface: "Hands play out over several streets. Planning the line — which streets to bet — extracts more than deciding one street at a time.",
    concepts: [
      { term: "Line", def: "your plan for the whole hand: which streets you bet, check, or raise." },
      { term: "Value bet", def: "a bet you want called, made when worse hands will pay you off." },
      { term: "Building the pot", def: "betting across streets with a strong hand to win more." },
      { term: "Checking back", def: "declining to bet when you could, taking a free card or a cheap showdown." },
      { term: "Leaving money behind", def: "checking a strong hand and winning less than you could have." },
    ],
    objectives: ["Plan a multi-street betting line", "Bet strong hands across streets for value", "Avoid leaving money behind by checking"],
    example: "With the nuts, betting flop and turn builds a far bigger pot than a single bet.",
    drillIds: ["m4-sequence-two-streets", "m4-value-set", "m4-overpair-protection", "m4-way-behind-check"],
  },
  {
    id: "M5", track: "P1", title: "Equity vs range",
    preface: "Opponents hold ranges, not single hands. Your real equity is the average against every hand they could have, weighted by how likely each is.",
    concepts: [
      { term: "Range", def: "all the hands an opponent could hold here, not just one." },
      { term: "Equity vs a range", def: "your average equity against every hand in that range, weighted by how likely each is." },
      { term: "Combos", def: "the number of card combinations a holding has (an unpaired hand = 16, a pocket pair = 6); heavier parts of a range count for more." },
      { term: "Polarized range", def: "either very strong (nuts) or nothing (air), little in between." },
      { term: "Condensed range", def: "the opposite: mostly medium hands, few nuts and little air." },
      { term: "Bluff-catcher", def: "a medium hand that only beats bluffs; its worth depends entirely on how polarized the opponent is." },
    ],
    objectives: ["Estimate equity against a range, not one hand", "Weight wide ranges correctly", "Read your equity vs a polarized (nuts-or-air) range"],
    example: "AK-high is about 40% vs a set but 85% vs an underpair — average over the whole range.",
    drillIds: [
      "m5-overcards-vs-pairs", "m5-overpair-vs-draws", "m5-vs-condensed", "m5-wide-range",
      "m5-dominated-kicker", "m5-polarized-range", "m5-weighted-range", "m5-underpair-vs-range",
    ],
  },
  {
    id: "M5.6", track: "P1", title: "Implied odds",
    preface: "Sometimes a call that's wrong on immediate pot odds is right because of what you'll win later when the draw hits. That's implied odds.",
    concepts: [
      { term: "Implied odds", def: "future chips you expect to win after hitting your draw, on top of the current pot." },
      { term: "Effective odds", def: "pot odds adjusted for those future bets; can make a 'wrong' call right." },
      { term: "Stack depth", def: "how many chips are left to bet; deeper stacks mean bigger implied odds." },
      { term: "Reverse implied odds", def: "when the future winnings aren't really there (you hit but still lose, or won't get paid)." },
    ],
    objectives: ["Add expected future winnings to the price", "Call draws that immediate odds reject", "Recognize when implied odds aren't really there"],
    example: "Calling a big bet with a flush draw can be +EV if you get paid off when it comes in.",
    drillIds: [
      "m56-implied-odds-flushdraw", "m56-true-implied-odds",
      "m56-no-implied-odds", "m56-reverse-implied",
    ],
  },
  // ---- Pillar 2 · decide ----
  {
    id: "P0", track: "P2", title: "Position and realization",
    preface: "Acting last is an edge — you see your opponent first. Out of position you realize less of your equity, so play tighter and bluff less.",
    concepts: [
      { term: "Position", def: "whether you act last on a street; acting last is an advantage." },
      { term: "In position (IP) / Out of position (OOP)", def: "IP = you act after your opponent; OOP = before." },
      { term: "The button", def: "the latest seat, acts last postflop — the best position at the table." },
      { term: "Equity realization", def: "how much of your raw equity you actually turn into winnings; you realize more in position." },
      { term: "Initiative", def: "being the last aggressor (the bettor/raiser), which lets you keep applying pressure." },
      { term: "Check-fold", def: "checking, then folding to a bet — the cheapest way to give up." },
    ],
    objectives: ["Understand why position realizes more equity", "Check-fold weak hands out of position", "Take a free card in position to realize a draw"],
    example: "Out of position with no equity, check-fold (lose nothing) beats bluffing into a caller.",
    drillIds: ["p0-oop-no-equity", "p0-ip-realize-equity"],
  },
  {
    id: "P1", track: "P2", title: "Preflop ranges",
    preface: "Every hand starts preflop. Knowing roughly how holdings run — favorites, races, dominations — anchors your whole game.",
    concepts: [
      { term: "Preflop", def: "the betting before any board cards appear." },
      { term: "Pocket pair", def: "two cards of the same rank (e.g. 9♠ 9♦)." },
      { term: "Overcards", def: "two cards both higher than the opponent's pair." },
      { term: "Favorite / underdog", def: "the hand more / less likely to win." },
      { term: "Coinflip (\"race\")", def: "a near 50/50, classically a pair vs. two overcards." },
      { term: "Domination", def: "sharing a card but out-kicking the other hand (A-K over A-Q)." },
    ],
    objectives: ["Estimate preflop equity between holdings", "Recognize coinflips and big favorites", "Value pocket pairs vs overcards"],
    example: "AA vs KK is about 82%; AK vs QQ is a near coinflip (~46%).",
    drillIds: ["p1-aa-vs-kk-preflop", "p1-akx-vs-qq-race", "p1-ak-vs-aq"],
  },
  {
    id: "P2", track: "P2", title: "Bet sizing",
    preface: "How much you bet matters as much as whether you bet. Size up with strong hands for value; don't bet into ranges that continue only when they beat you.",
    concepts: [
      { term: "Bet size", def: "how much you bet, usually as a fraction of the pot." },
      { term: "Pot-sized / half-pot bet", def: "common reference sizes; bigger bets pressure more and win more when called." },
      { term: "Sizing up", def: "betting bigger with very strong hands to win more." },
      { term: "Thin value", def: "a small value bet that only slightly-worse hands will call." },
      { term: "Overbet", def: "betting more than the pot, usually with a polarized range (nuts or bluffs)." },
    ],
    objectives: ["Choose a bet size for the spot", "Size up with the nuts for value", "Bet thin only when worse hands call"],
    example: "With the nuts and a caller, a pot-size bet earns more than a half-pot bet.",
    drillIds: ["p2-size-up-nuts", "p2-thin-value"],
  },
  {
    id: "P3", track: "P2", title: "Multi-street lines",
    preface: "Big pots are built (or lost) over several streets and raises. Plan the whole line — and don't just flat when raising for value is better.",
    concepts: [
      { term: "Flat vs. raise", def: "flatting = just calling; raising puts in more to build the pot or apply pressure." },
      { term: "3-bet", def: "a re-raise (raising someone's raise)." },
      { term: "Barreling", def: "continuing to bet on later streets (a 'second barrel' on the turn, 'third' on the river)." },
      { term: "Multi-street value", def: "betting for value on more than one street to win a bigger pot." },
    ],
    objectives: ["Value-bet across multiple streets", "Re-raise (3-bet) the nuts instead of flatting", "Think one street ahead"],
    example: "Facing a bet with the nuts, raising extracts more than calling and showing down.",
    drillIds: ["p3-value-two-streets", "p3-3bet-the-nuts"],
  },
  {
    id: "P4", track: "P2", title: "Multiway pots",
    preface: "Pots with three or more players are different: to win you must beat everyone, so hands need to be stronger. (The field is modeled as an approximation.)",
    concepts: [
      { term: "Heads-up", def: "a pot with just two players." },
      { term: "Multiway", def: "a pot with three or more players; to win you must beat everyone." },
      { term: "The field", def: "your opponents as a group." },
      { term: "Equity dilution", def: "each extra opponent lowers everyone's equity, since someone is likelier to have hit — so hands need to be stronger." },
    ],
    objectives: ["Adjust equity down against multiple opponents", "Value strong hands vs a field", "Avoid overrating marginal hands multiway"],
    example: "A hand that's 50% heads-up is only about 25% against two opponents.",
    drillIds: ["p4-multiway-field", "p4-strong-multiway"],
  },
  {
    id: "P5", track: "P2", title: "Exploit vs balance",
    preface: "The biggest profits come from exploiting how your specific opponent deviates — over-folding, calling too wide, raising only monsters. Read the leak, then attack it.",
    concepts: [
      { term: "Exploit", def: "adjusting to a specific opponent's mistake to win more." },
      { term: "Balance / GTO", def: "a 'game-theory-optimal' baseline that can't be exploited; you deviate from it to exploit." },
      { term: "Over-folder", def: "folds too often → bluff them more." },
      { term: "Station", def: "calls too much → value-bet bigger, bluff less." },
      { term: "Nit", def: "very tight, only plays premiums → don't pay them off." },
      { term: "Maniac", def: "over-aggressive, bets/raises too much → call and trap wider." },
    ],
    objectives: ["Bluff more vs players who over-fold", "Value-bet bigger vs stations and raisers", "Don't bet thin into a strong, narrow range"],
    example: "If a villain raises only hands that beat you, betting just gets you raised off your equity.",
    drillIds: ["p5-exploit-overfolder", "p5-value-vs-raiser", "p5-thin-value-vs-range", "p5-vs-checkraise-range"],
  },
];

// Post-answer explanations, keyed by drill id — the WHY behind each spot, shown
// in the feedback panel after grading (right when the student wants the reason).
// Pure teaching content; covers every Pillar-1 drill.
export const EXPLAIN: Record<string, string> = {
  // M0 — hand reading
  "m0-read-two-pair": "Your ace and king each pair the board: aces and kings — two pair, not just 'top pair'.",
  "m0-counts-board-pair": "The board's pair counts as yours: K-K-8-8-A is two pair even though only one king is in your hand.",
  "m0-trips": "Three nines and no second pair is three of a kind — a full house needs a pair to go with the trips.",
  "m0-read-straight": "Your 10-9 connects with 8-7-6: a ten-high straight.",
  "m0-nut-broadway": "Your ten completes A-K-Q-J-T — a straight. With no pair or flush possible on this board, that's the best hand there is: the nuts. Spotting when you hold the nuts matters as much as reading your own hand.",
  "m0-nuts-flush": "Three spades are on the board and it isn't paired, so the best hand anyone can have is a flush — a set or a straight can't beat it. When three of one suit are out, a flush is the nuts.",
  "m0-nuts-straight": "The board runs J-10-9. Someone holding K-Q makes K-Q-J-10-9, a straight — and with no flush or pair possible, that's the best hand here. Connected boards make straights the nuts.",
  "m0-nuts-quads": "The board is paired (two kings), so whoever holds the other two kings has four of a kind. On any paired board, quads and full houses come into play — here quad kings is the nuts.",
  "m0-wheel": "A-2-3-4-5 is the wheel — the ace plays low. Easy to dismiss as ace-high.",
  "m0-play-the-board-straight": "The board itself is a 5-6-7-8-9 straight — your best five cards ARE the board. The pair of twos is irrelevant.",
  "m0-high-card": "No pair, no straight, no flush — just ace-high. Don't talk yourself into more.",
  "m0-flush-trap": "Only four hearts in total — a flush needs five. Your real hand is a pair of kings.",
  "m0-flush-count": "Your two diamonds plus the board's three make five: a flush, not ace-high.",
  "m0-fullhouse-pocket-pair": "Three sevens plus the board's pair of kings: sevens full of kings, better than trips.",
  "m0-quads": "Your two nines plus the board's two: all four nines — quads.",
  "m0-straight-flush": "6-7-8-9-10 all in hearts: a straight flush, the top of the ladder — more than a flush or a straight alone.",
  // M1 — counting outs
  "m1-flush-draw-outs": "13 spades in the deck minus the 4 you can see = 9 outs.",
  "m1-gutshot": "Only a 6 completes 9-8-7-6-5 — 4 outs. Pairing your 9 or 8 still loses to the aces.",
  "m1-open-ender": "Either end fills it: four 5s and four 10s = 8 outs.",
  "m1-one-overcard": "Only the ace is an overcard to kings — 3 outs. Pairing your 7 doesn't beat them.",
  "m1-overcards": "Three aces plus three kings = 6 outs to out-pair the sevens.",
  "m1-flush-draw-2": "Same rule, new suit: 13 clubs minus the 4 visible = 9 outs.",
  "m1-gutshot-2": "Only a 9 fills Q-J-10-9-8 — 4 outs, not the 8 an open-ender gets.",
  "m1-double-gutshot": "A 5 makes 4-5-6-7-8 AND a 9 makes 6-7-8-9-10: two gutshots = 8 outs — an open-ender in disguise.",
  "m1-flush-plus-gutshot": "9 flush outs + four tens, but the 10♣ is already counted as a flush out: 9 + 3 = 12, not 13.",
  "m1-combo-draw-outs": "9 flush outs + 8 straight outs − 2 counted twice (Q♥ and 7♥ complete both) = 15, not 17.",
  "m1-tainted-flush-out": "The 2♠ makes your flush but pairs the board, filling the set into a full house — 9 − 1 = 8 clean outs.",
  // M2 — rule of 2 and 4
  "m2-flush-draw-flop": "9 outs × 4 ≈ 36% with two cards to come (exact: 36.6%).",
  "m2-gutshot-flop": "4 outs × 4 ≈ 16% (exact: 18.7%). Small draws stay small.",
  "m2-overcards-flop": "6 outs × 4 ≈ 24% (exact: 25.6%).",
  "m2-combo-draw": "~15 outs: naive ×4 says 60%, but big draws need shading down — the exact figure is about 54%.",
  "m2-kqo-vs-aa": "8 outs on paper (aces and nines), but villain holds two of your aces — closer to 6 live outs × 2 ≈ 12–14% (exact: 13.6%).",
  "m2-flush-draw-turn": "The same 9 outs, but with one card to come it's ×2 ≈ 18% (exact: 20.5%) — not ×4.",
  "m2-combo-draw-turn": "~15 outs × 2 ≈ 30% with one card to come (exact: 34%).",
  "m2-set-vs-overpair": "You're way ahead — the overpair is drawing to two aces (exact: 91.1% for the set).",
  // M3 — pot odds
  "m3-chop-potodds": "Neither of you can beat the board's A-K-Q-J — you each just add a 4 as the fifth card, making the identical A-K-Q-J-4. It's a guaranteed chop, so calling collects your half of the pot.",
  "m3-flush-draw-call": "~20% equity vs a break-even of 1/(5+1) ≈ 17%: the price is right — call.",
  "m3-flush-draw-fold": "The same ~20% draw, but a pot-size bet needs 50% equity: the price is wrong — fold.",
  "m3-gutshot-fold": "~9% with one card to come against a 25% break-even: fold. Small draws rarely get the right price.",
  "m3-combo-draw-call": "~34% equity against a 25% break-even: a clear call.",
  "m3-bad-odds-fold": "This only looks like a draw. Pairing your 6 or 7 still loses to the aces, and 6-7 can't make a straight on this A-K-2 board — the only way to win is to pair BOTH cards or make a set, about 1.5%. Against a 50% price that's a fold, not a call.",
  // M3.5 — fold equity
  "m35-semibluff-flushdraw": "Two ways to win: villain folds often (instant profit), and when called you still hit the flush ~1 in 3.",
  "m35-no-fold-equity": "The same draw, but nobody folds: betting just builds a pot you usually lose. Check and take the free card.",
  "m35-oesd-semibluff": "Half the time they fold; when called you still have 8 outs. The two ways to win make betting best.",
  "m35-weak-draw-check": "4 outs and few folds — not enough of either way to win. Check.",
  "m35-turn-semibluff": "Fold equity still pays on the turn: frequent folds now, plus the flush when called.",
  // M4 — street sequencing
  "m4-sequence-two-streets": "Unbeatable hand, guaranteed caller: every street you don't bet is money left behind. Bet flop AND turn.",
  "m4-value-set": "Top set against a station: bet both streets to build the pot you're going to win.",
  "m4-overpair-protection": "Bet for value and charge the flush draw — checking hands over a free card.",
  "m4-way-behind-check": "Their two pair never folds and always calls: betting only loses more. Sequencing includes choosing NO streets — check to a cheap showdown.",
  // M5 — equity vs range
  "m5-overcards-vs-pairs": "Two overcards plus a gutshot vs underpairs is a live underdog — around a third of the pot on average (exact: 34.6%).",
  "m5-wide-range": "Behind both big pairs (though live), well ahead of TT — averaging across the range lands under a coinflip.",
  "m5-polarized-range": "Half the range is a bluff you crush, half is AA that crushes you — a bluff-catcher's equity sits near the middle.",
  "m5-overpair-vs-draws": "Ahead of both draws but crushed by the set — one strong combo drags a 'safe' overpair down to a coinflip.",
  "m5-underpair-vs-range": "Every hand in the range beats you and you're drawing to two jacks — near-dead. Recognizing ~5% spots saves stacks.",
  "m5-vs-condensed": "Every hand in the range is a pair you beat — against a condensed (medium-strength) range, an overpair is huge.",
  "m5-weighted-range": "3 bluff combos for every value combo: ¾ of the time you're crushing it, ¼ near-dead — the weighted average is ~70%, not the 50% an unweighted glance suggests.",
  "m5-dominated-kicker": "Both A-K combos out-kick your A-J; only KK is behind — domination cuts top pair down to ~40%.",
  // M5.6 — implied odds
  "m56-implied-odds-flushdraw": "Counting the chips you'll win later when the flush hits, the effective price justifies the call — the immediate pot alone wouldn't.",
  "m56-true-implied-odds": "The overbet needs 40% now and you have ~37% — but villain pays you again on the turn when the flush lands. Future bets rescue the call.",
  "m56-no-implied-odds": "You need 50% and have ~37% — and with nothing left to win later, implied odds can't make up the gap. Fold.",
  "m56-reverse-implied": "Your 'outs' complete villain's BIGGER flush — hitting often means losing more, not winning. Fold.",
  // P0 — position and realization
  "p0-oop-no-equity": "No equity, and a villain who bets when you check but never folds — betting only loses more. Out of position you can't take a free showdown, so check and fold. In position you could have checked it down; that's what position buys you.",
  "p0-ip-realize-equity": "Acting last, a check ends the round and buys a free river — you realize your full draw (9 outs, about 20%). Betting is a trap: this villain never folds, so a semi-bluff with no fold equity just burns chips. Out of position that same check would face a bet and realize nothing — the free card is what position buys you.",
  // P1 — preflop ranges
  "p1-aa-vs-kk-preflop": "Aces over kings is the classic crush — about 82%. The underdog is drawing almost entirely to one of the two remaining kings.",
  "p1-akx-vs-qq-race": "Two overcards against a pair is the classic 'race': suited A-K is a hair under a coin flip (~46%) versus the bigger pair.",
  "p1-ak-vs-aq": "You both hold an ace, so your king outkicks their queen — that's 'domination.' The dominated hand is drawing thin (mostly to a queen), leaving you around 74%.",
  // P2 — bet sizing
  "p2-bet-or-check": "Two ways to win: villain folds about half the time, and when called your open-ender still gets there. Betting beats checking.",
  "p2-size-up-nuts": "With the nuts and a villain who always calls, the bigger bet simply wins more — size up. The small bet leaves value behind.",
  "p2-thin-value": "A worse hand will call, so a value bet prints even with 'thin' top pair. Checking wins the same pot but for fewer chips.",
  // P3 — multi-street lines
  "p3-value-two-streets": "Unbeatable hand, guaranteed caller: bet every street. Each street you check is money you'll never get back.",
  "p3-3bet-the-nuts": "Facing a bet with the nuts, raising (a 3-bet) builds the pot; flat-calling under-extracts. Raise for value.",
  // P4 — multiway pots
  "p4-multiway-field": "Two opponents who both play the same board split the pot more ways — the field approximation drops your share of the chop to about a quarter.",
  "p4-strong-multiway": "Top pair top kicker is strong, but every extra opponent is another hand that can beat you — the field trims your equity a little below the heads-up number (~84%).",
  // P5 — exploit vs balance
  "p5-exploit-overfolder": "A hand with no showdown value only wins by making villain fold — and this villain folds often. Bet as a bluff; checking just gives up.",
  "p5-value-vs-raiser": "Villain raises whenever you bet, so lead out with the nuts and let them raise into you. Checking wastes a raise-happy opponent.",
  "p5-vs-checkraise-range": "Villain raises only hands that beat you and folds the rest, so betting gets raised when you're behind and folds out what you beat. Check and take a free showdown.",
  "p5-thin-value-vs-range": "Villain continues only with better hands, so betting gets called only when you're beat. Check to show down and beat the hands that would have folded.",
};

// A module is "done" once every one of its drills has been graded at least once
// (i.e. has a scheduling entry in the Session).
export function moduleDone(module: Module, session: Session): boolean {
  return module.drillIds.every((id) => session.reviews[id] !== undefined);
}

// Linear unlock: a module is "current" when all earlier modules are done; "locked"
// while any earlier one isn't; "done" once its own drills are all seen.
export function moduleStatus(moduleId: string, session: Session): "done" | "current" | "locked" {
  const i = MODULES.findIndex((m) => m.id === moduleId);
  if (i < 0) return "locked";
  if (moduleDone(MODULES[i], session)) return "done";
  for (let j = 0; j < i; j++) if (!moduleDone(MODULES[j], session)) return "locked";
  return "current";
}

// Consecutive days of activity ending today (or yesterday, as a grace day).
export function currentStreak(activeDays: number[], today: number): number {
  const set = new Set(activeDays);
  let d = set.has(today) ? today : set.has(today - 1) ? today - 1 : null;
  if (d === null) return 0;
  let n = 0;
  while (set.has(d)) { n++; d--; }
  return n;
}
