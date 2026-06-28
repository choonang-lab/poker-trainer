// L7 — CLI trainer. The IO boundary that drives the (pure) L6 session loop:
// present a spot -> read the user's estimate/action -> grade -> schedule -> repeat.
// Dependency-free (Node's built-in readline); runs under type-stripping:
//   node cli.ts
// Non-interactive smoke test: pipe answers, e.g.  printf '0.14\ncall\nbet\n' | node cli.ts
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  STARTER_DRILLS, loadSession, serializeSession, nextDrill, gradeDrill, truth, buildTree, actionEVs,
  calibration, leakReport, rankOf, suitOf, RNAMES, SNAMES,
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
  if (s.villain.range.length) console.log(`Vill:  ${villainLabel(s)} | ${s.abstraction.players} player(s)`);
  if (d.ask === "action") console.log(`Legal: ${legalLabel(s)}`);
}

function parseResponse(d: Drill, answer: string): Response {
  if (d.ask === "estimate") {
    const value = Number(answer);
    if (!Number.isFinite(value)) throw new Error(`not a number: "${answer}"`);
    return { kind: "estimate", value };
  }
  if (d.ask === "category") {
    const value = Number(answer);
    if (!Number.isFinite(value)) throw new Error(`not a number: "${answer}"`);
    return { kind: "category", value };
  }
  if (d.ask === "outs") {
    const value = Math.round(Number(answer));
    if (!Number.isFinite(value)) throw new Error(`not a number: "${answer}"`);
    return { kind: "outs", value };
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
  if (d.ask === "estimate") {
    console.log(`  -> true equity ${truth(d.state).toFixed(3)} | error ${(r.estimateError ?? 0).toFixed(3)} | ${r.leakTag}`);
  } else if (d.ask === "category" || d.ask === "outs") {
    console.log(`  -> ${r.estimateError === 0 ? "correct" : `off by ${r.estimateError}`} | ${r.leakTag}`);
  } else {
    console.log(`  -> regret ${r.regretBb.toFixed(3)} bb | ${r.leakTag}`);
  }
  console.log(`     next review in ${out.review.intervalDays}d (ease ${out.review.ease.toFixed(2)}, reps ${out.review.reps})`);
}

const promptFor = (d: Drill): string =>
  d.ask === "estimate" ? "Your equity estimate (0..1): "
    : d.ask === "category" ? "Your hand category (0=high .. 8=straight flush): "
      : d.ask === "outs" ? "How many outs? "
        : "Your action: ";

// Pull lines from readline's async iterator (correct backpressure for piped or
// interactive input — unlike repeated question() which races across awaits).
const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const nextLine = async (): Promise<string | null> => {
  const r = await lines.next();
  return r.done ? null : r.value;
};

// Persistence: progress (scheduling state) is saved to a JSON file and reloaded
// across runs. Path and "today" are overridable via env for scripted/test runs.
const SAVE = process.env.POKER_SAVE ?? ".poker-trainer.json";
const now = process.env.POKER_NOW !== undefined
  ? Number(process.env.POKER_NOW)
  : Math.floor(Date.now() / 86_400_000); // whole days since the epoch

console.log(`Poker Trainer — day ${now} (Ctrl-C to quit; progress saved to ${SAVE})`);
let session = loadSession(STARTER_DRILLS, existsSync(SAVE) ? readFileSync(SAVE, "utf8") : null);
let graded = 0;
const samples: { estimate: number; truth: number }[] = []; // for the M6 calibration summary
const results: { leakTag: string; regretBb: number }[] = []; // for the P6 leak-trend report

while (true) {
  const drill = nextDrill(session, now);
  if (!drill) break;
  present(drill);
  console.log(promptFor(drill));
  const answer = await nextLine();
  if (answer === null) break; // stdin closed
  try {
    const response = parseResponse(drill, answer);
    const out = gradeDrill(session, drill.id, response, now);
    session = out.session;
    graded++;
    if (response.kind === "estimate" && out.truth !== undefined)
      samples.push({ estimate: response.value, truth: out.truth });
    results.push({ leakTag: out.result.leakTag, regretBb: out.result.regretBb });
    writeFileSync(SAVE, serializeSession(session)); // persist after each graded drill
    showFeedback(drill, out);
  } catch (e) {
    console.log(`  ! ${(e as Error).message} — try again.`);
  }
}

// M6 calibration summary over this run's estimates.
if (samples.length) {
  const cal = calibration(samples);
  console.log(`\nCalibration over ${cal.n} estimate(s): brier ${cal.brier?.toFixed(3)}`);
  for (const b of cal.buckets) {
    const g = `${b.gap >= 0 ? "+" : ""}${b.gap.toFixed(2)}`;
    console.log(`  [${b.lo.toFixed(1)},${b.hi.toFixed(1)}) n=${b.count} you=${b.meanEstimate.toFixed(2)} actual=${b.meanTruth.toFixed(2)} gap=${g}`);
  }
}

// P6 leak-trend report over this run.
const lr = leakReport(results);
if (lr.leaks.length) {
  console.log(`\nTop leaks (avg regret ${lr.meanRegret.toFixed(3)} bb over ${lr.n} drills):`);
  for (const l of lr.leaks.slice(0, 5))
    console.log(`  ${l.leakTag}  x${l.count}  total ${l.totalRegret.toFixed(2)} bb`);
}

console.log(`\nNo more drills due today. Graded ${graded}. Progress saved — come back tomorrow.`);
rl.close();
