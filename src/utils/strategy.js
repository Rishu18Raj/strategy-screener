import Papa from "papaparse";
import { FILTERS, SELECTED_SECTORS } from "../config";

export function parseCSV(text) {
  // Use PapaParse to handle quoted strings and headers natively
  const { data } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  });

  const pct = v => parseFloat((v || "").toString().replace("%", "").replace(",", ""));

  return data.map(obj => ({
    ticker: obj.ticker?.trim(),
    name: obj.name?.trim(),
    sector: obj.sector?.trim(),
    roe: pct(obj.roe),
    revCAGR: pct(obj.revCAGR),
    epsCAGR: pct(obj.epsCAGR),
    pe: pct(obj.pe),
    beta: null,
    betaStatus: "idle",
  })).filter(s => s.ticker);
}

export function passesFundamentals(s){
  return !isNaN(s.roe)&&s.roe>=FILTERS.roe&&!isNaN(s.revCAGR)&&s.revCAGR>=FILTERS.revCAGR&&
         !isNaN(s.epsCAGR)&&s.epsCAGR>=FILTERS.epsCAGR&&!isNaN(s.pe)&&s.pe<=FILTERS.pe;
}
export function getSectorCaps(all){
  const c={};all.forEach(s=>{if(s.sector)c[s.sector]=(c[s.sector]||0)+1;});
  return Object.fromEntries(Object.entries(c).map(([k,v])=>[k,Math.min(3,Math.max(1,Math.floor(0.2*v)))]));
}
export function growthScore(s){return s.pe>0?(s.epsCAGR||0)/s.pe:0;}
export function buildPortfolio(all){
  const caps=getSectorCaps(all);
  const ROUNDS=[[10,20,0],[10,25,1],[9,25,2],[8,25,3],[7,25,4]];
  let fp=0,sp=0,bp=0,portfolio=[],roundUsed=0;
  for(const [eps,pe,rnd] of ROUNDS){
    const fund=all.filter(s=>passesFundamentals({...s,epsCAGR:s.epsCAGR,pe:s.pe})&&s.epsCAGR>=eps&&s.pe<=pe);
    const sec=fund.filter(s=>SELECTED_SECTORS.has(s.sector));
    const bet=sec.filter(s=>s.beta!=null&&s.beta<=FILTERS.beta);
    if(rnd===0){fp=fund.length;sp=sec.length;bp=bet.length;}
    const bySec={};bet.forEach(s=>bySec[s.sector]?bySec[s.sector].push(s):bySec[s.sector]=[s]);
    const cands=[];
    Object.entries(bySec).forEach(([sec,ss])=>{
      const cap=caps[sec]||1;
      [...ss].sort((a,b)=>growthScore(b)-growthScore(a)).slice(0,cap).forEach(s=>cands.push({...s,filter_round:rnd}));
    });
    if(cands.length>=6||rnd===4){portfolio=cands;roundUsed=rnd;break;}
  }
  return {portfolio,fp,sp,bp,roundUsed};
}
export function daysUntil(d){return Math.ceil((d-new Date())/864e5);}
export function fmtDate(d){return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}
export function fmtNum(n,dec=1){return n!=null?`${n>=0?"+":""}${Number(n).toFixed(dec)}%`:"—";}
