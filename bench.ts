import { equity, hand } from "./engine.ts";
const t = Date.now();
// AA vs KK preflop: published ~82% for the favorite. Full enumeration C(48,5)=1.7M.
const e = equity(hand("As", "Ah"), [], hand("Ks", "Kh"));
console.log(`AA vs KK preflop hero equity = ${(e * 100).toFixed(2)}%  (published ~82%)`);
console.log(`enumerated in ${((Date.now() - t) / 1000).toFixed(1)}s`);
