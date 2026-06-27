// L7 (web) — a PWA front-end over the SAME pure engine seam the CLI uses:
// loadSession -> nextDrill -> render -> gradeDrill -> persist -> repeat, plus the
// M6 (calibration) and P6 (leak-trend) reports. No engine logic lives here.
import {
  STARTER_DRILLS, loadSession, serializeSession, nextDrill, gradeDrill,
  buildTree, actionEVs, truth, calibration, leakReport,
  rankOf, suitOf, RNAMES,
} from "../engine.ts";
import type { Drill, Response, Action, State } from "../contract.ts";

// ---- persistence (localStorage; the IO boundary, like cli.ts's fs) ----------
const REVIEWS_KEY = "pt-reviews";
const HISTORY_KEY = "pt-history";
const now = (): number => Math.floor(Date.now() / 86_400_000); // whole days since epoch

interface History { samples: { estimate: number; truth: number }[]; results: { leakTag: string; regretBb: number }[]; }

let session = loadSession(STARTER_DRILLS, localStorage.getItem(REVIEWS_KEY));
let history: History = (() => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "") as History; }
  catch { return { samples: [], results: [] }; }
})();

function persist(): void {
  localStorage.setItem(REVIEWS_KEY, serializeSession(session));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// ---- rendering helpers ------------------------------------------------------
const SUIT_SYM = ["♠", "♥", "♦", "♣"]; // s h d c
const app = document.getElementById("app")!;
const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const cardHTML = (c: number): string => {
  const r = rankOf(c), s = suitOf(c);
  return `<span class="card s${s}">${RNAMES[r] ?? r}${SUIT_SYM[s]}</span>`;
};
const cards = (cs: number[]): string => cs.map(cardHTML).join("");

const CATEGORY = ["high card", "pair", "two pair", "trips", "straight", "flush", "full house", "quads", "straight flush"];
const actionLabel = (a: Action): string =>
  a.kind === "bet" ? (a.size === undefined ? "bet" : `bet ${a.size}`) : a.kind;

function legalActions(d: Drill): Action[] {
  if (d.state.abstraction.sizes.length === 0) return [{ kind: "fold" }, { kind: "call" }]; // pillar-1 call/fold
  return actionEVs(buildTree(d.state)).map((e) => e.action);                                // tree root actions
}

function villainText(s: State): string {
  const r = s.villain.range;
  if (r.length === 0) return "";
  if (r.length === 1) return `vs ${cards(r[0].combo)}`;
  return `vs a ${r.length}-combo range`;
}

// ---- the drill loop ---------------------------------------------------------
function render(): void {
  app.innerHTML = "";
  const drill = nextDrill(session, now());
  if (!drill) { renderDone(); return; }

  const s = drill.state;
  const due = session.drills.filter((d) => (session.reviews[d.id]?.due ?? now()) <= now()).length;

  const card = el("section", "drill");
  card.append(
    el("div", "tag", `${drill.module} · ${due} due`),
    el("h2", "title", drill.title),
    el("div", "board", s.board.length ? cards(s.board) : "<em>(preflop)</em>"),
    el("div", "meta", `Pot ${s.pot}${s.toCall !== undefined ? ` · to call ${s.toCall}` : ""}` +
      (s.abstraction.players > 2 ? ` · ${s.abstraction.players}-way` : "")),
    s.heroHand ? el("div", "hero", `You: ${cards(s.heroHand)}`) : el("div"),
    el("div", "vill", villainText(s)),
  );

  const controls = el("div", "controls");
  if (drill.ask === "estimate") {
    const input = el("input") as HTMLInputElement;
    input.type = "number"; input.min = "0"; input.max = "1"; input.step = "0.01"; input.placeholder = "equity 0..1";
    const go = el("button", "primary", "Submit");
    const submit = () => { const v = Number(input.value); if (Number.isFinite(v)) answer(drill, { kind: "estimate", value: v }); };
    go.onclick = submit;
    input.onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); };
    controls.append(el("label", "prompt", "Your equity estimate:"), input, go);
  } else if (drill.ask === "category") {
    controls.append(el("label", "prompt", "Name your made hand:"));
    const grid = el("div", "cats");
    CATEGORY.forEach((name, i) => {
      const b = el("button", "cat", `${i} · ${name}`);
      b.onclick = () => answer(drill, { kind: "category", value: i });
      grid.append(b);
    });
    controls.append(grid);
  } else {
    controls.append(el("label", "prompt", "Your action:"));
    const row = el("div", "actions");
    for (const a of legalActions(drill)) {
      const b = el("button", "act", actionLabel(a));
      b.onclick = () => answer(drill, { kind: "action", action: a });
      row.append(b);
    }
    controls.append(row);
  }
  card.append(controls);
  app.append(card);
  app.append(statsLink());
  (card.querySelector("input") as HTMLInputElement | null)?.focus();
}

function answer(drill: Drill, response: Response): void {
  let out;
  try { out = gradeDrill(session, drill.id, response, now()); }
  catch (e) { return; } // illegal response; ignore (shouldn't happen via the UI)
  session = out.session;
  if (response.kind === "estimate" && out.truth !== undefined) history.samples.push({ estimate: response.value, truth: out.truth });
  history.results.push({ leakTag: out.result.leakTag, regretBb: out.result.regretBb });
  persist();
  app.querySelector(".controls")?.remove();   // lock the answered spot (keep it visible, read-only)
  app.querySelector("button.link")?.remove();  // drop the stats link; feedback carries Next
  renderFeedback(drill, out, response);
}

function renderFeedback(drill: Drill, out: ReturnType<typeof gradeDrill>, response: Response): void {
  const r = out.result;
  const ok = r.leakTag.endsWith(".ok");
  const fb = el("div", `feedback ${ok ? "good" : "bad"}`);
  let line = "";
  if (drill.ask === "estimate") {
    line = `True equity ${truth(drill.state).toFixed(3)} · error ${(r.estimateError ?? 0).toFixed(3)}`;
  } else if (drill.ask === "category") {
    line = r.estimateError === 0 ? "Correct!" : `Off by ${r.estimateError} categor${r.estimateError === 1 ? "y" : "ies"}`;
  } else {
    line = r.regretBb <= 1e-9 ? "Optimal." : `Regret ${r.regretBb.toFixed(2)} bb`;
  }
  fb.append(el("div", "fb-line", line), el("div", "leak", r.leakTag),
    el("div", "next-review", `next review in ${out.review.intervalDays}d`));
  const next = el("button", "primary", "Next →");
  next.onclick = render;
  fb.append(next);
  app.append(fb);
  next.focus();
}

function renderDone(): void {
  app.append(
    el("section", "done", "<h2>All caught up 🎯</h2><p>No drills due right now. Come back tomorrow — your schedule resumes then.</p>"),
    renderStats(),
  );
}

function statsLink(): HTMLElement {
  const a = el("button", "link", "View stats");
  a.onclick = () => { app.innerHTML = ""; app.append(renderStats(), backToDrills()); };
  return a;
}
function backToDrills(): HTMLElement {
  const b = el("button", "link", "← Back to drills");
  b.onclick = render;
  return b;
}

function renderStats(): HTMLElement {
  const wrap = el("section", "stats");
  const cal = calibration(history.samples);
  wrap.append(el("h3", undefined, "Calibration (estimates)"));
  if (cal.n === 0) wrap.append(el("p", "muted", "No estimates yet."));
  else {
    wrap.append(el("p", undefined, `Brier ${cal.brier!.toFixed(3)} over ${cal.n} estimates`));
    for (const b of cal.buckets) {
      const gap = `${b.gap >= 0 ? "+" : ""}${b.gap.toFixed(2)}`;
      wrap.append(el("div", "bucket", `[${b.lo.toFixed(1)},${b.hi.toFixed(1)}) n=${b.count} · you ${b.meanEstimate.toFixed(2)} · actual ${b.meanTruth.toFixed(2)} · gap ${gap}`));
    }
  }
  const lr = leakReport(history.results);
  wrap.append(el("h3", undefined, "Top leaks (decisions)"));
  if (!lr.leaks.length) wrap.append(el("p", "muted", "No leaks recorded — nice."));
  else for (const l of lr.leaks.slice(0, 6))
    wrap.append(el("div", "leakrow", `${l.leakTag} · ×${l.count} · ${l.totalRegret.toFixed(2)} bb`));
  return wrap;
}

render();
