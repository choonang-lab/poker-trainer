// Deep cross-validation + perf comparison of the fast score7 vs the reference
// score7slow. Manual (not in the unit suite): node validate-evaluator.ts
import { score7, score7slow } from "./engine.ts";

let seed = 987654321;
const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function draw7(): number[] {
  const p = new Set<number>();
  while (p.size < 7) p.add(Math.floor(rnd() * 52));
  return [...p];
}

const N = 500_000;
const hands: number[][] = [];
for (let i = 0; i < N; i++) hands.push(draw7());

let mism = 0;
for (const h of hands) {
  const a = score7(h), b = score7slow(h);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) mism++;
}
console.log(`cross-check: ${mism} mismatches over ${N} random 7-card hands`);

let t = Date.now();
for (const h of hands) score7(h);
const tf = Date.now() - t;
t = Date.now();
for (const h of hands) score7slow(h);
const ts = Date.now() - t;
console.log(`fast ${tf}ms | slow ${ts}ms | speedup ${(ts / tf).toFixed(1)}x over ${N} evals`);
