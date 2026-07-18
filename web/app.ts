// L7 (web) — a guided PWA over the SAME pure engine seam the CLI uses. Two modes
// over one engine: a sequenced "Learn" path (module map -> intro -> lessons ->
// recap) that feeds the existing SM-2 "Review" queue, plus a "Stats" view (M6
// calibration + P6 leaks). Curriculum structure/progress come from curriculum.ts;
// no engine logic lives here.
import {
  STARTER_DRILLS, loadSession, serializeSession, gradeDrill,
  buildTree, actionEVs, truth, outs, calibration, leakReport,
  rankOf, suitOf, RNAMES, score7, madeHand, drawSuit, nutCategory,
} from "../engine.ts";
import { MODULES, PRIMER, EXPLAIN, moduleStatus, currentStreak } from "../curriculum.ts";
import type { Drill, Response, Action, State, Module } from "../contract.ts";

// ---- persistence (localStorage; the IO boundary, like cli.ts's fs) ----------
const REVIEWS_KEY = "pt-reviews";
const HISTORY_KEY = "pt-history";
const DAYS_KEY = "pt-days";
const now = (): number => Math.floor(Date.now() / 86_400_000); // whole days since epoch

interface History { samples: { estimate: number; truth: number }[]; results: { leakTag: string; regretBb: number }[]; }

let session = loadSession(STARTER_DRILLS, localStorage.getItem(REVIEWS_KEY));
let history: History = parse<History>(HISTORY_KEY, { samples: [], results: [] });
let activeDays: number[] = parse<number[]>(DAYS_KEY, []);

function parse<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}
function persist(): void {
  localStorage.setItem(REVIEWS_KEY, serializeSession(session));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  localStorage.setItem(DAYS_KEY, JSON.stringify(activeDays));
}

// ---- UI state ---------------------------------------------------------------
type View = "learn" | "review" | "stats";
type LScreen = "map" | "primer" | "intro" | "drill" | "recap";
let view: View = "learn";
let lScreen: LScreen = "map";
let activeModule: Module | null = null;
let lessonIndex = 0;

// ---- rendering helpers ------------------------------------------------------
const SUIT_SYM = ["♠", "♥", "♦", "♣"]; // s h d c
const app = document.getElementById("app")!;
let navEl: HTMLElement | null = null;
const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const rankLabel = (r: number): string => (r === 10 ? "10" : RNAMES[r] ?? String(r)); // beginners read "10", not "T"
// a mini playing-card face: rank+suit index in the top-left corner, big faint suit pip center-right.
const tileHTML = (rank: string, s: number, extra = ""): string =>
  `<span class="pcard s${s}${extra}"><span class="idx"><span class="pr">${rank}</span><span class="ps">${SUIT_SYM[s]}</span></span><span class="pip">${SUIT_SYM[s]}</span></span>`;
// post-answer highlight: `made` cards ring green, flush-draw cards ring blue, the
// rest dim so the relevant cards pop. Undefined -> plain tiles (before answering).
type Highlight = { made: Set<number>; draw: number | null };
const cardHTML = (c: number, hl?: Highlight): string => {
  let extra = "";
  if (hl) extra = hl.made.has(c) ? " hi" : hl.draw !== null && suitOf(c) === hl.draw ? " draw" : " dim";
  return tileHTML(rankLabel(rankOf(c)), suitOf(c), extra);
};
const cards = (cs: number[], hl?: Highlight): string => cs.map((c) => cardHTML(c, hl)).join("");
// turn rank+suit tokens in curriculum prose (e.g. "A♦", "9♠", "10♥") into the same tiles.
// (content is trusted, so injecting spans into innerHTML is safe here.)
const withCardTiles = (text: string): string =>
  text.replace(/(10|[2-9TJQKA])([♠♥♦♣])/g, (_m, r, sym) =>
    tileHTML(r === "T" ? "10" : r, SUIT_SYM.indexOf(sym)));
const drillById = (id: string): Drill => STARTER_DRILLS.find((d) => d.id === id)!;

const CATEGORY = ["high card", "pair", "two pair", "trips", "straight", "flush", "full house", "quads", "straight flush"];
// A leak tag is "<module>.<snake_case>"; show a readable phrase, not the raw key.
const humanLeak = (tag: string): string => {
  const s = tag.slice(tag.indexOf(".") + 1).replace(/_/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : tag;
};
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
  if (r.length > 4) return `vs a ${r.length}-combo range`;
  const uniform = r.every((x) => x.weight === r[0].weight);
  const parts = r.map((x) => cards(x.combo) + (uniform ? "" : ` <span class="wt">×${x.weight}</span>`));
  return `vs ${parts.join("&nbsp; · &nbsp;")}`;
}

// drills that have been seen (graded once) and are due for spaced review today
function dueDrills(): Drill[] {
  return session.drills
    .filter((d) => session.reviews[d.id] && session.reviews[d.id]!.due <= now())
    .sort((a, b) => session.reviews[a.id]!.due - session.reviews[b.id]!.due);
}
function streakChip(): HTMLElement {
  const n = currentStreak(activeDays, now());
  return el("div", "streak", n > 0 ? `🔥 <b>${n}</b>-day streak` : "Play a lesson to start a streak");
}
function backLink(label: string, fn: () => void): HTMLElement {
  const b = el("button", "backlink", label); b.onclick = fn; return b;
}

// ---- top-level shell --------------------------------------------------------
function setView(v: View): void { view = v; if (v === "learn") lScreen = "map"; renderAll(); }

function renderAll(): void {
  app.innerHTML = "";
  if (view === "learn") renderLearn();
  else if (view === "review") renderReview();
  else renderStatsView();
  renderNav();
}
function renderNav(): void {
  navEl?.remove();
  const nav = el("nav"); nav.id = "nav";
  const inner = el("div", "navinner");
  const due = dueDrills().length;
  ([["learn", "Learn"], ["review", "Review"], ["stats", "Stats"]] as [View, string][]).forEach(([v, label]) => {
    const b = el("button", "navbtn" + (view === v ? " on" : ""),
      label + (v === "review" && due ? ` <span class="badge">${due}</span>` : ""));
    b.onclick = () => setView(v);
    inner.append(b);
  });
  nav.append(inner);
  document.body.append(nav);
  navEl = nav;
}

// ---- Learn: map -> intro -> lessons -> recap --------------------------------
function renderLearn(): void {
  if (lScreen === "map") renderMap();
  else if (lScreen === "primer") renderPrimer();
  else if (lScreen === "intro") renderIntro();
  else if (lScreen === "drill") renderLesson();
  else renderRecap();
}

function renderMap(): void {
  app.append(streakChip());
  const starter = el("div", "modrow starter");
  starter.append(el("div", "mdot", "★"));
  const stitle = el("div", "mtitle");
  stitle.append(el("div", "nm", "Start here"), el("div", "sb", "New to poker? Learn the words first."));
  starter.append(stitle);
  starter.onclick = () => { lScreen = "primer"; renderAll(); };
  app.append(starter);
  const tracks: [Module["track"], string][] = [["P1", "Pillar 1 · estimate"], ["P2", "Pillar 2 · decide"]];
  for (const [tr, label] of tracks) {
    app.append(el("div", "trackhdr", label));
    for (const m of MODULES.filter((x) => x.track === tr)) {
      const st = moduleStatus(m.id, session);
      const dueN = m.drillIds.filter((id) => session.reviews[id] && session.reviews[id]!.due <= now()).length;
      const n = m.drillIds.length, lessons = `${n} lesson${n > 1 ? "s" : ""}`;
      const sb = st === "locked" ? (m.id === "P0" ? "Finish Pillar 1 to unlock" : "Locked")
        : st === "done" ? `Done · ${lessons}` : lessons;
      const row = el("div", "modrow " + st);
      row.append(el("div", "mdot", st === "done" ? "✓" : st === "current" ? "▶" : "🔒"));
      const title = el("div", "mtitle");
      title.append(el("div", "nm", `${m.id} · ${m.title}`), el("div", "sb", sb));
      row.append(title);
      if (dueN > 0) row.append(el("span", "badge", `${dueN} due`));
      if (st !== "locked") row.onclick = () => { activeModule = m; lScreen = "intro"; renderAll(); };
      app.append(row);
    }
  }
}

function renderPrimer(): void {
  app.append(backLink("← Path", () => { lScreen = "map"; renderAll(); }));
  const sec = el("section", "drill primer-screen");
  sec.append(el("div", "tag", "Start here"), el("h2", "title", "Poker basics"));
  for (const s of PRIMER) {
    sec.append(el("h3", "primer-h", s.heading));
    for (const p of s.body) sec.append(el("p", "primer-p", withCardTiles(p)));
  }
  const done = el("button", "primary", "Got it — back to the path");
  done.onclick = () => { lScreen = "map"; renderAll(); };
  sec.append(done);
  app.append(sec);
}

function renderIntro(): void {
  const m = activeModule!;
  app.append(backLink("← Path", () => { lScreen = "map"; renderAll(); }));
  const sec = el("section", "drill intro");
  sec.append(
    el("div", "tag", m.track === "P1" ? "Pillar 1 · estimate" : "Pillar 2 · decide"),
    el("h2", "title", `${m.id} · ${m.title}`),
    el("p", "preface", withCardTiles(m.preface)),
  );
  sec.append(el("div", "prompt", "Key terms"));
  for (const c of m.concepts) {
    const r = el("div", "term");
    r.append(el("span", "tm", c.term), el("span", "df", ` — ${withCardTiles(c.def)}`));
    sec.append(r);
  }
  sec.append(el("div", "prompt", "You'll be able to"));
  for (const o of m.objectives) {
    const r = el("div", "obj"); r.append(el("span", "ck", "✓"), el("div", undefined, o)); sec.append(r);
  }
  const ex = el("div", "example"); ex.append(el("span", "lbl", "Worked example"), el("span", undefined, withCardTiles(m.example)));
  sec.append(ex);
  const start = el("button", "primary", "Start module");
  start.onclick = () => { lessonIndex = 0; lScreen = "drill"; renderAll(); };
  sec.append(start);
  app.append(sec);
}

function renderLesson(): void {
  const m = activeModule!;
  app.append(backLink("← Path", () => { lScreen = "map"; renderAll(); }));
  const prog = el("div", "prog");
  m.drillIds.forEach((_, i) => prog.append(el("div", "pg" + (i <= lessonIndex ? " fill" : ""))));
  app.append(prog);
  const last = lessonIndex === m.drillIds.length - 1;
  playDrill(drillById(m.drillIds[lessonIndex]), `Lesson ${lessonIndex + 1} of ${m.drillIds.length}`,
    last ? "Finish module" : "Next lesson",
    () => { if (last) { lScreen = "recap"; } else { lessonIndex++; } renderAll(); });
}

function renderRecap(): void {
  const m = activeModule!;
  const sec = el("section", "drill recap");
  sec.append(el("div", "done-ic", "✓"), el("h2", "title", "Module complete"),
    el("p", "muted", `You finished ${m.id} · ${m.title}.`));
  const objs = el("div", "recap-objs");
  for (const o of m.objectives) { const r = el("div", "obj"); r.append(el("span", "ck", "✓"), el("div", undefined, o)); objs.append(r); }
  sec.append(objs);
  const n = m.drillIds.length;
  sec.append(el("p", "muted", `${n} lesson${n > 1 ? "s" : ""} added to your daily reviews — spaced repetition takes over from here.`));
  const next = MODULES[MODULES.findIndex((x) => x.id === m.id) + 1];
  if (next) {
    const b = el("button", "primary", `Next: ${next.id} · ${next.title}`);
    b.onclick = () => { activeModule = next; lScreen = "intro"; renderAll(); };
    sec.append(b);
  } else {
    sec.append(el("p", "muted", "You've completed the whole curriculum. 🎉"));
  }
  const back = el("button", undefined, "Back to path");
  back.onclick = () => { lScreen = "map"; renderAll(); };
  sec.append(back);
  app.append(sec);
}

// ---- Review: spaced repetition over learned drills --------------------------
function renderReview(): void {
  app.append(el("h2", "screen-title", "Today's reviews"), streakChip());
  const queue = dueDrills();
  if (!queue.length) {
    app.append(el("p", "muted", "No reviews due right now. Learn a new module on the Learn tab, or come back tomorrow — your schedule resumes then."));
    return;
  }
  app.append(el("p", "muted", `${queue.length} due across modules you've learned`));
  playDrill(queue[0], `${queue[0].module} · review`, "Next →", () => renderAll());
}

// After answering, work out what to highlight: the made hand's five cards (only
// when it's a pair or better — highlighting "high card" isn't instructive) and a
// flush draw's suit. Null before the flop or when there's nothing worth marking.
function highlightFor(drill: Drill): Highlight | null {
  const s = drill.state;
  if (!s.heroHand || s.board.length < 3) return null;
  const all = [...s.heroHand, ...s.board];
  const made = new Set<number>();
  if (score7(all)[0] >= 1) for (const c of madeHand(all)) made.add(c);
  // A flush draw only exists with a card still to come (flop/turn); on a 5-card
  // board four of a suit just missed — it is not a draw, so never tint it.
  const draw = s.board.length < 5 ? drawSuit(s.heroHand, s.board) : null;
  return made.size === 0 && draw === null ? null : { made, draw };
}
// repaint the board + hole rows with the highlight, and describe the colours.
function applyHighlight(sec: HTMLElement, drill: Drill, hl: Highlight): void {
  const s = drill.state;
  const boardEl = sec.querySelector(".board");
  if (boardEl && s.board.length) boardEl.innerHTML = cards(s.board, hl);
  const heroEl = sec.querySelector(".hero");
  if (heroEl && s.heroHand) heroEl.innerHTML = `You: ${cards(s.heroHand, hl)}`;
}
function highlightLegend(hl: Highlight): HTMLElement {
  const parts: string[] = [];
  if (hl.made.size) parts.push(`<span class="lg lg-made"></span> your best five`);
  if (hl.draw !== null) parts.push(`<span class="lg lg-draw"></span> your flush draw`);
  return el("div", "hl-legend", parts.join("&nbsp;&nbsp;·&nbsp;&nbsp;"));
}

// ---- shared drill player ----------------------------------------------------
function playDrill(drill: Drill, tagText: string, contLabel: string, onCont: () => void): void {
  const s = drill.state;
  const sec = el("section", "drill");
  sec.append(
    el("div", "tag", tagText),
    el("h2", "title", drill.title),
    el("div", "board", s.board.length ? cards(s.board) : "<em>(preflop)</em>"),
    el("div", "meta", `Pot ${s.pot}${s.toCall !== undefined ? ` · to call ${s.toCall}` : ""}` +
      (s.abstraction.players > 2 ? ` · ${s.abstraction.players}-way` : "")),
    s.heroHand ? el("div", "hero", `You: ${cards(s.heroHand)}`) : el("div"),
    el("div", "vill", villainText(s)),
  );
  if (drill.read) sec.append(el("div", "read", `Read — ${drill.read}`));
  const controls = el("div", "controls");
  buildControls(controls, drill, (resp) => {
    const finish = (): void => {
      let out: ReturnType<typeof gradeDrill>;
      try { out = gradeAndRecord(drill, resp); } catch { return; }
      sec.querySelector(".controls")?.remove();
      const fb = renderFeedback(drill, out, contLabel, onCont);
      const hl = highlightFor(drill);
      if (hl) {
        applyHighlight(sec, drill, hl);
        const btn = fb.querySelector("button");
        if (btn) fb.insertBefore(highlightLegend(hl), btn);
      }
      sec.append(fb);
      (sec.querySelector(".feedback button") as HTMLButtonElement | null)?.focus();
    };
    // A preflop grade enumerates a full 5-card runout (seconds on some devices).
    // Swap the controls for a "Checking…" note and defer, so the UI repaints
    // before the synchronous enumeration blocks the main thread.
    if (drill.state.board.length === 0) {
      (sec.querySelector(".controls") as HTMLElement | null)?.replaceChildren(el("div", "calc", "Checking…"));
      setTimeout(finish, 30);
    } else finish();
  });
  sec.append(controls);
  app.append(sec);
  (sec.querySelector("input") as HTMLInputElement | null)?.focus();
}

function buildControls(controls: HTMLElement, drill: Drill, onAnswer: (r: Response) => void): void {
  if (drill.ask === "estimate") {
    const input = el("input") as HTMLInputElement;
    input.type = "number"; input.min = "0"; input.max = "100"; input.step = "0.01"; input.placeholder = "0.36 or 36 (%)";
    input.id = "ans-estimate"; input.inputMode = "decimal"; input.setAttribute("aria-label", "Your equity estimate");
    const go = el("button", "primary", "Submit");
    const submit = () => {
      let v = Number(input.value);
      if (!Number.isFinite(v) || input.value === "") return;
      if (v > 1) v = v / 100; // values above 1 are read as a percentage (36 -> 0.36)
      onAnswer({ kind: "estimate", value: v });
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); };
    const label = el("label", "prompt", "Your equity estimate:") as HTMLLabelElement;
    label.htmlFor = "ans-estimate";
    controls.append(label, input, go);
  } else if (drill.ask === "outs") {
    const input = el("input") as HTMLInputElement;
    input.type = "number"; input.min = "0"; input.max = "20"; input.step = "1"; input.placeholder = "e.g. 9";
    input.id = "ans-outs"; input.inputMode = "numeric"; input.setAttribute("aria-label", "How many outs");
    const go = el("button", "primary", "Submit");
    const submit = () => { const v = Math.round(Number(input.value)); if (Number.isFinite(v) && input.value !== "") onAnswer({ kind: "outs", value: v }); };
    go.onclick = submit;
    input.onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); };
    const label = el("label", "prompt", "How many outs?") as HTMLLabelElement;
    label.htmlFor = "ans-outs";
    controls.append(label, input, go);
  } else if (drill.ask === "category" || drill.ask === "nuts") {
    const nuts = drill.ask === "nuts";
    controls.append(el("label", "prompt", nuts ? "Best possible hand here (the nuts)?" : "Name your made hand:"));
    const grid = el("div", "cats");
    CATEGORY.forEach((name, i) => {
      const b = el("button", "cat", `${i} · ${name}`);
      b.onclick = () => onAnswer(nuts ? { kind: "nuts", value: i } : { kind: "category", value: i });
      grid.append(b);
    });
    controls.append(grid);
  } else {
    controls.append(el("label", "prompt", "Your action:"));
    const row = el("div", "actions");
    for (const a of legalActions(drill)) {
      const b = el("button", "act", actionLabel(a));
      b.onclick = () => onAnswer({ kind: "action", action: a });
      row.append(b);
    }
    controls.append(row);
  }
}

function gradeAndRecord(drill: Drill, response: Response): ReturnType<typeof gradeDrill> {
  const out = gradeDrill(session, drill.id, response, now());
  session = out.session;
  if (response.kind === "estimate" && out.truth !== undefined) history.samples.push({ estimate: response.value, truth: out.truth });
  history.results.push({ leakTag: out.result.leakTag, regretBb: out.result.regretBb });
  if (!activeDays.includes(now())) activeDays.push(now());
  persist();
  return out;
}

function renderFeedback(drill: Drill, out: ReturnType<typeof gradeDrill>, contLabel: string, onCont: () => void): HTMLElement {
  const r = out.result;
  const ok = r.leakTag.endsWith(".ok");
  const fb = el("div", `feedback ${ok ? "good" : "bad"}`);
  fb.setAttribute("role", "status");        // announce the result to screen readers
  fb.setAttribute("aria-live", "polite");
  let line = "";
  // Reuse the equity gradeDrill already enumerated (out.truth) — never re-enumerate
  // here (a fresh truth() for a preflop drill is another multi-second runout).
  if (drill.ask === "estimate") line = `True equity ${(out.truth ?? truth(drill.state)).toFixed(3)} · error ${(r.estimateError ?? 0).toFixed(3)}`;
  else if (drill.ask === "outs") {
    const t = outs(drill.state.heroHand!, drill.state.board, drill.state.villain.range[0].combo);
    line = r.estimateError === 0 ? `Correct — ${t} outs` : `True outs: ${t} · off by ${r.estimateError}`;
  }
  else if (drill.ask === "category") line = r.estimateError === 0 ? "Correct!" : `Off by ${r.estimateError} categor${r.estimateError === 1 ? "y" : "ies"}`;
  else if (drill.ask === "nuts") {
    const cat = CATEGORY[nutCategory(drill.state.board)];
    line = r.estimateError === 0 ? `Correct — the nuts is a ${cat}` : `The nuts is a ${cat} · off by ${r.estimateError}`;
  }
  else line = r.regretBb <= 1e-9 ? "Optimal." : `Regret ${r.regretBb.toFixed(2)} bb`;
  // The raw leak tag (e.g. "p2.bets_into_strong_range") is internal taxonomy; the
  // EXPLAIN text below carries the actual teaching, so beginners don't see the tag.
  fb.append(el("div", "fb-line", line));
  const why = EXPLAIN[drill.id];
  if (why) fb.append(el("div", "explain", withCardTiles(why)));
  fb.append(el("div", "next-review", `next review in ${out.review.intervalDays}d`));
  const next = el("button", "primary", contLabel);
  next.onclick = onCont;
  fb.append(next);
  return fb;
}

// ---- Stats ------------------------------------------------------------------
function renderStatsView(): void {
  app.append(el("h2", "screen-title", "Your stats"), streakChip());
  const doneCount = MODULES.filter((m) => moduleStatus(m.id, session) === "done").length;
  app.append(el("p", "muted", `Modules completed: ${doneCount} / ${MODULES.length}`));
  app.append(renderStats());
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
    wrap.append(el("div", "leakrow", `${humanLeak(l.leakTag)} · ×${l.count} · ${l.totalRegret.toFixed(2)} bb`));
  return wrap;
}

renderAll();
