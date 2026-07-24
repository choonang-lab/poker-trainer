import { hand, equityVsRange, rankOf, suitOf } from "./engine.ts";
function rangeVsRange(heroRange:any[], villRange:any[], board:number[]) {
  let total=0,w=0;
  for (const h of heroRange) {
    if (h.combo.some((c:number)=>board.includes(c))) continue;
    const vr = villRange.filter((v:any)=>!v.combo.some((c:number)=>board.includes(c)||h.combo.includes(c)));
    const e = equityVsRange(h.combo, board, vr);
    if (e===null) continue;
    total+=h.weight*e; w+=h.weight;
  }
  return total/w;
}
const R=(l:[string,string][])=>l.map(([a,b])=>({combo:hand(a,b),weight:1}));
// Hero = strong preflop raiser; Villain = medium caller.
const hero = R([["Ah","Ad"],["Kh","Kd"],["Qh","Qd"],["As","Ks"],["As","Qs"],["As","Js"]]);
const vill = R([["Jh","Jc"],["Th","Tc"],["9h","9c"],["Ac","Qd"],["Kc","Qh"],["Js","Ts"],["Td","9d"]]);
const b=(...c:string[])=>hand(...c);
console.log("A-K-5 rainbow (high, dry):", rangeVsRange(hero,vill,b("Ac","Kd","5h")).toFixed(4));
console.log("7-6-5 rainbow (low, connected):", rangeVsRange(hero,vill,b("7c","6d","5h")).toFixed(4));
console.log("Q-7-2 rainbow (high card, dry):", rangeVsRange(hero,vill,b("Qc","7d","2h")).toFixed(4));
console.log("J-T-9 (coordinated, hits caller):", rangeVsRange(hero,vill,b("Jc","Td","9h")).toFixed(4));
console.log("A-A-4 (paired, hits raiser):", rangeVsRange(hero,vill,b("Ac","Ad","4h")).toFixed(4));
console.log("8-5-2 rainbow (low, dry blank):", rangeVsRange(hero,vill,b("8c","5d","2h")).toFixed(4));
