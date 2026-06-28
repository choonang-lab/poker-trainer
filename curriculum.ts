// Curriculum — the guided "learn" path over the L6 drills. Pure data + helpers;
// the web UI consumes it. Modules unlock in array order (Pillar 1 then Pillar 2);
// progress is derived from the Session's reviews (a drill is "seen" once graded).
import type { Module, Session } from "./contract.ts";

export const MODULES: Module[] = [
  // ---- Pillar 1 · estimate ----
  {
    id: "M0", track: "P1", title: "Hand reading",
    preface: "Before you can judge equity you have to read the board: what is your made hand right now, and what beats it? Fast, accurate hand-reading is the foundation everything else builds on.",
    objectives: ["Name your made hand's category at a glance", "Spot the nut hands a board allows", "Avoid misreading straights, flushes, and full houses"],
    example: "On A♠ K♥ 7♣ holding A♦ K♦ you have two pair (aces and kings) — not just 'top pair'.",
    drillIds: ["m0-read-two-pair", "m0-read-straight"],
  },
  {
    id: "M1", track: "P1", title: "Counting outs",
    preface: "After the flop you usually have a draw, not the best hand. Your outs are the cards that complete it — counting them is the first step to equity.",
    objectives: ["Count cards that improve you to the best hand", "Recognize draw types: flush 9, open-ender 8, gutshot 4", "Subtract outs that complete a better hand"],
    example: "A flush draw has 9 outs — 13 cards of the suit minus the 4 you can see.",
    drillIds: ["m1-flush-draw-outs", "m1-open-ender"],
  },
  {
    id: "M2", track: "P1", title: "Rule of 2 and 4",
    preface: "Turn outs into equity with the rule of 2 and 4: multiply outs by 4 with two cards to come, by 2 with one. It's an estimate — big draws need a small correction down.",
    objectives: ["Convert outs to equity with ×2 and ×4", "Apply the correction when you have many outs", "Estimate combo-draw and made-hand equity"],
    example: "9 outs × 4 ≈ 36% by the flop; the exact figure is about 35%.",
    drillIds: ["m2-kqo-vs-aa", "m2-combo-draw", "m2-set-vs-overpair"],
  },
  {
    id: "M3", track: "P1", title: "Pot odds",
    preface: "A draw is only worth chasing if the price is right. Pot odds compare what you must call to what you stand to win.",
    objectives: ["Compute the break-even percentage", "Call when equity is at or above break-even", "Fold when the price is wrong"],
    example: "Calling 1 to win a pot of 2 needs 1 / 3 ≈ 33% equity.",
    drillIds: ["m3-chop-potodds", "m3-bad-odds-fold"],
  },
  {
    id: "M3.5", track: "P1", title: "Fold equity",
    preface: "Betting can win two ways: your opponent folds, or you make the best hand. That extra 'fold equity' often makes a semi-bluff better than checking.",
    objectives: ["See how folds add value to a bet", "Combine fold equity with a draw's equity", "Pick spots where betting beats checking"],
    example: "Betting a flush draw wins now when they fold, and later when you hit.",
    drillIds: ["m35-semibluff-flushdraw", "m35-turn-semibluff"],
  },
  {
    id: "M4", track: "P1", title: "Street sequencing",
    preface: "Hands play out over several streets. Planning the line — which streets to bet — extracts more than deciding one street at a time.",
    objectives: ["Plan a multi-street betting line", "Bet strong hands across streets for value", "Avoid leaving money behind by checking"],
    example: "With the nuts, betting flop and turn builds a far bigger pot than a single bet.",
    drillIds: ["m4-sequence-two-streets"],
  },
  {
    id: "M5", track: "P1", title: "Equity vs range",
    preface: "Opponents hold ranges, not single hands. Your real equity is the average against every hand they could have, weighted by how likely each is.",
    objectives: ["Estimate equity against a range, not one hand", "Weight wide ranges correctly", "Read your equity vs a polarized (nuts-or-air) range"],
    example: "AK-high is about 40% vs a set but 85% vs an underpair — average over the whole range.",
    drillIds: ["m5-overcards-vs-pairs", "m5-wide-range", "m5-polarized-range"],
  },
  {
    id: "M5.6", track: "P1", title: "Implied odds",
    preface: "Sometimes a call that's wrong on immediate pot odds is right because of what you'll win later when the draw hits. That's implied odds.",
    objectives: ["Add expected future winnings to the price", "Call draws that immediate odds reject", "Recognize when implied odds aren't really there"],
    example: "Calling a big bet with a flush draw can be +EV if you get paid off when it comes in.",
    drillIds: ["m56-implied-odds-flushdraw", "m56-true-implied-odds"],
  },
  // ---- Pillar 2 · decide ----
  {
    id: "P0", track: "P2", title: "Position and realization",
    preface: "Acting last is an edge — you see your opponent first. Out of position you realize less of your equity, so play tighter and bluff less.",
    objectives: ["Understand why position realizes more equity", "Check-fold weak hands out of position", "Avoid spewing chips with no equity OOP"],
    example: "Out of position with no equity, check-fold (lose nothing) beats bluffing into a caller.",
    drillIds: ["p0-oop-no-equity"],
  },
  {
    id: "P1", track: "P2", title: "Preflop ranges",
    preface: "Every hand starts preflop. Knowing roughly how holdings run — favorites, races, dominations — anchors your whole game.",
    objectives: ["Estimate preflop equity between holdings", "Recognize coinflips and big favorites", "Value pocket pairs vs overcards"],
    example: "AA vs KK is about 82%; AK vs QQ is a near coinflip (~46%).",
    drillIds: ["p1-aa-vs-kk-preflop", "p1-akx-vs-qq-race"],
  },
  {
    id: "P2", track: "P2", title: "Bet sizing",
    preface: "How much you bet matters as much as whether you bet. Size up with strong hands for value; don't bet into ranges that continue only when they beat you.",
    objectives: ["Choose a bet size for the spot", "Size up with the nuts for value", "Bet thin only when worse hands call"],
    example: "With the nuts and a caller, a pot-size bet earns more than a half-pot bet.",
    drillIds: ["p2-bet-or-check", "p2-size-up-nuts", "p2-thin-value"],
  },
  {
    id: "P3", track: "P2", title: "Multi-street lines",
    preface: "Big pots are built (or lost) over several streets and raises. Plan the whole line — and don't just flat when raising for value is better.",
    objectives: ["Value-bet across multiple streets", "Re-raise (3-bet) the nuts instead of flatting", "Think one street ahead"],
    example: "Facing a bet with the nuts, raising extracts more than calling and showing down.",
    drillIds: ["p3-value-two-streets", "p3-3bet-the-nuts"],
  },
  {
    id: "P4", track: "P2", title: "Multiway pots",
    preface: "Pots with three or more players are different: to win you must beat everyone, so hands need to be stronger. (The field is modeled as an approximation.)",
    objectives: ["Adjust equity down against multiple opponents", "Value strong hands vs a field", "Avoid overrating marginal hands multiway"],
    example: "A hand that's 50% heads-up is only about 25% against two opponents.",
    drillIds: ["p4-multiway-field", "p4-strong-multiway"],
  },
  {
    id: "P5", track: "P2", title: "Exploit vs balance",
    preface: "The biggest profits come from exploiting how your specific opponent deviates — over-folding, calling too wide, raising only monsters. Read the leak, then attack it.",
    objectives: ["Bluff more vs players who over-fold", "Value-bet bigger vs stations and raisers", "Don't bet thin into a strong, narrow range"],
    example: "If a villain raises only hands that beat you, betting just gets you raised off your equity.",
    drillIds: ["p5-exploit-overfolder", "p5-value-vs-raiser", "p5-thin-value-vs-range", "p5-vs-checkraise-range"],
  },
];

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
