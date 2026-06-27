// L7 — CLI trainer. The IO boundary that drives the (pure) L6 session loop:
// present a spot -> read the user's estimate/action -> grade -> schedule -> repeat.
// Dependency-free (Node's built-in readline); runs under type-stripping:
//   node cli.ts
// Non-interactive smoke test: pipe answers, e.g.  printf '0.14\ncall\nbet\n' | node cli.ts
import { createInterface } from "node:readline";
import {
  STARTER_DRILLS, newSession, nextDrill, gradeDrill, truth, buildTree, actionEVs,
  rankOf, suitOf, RNAMES, SNAMES,
} from "./engine.ts";
import type { Drill, Response, State, Card, GradeOutcome } from "./contract.ts";

const cardName = (c: Card): string => (RNAMES[rankOf(c)] ?? String(rankOf(c))) + SNAMES[suitOf(c)];
const cards = (cs: Card[]): string => cs.map(cardName).join(" ");

function villainLabel(s: State): string {
  const r = s.villain.range;
  if (r.length === 1) return `${cards(r[0].combo)} (fixed)`;
  return `${r.length}-combo range`;
}

function legalLabel(s: State): string {
  if (s.abstraction.sizes.length === 0) return s.toCall !== undefined ? "fold, call" : "check";
  return actionEVs(buildTree(s))
    .map((e) => (e.action.kind === "bet" ? `bet ${e.action.size}` : e.action.kind))
    .join(", ");
}

function present(d: Drill): void {
  const s = d.state;
  console.log("");
  console.log(`[${d.module}] ${d.title}`);
  console.log(
    `Board: ${cards(s.board) || "(preflop)"} | Pot: ${s.pot}` +
    (s.toCall !== undefined ? ` | To call: ${s.toCall}` : ""));
  if (s.heroHand) console.log(`Hero:  ${cards(s.heroHand)}`);
  console.log(`Vill:  ${villainLabel(s)} | ${s.abstraction.players} player(s)`);
  if (d.ask === "action") console.log(`Legal: ${legalLabel(s)}`);
}

function parseResponse(d: Drill, answer: string): Response {
  if (d.ask === "estimate") {
    const value = Number(answer);
    if (!Number.isFinite(value)) throw new Error(`not a number: "${answer}"`);
    return { kind: "estimate", value };
  }
  const w = answer.toLowerCase().trim();
  if (w === "fold") return { kind: "action", action: { kind: "fold" } };
  if (w === "call") return { kind: "action", action: { kind: "call" } };
  if (w === "check") return { kind: "action", action: { kind: "check" } };
  if (w.startsWith("bet")) {
    const sizes = d.state.abstraction.sizes;
    if (!sizes.length) throw new Error("no bet available here");
    const arg = w.split(/\s+/)[1];
    return { kind: "action", action: { kind: "bet", size: arg !== undefined ? Number(arg) : sizes[0] } };
  }
  throw new Error(`unrecognized action: "${answer}"`);
}

function showFeedback(d: Drill, out: GradeOutcome): void {
  const r = out.result;
  if (r.estimateError !== undefined) {
    console.log(`  -> true equity ${truth(d.state).toFixed(3)} | error ${r.estimateError.toFixed(3)} | ${r.leakTag}`);
  } else {
    console.log(`  -> regret ${r.regretBb.toFixed(3)} bb | ${r.leakTag}`);
  }
  console.log(`     next review in ${out.review.intervalDays}d (ease ${out.review.ease.toFixed(2)}, reps ${out.review.reps})`);
}

const promptFor = (d: Drill): string =>
  d.ask === "estimate" ? "Your equity estimate (0..1): " : "Your action: ";

// Pull lines from readline's async iterator (correct backpressure for piped or
// interactive input — unlike repeated question() which races across awaits).
const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const nextLine = async (): Promise<string | null> => {
  const r = await lines.next();
  return r.done ? null : r.value;
};

console.log("Poker Trainer — today's drills (Ctrl-C to quit)");
let session = newSession(STARTER_DRILLS);
const now = 0; // a single sitting = "today"; graded drills schedule out to >= day 1
let graded = 0;

while (true) {
  const drill = nextDrill(session, now);
  if (!drill) break;
  present(drill);
  console.log(promptFor(drill));
  const answer = await nextLine();
  if (answer === null) break; // stdin closed
  try {
    const out = gradeDrill(session, drill.id, parseResponse(drill, answer), now);
    session = out.session;
    graded++;
    showFeedback(drill, out);
  } catch (e) {
    console.log(`  ! ${(e as Error).message} — try again.`);
  }
}

console.log(`\nNo more drills due today. Graded ${graded}. Come back tomorrow (next reviews scheduled).`);
rl.close();
