import { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import Papa from "papaparse"; 

// ── strategy config ───────────────────────────────────────────
const SELECTED_SECTORS = new Set([
  "Banks","Financial Services","Media Entertainment & Publication",
  "Information Technology","Telecommunication","Capital Goods",
  "Construction","Consumer Services","Chemicals",
  "Oil Gas & Consumable Fuels","Power","Textiles",
]);

const FILTERS = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };
const LAST_REBALANCE = new Date("2026-06-25");
const NEXT_REBALANCE = new Date("2026-09-25");
const DATA_QUARTER   = "Q4 FY26";

const BASE = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data";
const URLS = {
  fundamentals:     `${BASE}/fundamentals.csv`,
  betas:            `${BASE}/betas.json`,
  perfSummary:      `${BASE}/performance_summary.json`,
  nav:              `${BASE}/nav.json`,
  tradeLog:         `${BASE}/trade_log.json`,
  portfolioCurrent: `${BASE}/portfolio_current.json`,
};

// historical portfolio URLs by label
const PORTFOLIO_SNAPSHOTS = [
  {label:"Jun 2024", year:"2024", month:"Jun", file:"portfolio_2024Q2.json"},
  {label:"Sep 2024", year:"2024", month:"Sep", file:"portfolio_2024Q3.json"},
  {label:"Dec 2024", year:"2024", month:"Dec", file:"portfolio_2024Q4.json"},
  {label:"Mar 2025", year:"2025", month:"Mar", file:"portfolio_2025Q1.json"},
  {label:"Jun 2025", year:"2025", month:"Jun", file:"portfolio_2025Q2.json"},
  {label:"Sep 2025", year:"2025", month:"Sep", file:"portfolio_2025Q3.json"},
  {label:"Dec 2025", year:"2025", month:"Dec", file:"portfolio_2025Q4.json"},
  {label:"Mar 2026", year:"2026", month:"Mar", file:"portfolio_2026Q1.json"},
  {label:"Jun 2026", year:"2026", month:"Jun", file:"portfolio_2026Q2.json"},
];

const REBALANCE_DATES = new Set([
  "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
  "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]);

const TABS = [
  {id:"overview",    label:"Overview"},
  {id:"performance", label:"Portfolio Performance"},
  {id:"explore",     label:"Build & Test"},
  {id:"resources",   label:"Resources"},
];

const SECTOR_COLORS = {
  "Financial Services":"#3b82f6","Diversified":"#6366f1","Capital Goods":"#8b5cf6",
  "Construction Materials":"#a78bfa","Power":"#f59e0b","Banks":"#06b6d4",
  "Fast Moving Consumer Goods":"#10b981","Chemicals":"#14b8a6","Healthcare":"#22c55e",
  "Metals & Mining":"#84cc16","Services":"#eab308","Oil Gas & Consumable Fuels":"#f97316",
  "Consumer Services":"#ef4444","Realty":"#ec4899","Construction":"#d946ef",
  "Information Technology":"#e11d48","Automobile and Auto Components":"#fb7185",
  "Consumer Durables":"#fbbf24","Telecommunication":"#34d399","Textiles":"#a3e635",
  "Media Entertainment & Publication":"#f43f5e",
};

// ── helpers ───────────────────────────────────────────────────
function parseCSV(text) {
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

function passesFundamentals(s){
  return !isNaN(s.roe)&&s.roe>=FILTERS.roe&&!isNaN(s.revCAGR)&&s.revCAGR>=FILTERS.revCAGR&&
         !isNaN(s.epsCAGR)&&s.epsCAGR>=FILTERS.epsCAGR&&!isNaN(s.pe)&&s.pe<=FILTERS.pe;
}
function getSectorCaps(all){
  const c={};all.forEach(s=>{if(s.sector)c[s.sector]=(c[s.sector]||0)+1;});
  return Object.fromEntries(Object.entries(c).map(([k,v])=>[k,Math.min(3,Math.max(1,Math.floor(0.2*v)))]));
}
function growthScore(s){return s.pe>0?(s.epsCAGR||0)/s.pe:0;}
function buildPortfolio(all){
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
function daysUntil(d){return Math.ceil((d-new Date())/864e5);}
function fmtDate(d){return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}
function fmtNum(n,dec=1){return n!=null?`${n>=0?"+":""}${Number(n).toFixed(dec)}%`:"—";}

// ── design tokens ─────────────────────────────────────────────
const C={
  bg:"var(--bg)",card:"var(--bg-card)",hover:"var(--bg-hover)",
  border:"var(--border)",subtle:"var(--border-subtle)",
  primary:"var(--text-primary)",secondary:"var(--text-secondary)",muted:"var(--text-muted)",
  accent:"var(--accent)",accentDim:"var(--accent-dim)",
  green:"var(--green)",greenDim:"var(--green-dim)",
  red:"var(--red)",redDim:"var(--red-dim)",
  amber:"var(--amber)",amberDim:"var(--amber-dim)",
};

// ── shared primitives ─────────────────────────────────────────
const pill=(bg,color,label)=>(
  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:bg,color,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{label}</span>
);

function StatCard({label,value,sub,color,warn,small}){
  return(
    <div style={{background:C.card,borderRadius:8,padding:small?"12px 14px":"16px 18px",border:`0.5px solid ${warn?C.amber:C.border}`}}>
      <div style={{fontSize:10,color:C.secondary,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>{label}</div>
      <div style={{fontSize:small?18:24,fontWeight:700,color:color||C.primary,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:C.secondary,marginTop:5,lineHeight:1.4}}>{sub}</div>}
    </div>
  );
}

function DonutChart({data,size=120}){
  const total=data.reduce((s,d)=>s+d.count,0);
  if(!total)return null;
  let a=-Math.PI/2;
  const cx=size/2,cy=size/2,r=size*.38,ri=size*.23;
  return(
    <svg width={size} height={size} style={{flexShrink:0}}>
      {data.map((d,i)=>{
        const sw=(d.count/total)*2*Math.PI;
        const x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a);a+=sw;
        const x2=cx+r*Math.cos(a),y2=cy+r*Math.sin(a);
        const xi1=cx+ri*Math.cos(a-sw),yi1=cy+ri*Math.sin(a-sw);
        const xi2=cx+ri*Math.cos(a),yi2=cy+ri*Math.sin(a);
        const lg=sw>Math.PI?1:0;
        return <path key={i} d={`M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${lg},0 ${xi1},${yi1} Z`} fill={d.color} opacity={0.85}/>;
      })}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight="700" fill={C.primary}>{total}</text>
      <text x={cx} y={cy+15} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={C.secondary} letterSpacing="0.05em">STOCKS</text>
    </svg>
  );
}

function FunnelBar({label,count,total,color}){
  const pct=total>0?(count/total)*100:0;
  return(
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.secondary,marginBottom:4}}>
        <span>{label}</span>
        <span style={{fontFamily:"var(--font-mono)",fontWeight:600,color:C.primary}}>{count.toLocaleString()}</span>
      </div>
      <div style={{height:4,borderRadius:2,background:C.border}}>
        <div style={{width:`${pct}%`,height:"100%",borderRadius:2,background:color,transition:"width 0.4s ease"}}/>
      </div>
    </div>
  );
}

function ComingSoon({title,description,items}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"55vh",gap:20,textAlign:"center",padding:"60px 24px"}}>
      <div style={{width:48,height:48,borderRadius:12,background:C.card,border:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.secondary}}>◈</div>
      <div>
        <div style={{fontSize:19,fontWeight:600,marginBottom:8,letterSpacing:"-0.01em"}}>{title}</div>
        <div style={{fontSize:14,color:C.secondary,maxWidth:460,lineHeight:1.7}}>{description}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,width:"100%",maxWidth:380}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",background:C.card,borderRadius:6,border:`0.5px solid ${C.border}`,textAlign:"left"}}>
            <div style={{width:4,height:4,borderRadius:"50%",background:C.muted,flexShrink:0}}/>
            <div style={{fontSize:13,color:C.secondary}}>{item}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,letterSpacing:"0.04em",textTransform:"uppercase"}}>In development</div>
    </div>
  );
}

// ── sidebar ───────────────────────────────────────────────────
function Sidebar({collapsed,onToggle,perf}){
  const d=daysUntil(NEXT_REBALANCE);
  return(
    <div style={{position:"relative",flexShrink:0,width:collapsed?0:210,transition:"width 0.25s ease"}}>
      <div style={{position:"absolute",top:0,left:0,bottom:0,width:210,borderRight:`0.5px solid ${C.border}`,background:C.bg,overflowY:"auto",overflowX:"hidden",transform:collapsed?"translateX(-100%)":"translateX(0)",transition:"transform 0.25s ease",display:"flex",flexDirection:"column",gap:24,padding:"24px 18px"}}>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Rebalance</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Last</div>
              <div style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(LAST_REBALANCE)}</div>
            </div>
            <div style={{background:d<=14?C.amberDim:C.card,border:`0.5px solid ${d<=14?C.amber:C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Next</div>
              <div style={{fontSize:12,fontWeight:600,color:d<=14?C.amber:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(NEXT_REBALANCE)}</div>
              <div style={{fontSize:11,color:C.secondary,marginTop:2}}>{d>0?`${d}d away`:"Due now"}</div>
            </div>
          </div>
        </div>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Live track record</div>
          {[
            {label:"Total return",  value:perf?`${perf.returns.total_pct>0?"+":""}${perf.returns.total_pct}%`:"—"},
            {label:"Ann. return",   value:perf?`${perf.returns.annualised_pct>0?"+":""}${perf.returns.annualised_pct}%`:"—"},
            {label:"Alpha (ann)",   value:perf?`${perf.returns.alpha_ann>0?"+":""}${perf.returns.alpha_ann}%`:"—"},
            {label:"Sharpe",        value:perf?perf.risk.sharpe:"—"},
            {label:"Sortino",       value:perf?perf.risk.sortino:"—"},
            {label:"Info Ratio",    value:perf?perf.risk.info_ratio:"—"},
            {label:"Win rate",      value:perf?`${perf.trades.win_rate_pct}%`:"—"},
            {label:"Benchmark",     value:"SENSEX"},
          ].map(({label,value})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}}>
              <span style={{fontSize:11,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{marginTop:"auto"}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,fontWeight:500}}>About</div>
          <div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>IIMB MBA · Deutsche Bank IB alumni · Built for hobby investors who want institutional-grade equity screening.</div>
        </div>
      </div>
      <button onClick={onToggle} style={{position:"absolute",top:"50%",right:-14,transform:"translateY(-50%)",width:14,height:40,border:`0.5px solid ${C.border}`,borderLeft:"none",background:C.bg,color:C.secondary,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"0 6px 6px 0",fontSize:10,zIndex:10,padding:0}} onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
        {collapsed?"›":"‹"}
      </button>
    </div>
  );
}

// ── custom tooltip for NAV chart ──────────────────────────────
function NavTooltip({active,payload,label}){
  if(!active||!payload||!payload.length)return null;
  const port=payload.find(p=>p.dataKey==="portfolio_nav");
  const sens=payload.find(p=>p.dataKey==="sensex_nav");
  return(
    <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 14px",fontSize:12}}>
      <div style={{color:C.secondary,marginBottom:6,fontFamily:"var(--font-mono)"}}>{label}</div>
      {port&&<div style={{color:C.green,fontWeight:600}}>Portfolio  ₹{port.value?.toFixed(2)}</div>}
      {sens&&<div style={{color:C.secondary}}>SENSEX     ₹{sens.value?.toFixed(2)}</div>}
    </div>
  );
}

// ── performance tab ───────────────────────────────────────────
function PerformanceTab({perf,nav,trades}){
  const [tradeFilter,setTradeFilter]=useState("all");
  const [tradeSortKey,setTradeSortKey]=useState("entry_date");
  const [tradeSortDir,setTradeSortDir]=useState(-1);

  if(!perf||!nav||!trades){
    return(
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:C.secondary,fontSize:14}}>
        Loading performance data...
      </div>
    );
  }

  const {returns,risk,trades:tradeStats,quarterly_returns,period}=perf;

// ── NAV chart: deduplicate dates and subsample ────────────────
  const navChart = useMemo(()=>{
    const seen = new Set();
    return nav
      .filter(d=>{ if(seen.has(d.date))return false; seen.add(d.date); return true; })
      .filter((_,i,arr)=>i%3===0||i===arr.length-1)
      .map(d=>({
        date:      d.date.slice(5),
        full_date: d.date,
        portfolio_nav: +d.portfolio_nav,
        sensex_nav:    +d.sensex_nav,
      }));
  },[nav]);

  // ── filtered & sorted trades ──
  const filteredTrades=useMemo(()=>{
    let t=[...trades];
    if(tradeFilter==="closed") t=t.filter(x=>x.status==="closed");
    if(tradeFilter==="open")   t=t.filter(x=>x.status==="open");
    if(tradeFilter==="intra")  t=t.filter(x=>x.exit_type==="intra_quarter");
    const key=tradeSortKey;
    t.sort((a,b)=>{
      const av=a[key]??-999, bv=b[key]??-999;
      return tradeSortDir*(av>bv?1:-1);
    });
    return t;
  },[trades,tradeFilter,tradeSortKey,tradeSortDir]);

  const toggleTradeSort=k=>{
    if(tradeSortKey===k)setTradeSortDir(d=>-d);
    else{setTradeSortKey(k);setTradeSortDir(-1);}
  };

  const TH=({label,k,right})=>(
    <th onClick={()=>toggleTradeSort(k)} style={{padding:"8px 12px",cursor:"pointer",fontWeight:500,fontSize:11,color:C.secondary,textAlign:right?"right":"left",whiteSpace:"nowrap",userSelect:"none",background:C.hover,letterSpacing:"0.05em",textTransform:"uppercase"}}>
      {label}{tradeSortKey===k?(tradeSortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  const sectionLabel={fontSize:11,fontWeight:600,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:14};

  return(
    <div>
      {/* ── hero metrics ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginBottom:24}}>
        <StatCard label="Total return"   value={`${returns.total_pct>0?"+":""}${returns.total_pct}%`} sub={`SENSEX ${returns.sensex_total>0?"+":""}${returns.sensex_total}%`} color={C.green}/>
        <StatCard label="Ann. return"    value={`${returns.annualised_pct>0?"+":""}${returns.annualised_pct}%`} sub={`SENSEX ${returns.sensex_ann>0?"+":""}${returns.sensex_ann}%`} color={C.green}/>
        <StatCard label="Alpha (ann)"    value={`${returns.alpha_ann>0?"+":""}${returns.alpha_ann}%`} sub="vs SENSEX" color={returns.alpha_ann>0?C.green:C.red}/>
        <StatCard label="Sharpe ratio"   value={risk.sharpe} sub="Risk-adj return" color={C.accent}/>
        <StatCard label="Max drawdown"   value={`-${risk.max_drawdown_pct}%`} sub={`${risk.drawdown_start} → ${risk.drawdown_end}`} color={C.red}/>
        <StatCard label="Win rate"       value={`${tradeStats.win_rate_pct}%`} sub={`${tradeStats.total_closed} closed trades`} color={C.amber}/>
      </div>

      {/* ── NAV chart ── */}
      <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px",marginBottom:14}}>
        <div style={sectionLabel}>NAV — portfolio vs SENSEX (₹100 invested 25 Jun 2024)</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={navChart} margin={{top:4,right:16,left:0,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
            <XAxis dataKey="date" tick={{fontSize:10,fill:C.secondary}} tickLine={false} axisLine={false} interval={Math.floor(navChart.length/8)}/>
            <YAxis tick={{fontSize:10,fill:C.secondary}} tickLine={false} axisLine={false} tickFormatter={v=>`₹${v.toFixed(0)}`} width={48}/>
            <Tooltip content={<NavTooltip/>}/>
            <Legend wrapperStyle={{fontSize:12,color:C.secondary,paddingTop:8}}/>
            {REBALANCE_DATES&&[...REBALANCE_DATES].map(d=>(
              <ReferenceLine key={d} x={d.slice(5)} stroke={C.muted} strokeDasharray="3 3" strokeWidth={1}/>
            ))}
            <Line type="monotone" dataKey="portfolio_nav" name="Portfolio" stroke={C.green} strokeWidth={2} dot={false} activeDot={{r:4,fill:C.green}}/>
            <Line type="monotone" dataKey="sensex_nav"    name="SENSEX"    stroke={C.secondary} strokeWidth={1.5} dot={false} strokeDasharray="4 2"/>
          </LineChart>
        </ResponsiveContainer>
        <div style={{fontSize:11,color:C.muted,marginTop:8}}>Dotted vertical lines = rebalance dates · Portfolio includes 6% overnight rate on idle cash from intra-quarter exits</div>
      </div>

      {/* ── quarterly returns ── */}
      <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px",marginBottom:14}}>
        <div style={sectionLabel}>Quarterly active returns</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={quarterly_returns} margin={{top:4,right:16,left:0,bottom:4}} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
            <XAxis dataKey="label" tick={{fontSize:11,fill:C.secondary}} tickLine={false} axisLine={false}/>
            <YAxis tick={{fontSize:10,fill:C.secondary}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} width={40}/>
            <Tooltip formatter={(v,n)=>[`${v>0?"+":""}${v}%`,n]} contentStyle={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,fontSize:12}}/>
            <Legend wrapperStyle={{fontSize:12,color:C.secondary,paddingTop:8}}/>
            <ReferenceLine y={0} stroke={C.border} strokeWidth={1}/>
            <Bar dataKey="portfolio_ret" name="Portfolio" radius={[3,3,0,0]}>
              {quarterly_returns.map((q,i)=>(
                <Cell key={i} fill={q.portfolio_ret>=0?C.green:C.red} fillOpacity={0.85}/>
              ))}
            </Bar>
            <Bar dataKey="sensex_ret" name="SENSEX" fill={C.secondary} fillOpacity={0.4} radius={[3,3,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── risk metrics + trade stats ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>

        {/* risk metrics */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={sectionLabel}>Risk metrics</div>
          {[
            {label:"Sharpe ratio",    value:risk.sharpe,        tip:"Return per unit of total risk"},
            {label:"Sortino ratio",   value:risk.sortino,       tip:"Return per unit of downside risk"},
            {label:"Treynor ratio",   value:`${risk.treynor}%`, tip:"Excess return per unit of market risk (β)"},
            {label:"Jensen Alpha",    value:`${risk.jensen_alpha>0?"+":""}${risk.jensen_alpha}%`, tip:"CAPM-adjusted excess return"},
            {label:"Info ratio",      value:risk.info_ratio,    tip:"Active return / tracking error"},
            {label:"Tracking error",  value:`${risk.tracking_error}%`, tip:"Annualised std dev of active returns"},
            {label:"Beta",            value:risk.beta,          tip:"Sensitivity to SENSEX moves"},
            {label:"Correlation",     value:risk.correlation,   tip:"Correlation with SENSEX"},
            {label:"Max drawdown",    value:`-${risk.max_drawdown_pct}%`, tip:`${risk.drawdown_start} → ${risk.drawdown_end}`},
          ].map(({label,value,tip})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}} title={tip}>
              <span style={{fontSize:12,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>

        {/* trade stats */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={sectionLabel}>Trade statistics</div>
          {[
            {label:"Closed trades",     value:tradeStats.total_closed},
            {label:"Open positions",    value:tradeStats.total_open},
            {label:"Intra-qtr exits",   value:tradeStats.intra_quarter},
            {label:"Rebalance exits",   value:tradeStats.rebalance_exits},
            {label:"Win rate",          value:`${tradeStats.win_rate_pct}%`},
            {label:"Avg return",        value:`${tradeStats.avg_return_pct>0?"+":""}${tradeStats.avg_return_pct}%`},
            {label:"Avg winner",        value:`+${tradeStats.avg_winner_pct}%`},
            {label:"Avg loser",         value:`${tradeStats.avg_loser_pct}%`},
            {label:"Avg alpha",         value:`${tradeStats.avg_alpha_pct>0?"+":""}${tradeStats.avg_alpha_pct}%`},
            {label:"Avg hold (days)",   value:tradeStats.avg_hold_days},
            {label:"Best trade",        value:`${tradeStats.best_trade?.ticker}  ${tradeStats.best_trade?.return_pct>0?"+":""}${tradeStats.best_trade?.return_pct}%`},
            {label:"Worst trade",       value:`${tradeStats.worst_trade?.ticker}  ${tradeStats.worst_trade?.return_pct}%`},
          ].map(({label,value})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}}>
              <span style={{fontSize:12,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── trade log ── */}
      <div style={{marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={sectionLabel}>Trade log</div>
        <div style={{display:"flex",gap:6}}>
          {[["all","All"],["closed","Closed"],["open","Open"],["intra","Intra-qtr"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTradeFilter(k)}
              style={{padding:"4px 12px",borderRadius:99,border:`0.5px solid ${tradeFilter===k?C.accent:C.border}`,background:tradeFilter===k?C.accentDim:"transparent",color:tradeFilter===k?C.accent:C.secondary,fontSize:12,cursor:"pointer",fontFamily:"Inter,sans-serif"}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{overflowX:"auto",border:`0.5px solid ${C.border}`,borderRadius:8}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>
            <TH label="Ticker"     k="ticker"/>
            <TH label="Sector"     k="sector"/>
            <TH label="Entry"      k="entry_date"/>
            <TH label="Exit"       k="exit_date"/>
            <TH label="Days"       k="holding_days" right/>
            <TH label="Return"     k="abs_return_pct" right/>
            <TH label="Ann ret"    k="ann_return_pct" right/>
            <TH label="Alpha"      k="alpha_abs" right/>
            <TH label="Type"       k="exit_type"/>
            <TH label="Status"     k="status"/>
          </tr></thead>
          <tbody>
            {filteredTrades.map((t,i)=>{
              const ret=t.abs_return_pct;
              const pos=ret==null||ret>=0;
              return(
                <tr key={i} style={{borderTop:`0.5px solid ${C.subtle}`,background:i%2===0?"transparent":C.card+"44"}}>
                  <td style={{padding:"9px 12px",fontWeight:600,fontFamily:"var(--font-mono)",fontSize:11}}>{t.ticker}</td>
                  <td style={{padding:"9px 12px"}}>
                    <span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:(SECTOR_COLORS[t.sector]||C.accent)+"18",color:SECTOR_COLORS[t.sector]||C.accent,whiteSpace:"nowrap"}}>{t.sector?.split(" ")[0]}</span>
                  </td>
                  <td style={{padding:"9px 12px",color:C.secondary,fontFamily:"var(--font-mono)",fontSize:11}}>{t.entry_date||"—"}</td>
                  <td style={{padding:"9px 12px",color:C.secondary,fontFamily:"var(--font-mono)",fontSize:11}}>{t.exit_date||"—"}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",color:C.secondary,fontFamily:"var(--font-mono)",fontSize:11}}>{t.holding_days??"—"}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",fontWeight:600,fontFamily:"var(--font-mono)",fontSize:11,color:pos?C.green:C.red}}>
                    {ret!=null?`${ret>0?"+":""}${ret}%`:"—"}
                  </td>
                  <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:pos?C.green:C.red}}>
                    {t.ann_return_pct!=null?`${t.ann_return_pct>0?"+":""}${t.ann_return_pct}%`:"—"}
                  </td>
                  <td style={{padding:"9px 12px",textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:t.alpha_abs>=0?C.green:C.red}}>
                    {t.alpha_abs!=null?`${t.alpha_abs>0?"+":""}${t.alpha_abs}%`:"—"}
                  </td>
                  <td style={{padding:"9px 12px"}}>
                    {t.exit_type==="intra_quarter"
                      ? pill(C.amberDim,C.amber,"intra-qtr")
                      : t.status==="open"
                        ? pill(C.accentDim,C.accent,"open")
                        : pill(C.hover,C.secondary,"rebalance")}
                  </td>
                  <td style={{padding:"9px 12px"}}>
                    {pill(t.status==="open"?C.accentDim:t.abs_return_pct>=0?C.greenDim:C.redDim,
                          t.status==="open"?C.accent:t.abs_return_pct>=0?C.green:C.red,
                          t.status==="open"?"open":"closed")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredTrades.length===0&&<div style={{padding:"40px",textAlign:"center",color:C.muted,fontSize:13}}>No trades match filter.</div>}
      </div>
      <div style={{marginTop:10,fontSize:11,color:C.muted}}>Click column headers to sort · Filter by trade type above · Alpha = return minus SENSEX return over same period</div>
    </div>
  );
}

// ── overview tab ──────────────────────────────────────────────
function OverviewTab({stocks,betaStatus,perf}){
  const [sortKey,setSortKey]=useState("roe");
  const [sortDir,setSortDir]=useState(-1);
  const allSectors=useMemo(()=>[...new Set(stocks.map(s=>s.sector).filter(Boolean))].sort(),[stocks]);
  const {portfolio,fp,sp,bp}=useMemo(()=>stocks.length>0?buildPortfolio(stocks):{portfolio:[],fp:0,sp:0,bp:0},[stocks]);
  const sectorAlloc=useMemo(()=>{
    const map={};
    portfolio.forEach(s=>{if(!map[s.sector])map[s.sector]={sector:s.sector,count:0,color:SECTOR_COLORS[s.sector]||C.accent};map[s.sector].count++;});
    return Object.values(map).sort((a,b)=>b.count-a.count);
  },[portfolio]);
  const displayed=useMemo(()=>{
    const key=sortKey==="beta"?(s=>s.beta??999):sortKey==="gp"?(s=>growthScore(s)):(s=>s[sortKey]);
    return [...portfolio].sort((a,b)=>sortDir*(key(a)>key(b)?1:-1));
  },[portfolio,sortKey,sortDir]);
  const toggleSort=k=>{if(sortKey===k)setSortDir(d=>-d);else{setSortKey(k);setSortDir(-1);}};
  const Th=({label,k,right})=>(
    <th onClick={()=>toggleSort(k)} style={{padding:"9px 12px",cursor:"pointer",fontWeight:500,fontSize:11,color:C.secondary,textAlign:right?"right":"left",whiteSpace:"nowrap",userSelect:"none",background:C.hover,letterSpacing:"0.05em",textTransform:"uppercase"}}>
      {label}{sortKey===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  // dynamic stats from perf if available, else fallback
  const sharpe   = perf?.risk?.sharpe        ?? "1.53";
  const totalRet = perf?.returns?.total_pct   != null ? `${perf.returns.total_pct>0?"+":""}${perf.returns.total_pct}%` : "+76.0%";
  const alpha    = perf?.returns?.alpha_ann    != null ? `${perf.returns.alpha_ann>0?"+":""}${perf.returns.alpha_ann}%` : "+33.3%";

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:24}}>
        <StatCard label="Universe"         value={stocks.length.toLocaleString()} sub="Nifty 500 stocks"/>
        <StatCard label="Pass fundamental" value={fp} sub="RoE · CAGR · P/E filters" color={C.accent}/>
        <StatCard label="Sectors selected" value={`${SELECTED_SECTORS.size} of ${allSectors.length}`} sub="Active sector conviction"/>
        <StatCard label="Pass beta filter" value={bp} sub="β ≤ 1.2 in target sectors" color="#f97316"/>
        <StatCard label="In portfolio"     value={portfolio.length} sub="After sector cap" color={C.green}/>
        <StatCard label="Next rebalance"   value={fmtDate(NEXT_REBALANCE)}
          sub={daysUntil(NEXT_REBALANCE)>0?`${daysUntil(NEXT_REBALANCE)} days away`:"Due now"}
          color={daysUntil(NEXT_REBALANCE)<=14?C.amber:C.primary} warn={daysUntil(NEXT_REBALANCE)<=14}/>
      </div>

      {/* live perf strip */}
      {perf&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
          <StatCard label="Live total return" value={totalRet} sub={`Since 25 Jun 2024 · SENSEX ${perf.returns.sensex_total>0?"+":""}${perf.returns.sensex_total}%`} color={C.green} small/>
          <StatCard label="Alpha (ann)"       value={alpha}    sub="vs SENSEX annualised" color={C.green} small/>
          <StatCard label="Sharpe ratio"      value={sharpe}   sub="Risk-adjusted return" color={C.accent} small/>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>Selection funnel</div>
          <FunnelBar label="Nifty 500 universe"           count={stocks.length} total={stocks.length} color={C.accent}/>
          <FunnelBar label="Pass fundamental criteria"    count={fp}            total={stocks.length} color="#8b5cf6"/>
          <FunnelBar label="In target sectors"            count={sp}            total={stocks.length} color={C.amber}/>
          <FunnelBar label="Pass beta filter (β ≤ 1.2)"  count={bp}            total={stocks.length} color="#f97316"/>
          <FunnelBar label="Final portfolio (sector cap)" count={portfolio.length} total={stocks.length} color={C.green}/>
          <div style={{marginTop:14,paddingTop:12,borderTop:`0.5px solid ${C.subtle}`,fontSize:11,color:C.muted}}>
            RoE ≥ 13% · Rev CAGR ≥ 7% · EPS CAGR ≥ 10% · P/E ≤ 20x · Beta ≤ 1.2 · Sector cap: min(3, max(1, ⌊20% × sector size⌋))
          </div>
        </div>
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>Sector allocation · Equal weight</div>
          <div style={{display:"flex",gap:20,alignItems:"center"}}>
            <DonutChart data={sectorAlloc} size={110}/>
            <div style={{flex:1}}>
              {sectorAlloc.map(s=>{
                const alloc=portfolio.length>0?((s.count/portfolio.length)*100).toFixed(1):"0.0";
                return(
                  <div key={s.sector} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",marginBottom:2}}>
                    <div style={{width:7,height:7,borderRadius:2,background:s.color,flexShrink:0}}/>
                    <div style={{flex:1,fontSize:12,color:C.secondary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.sector}</div>
                    <div style={{fontSize:11,color:C.muted,minWidth:28}}>{s.count}</div>
                    <div style={{width:48,height:3,borderRadius:2,background:C.border}}><div style={{width:`${alloc}%`,height:"100%",borderRadius:2,background:s.color}}/></div>
                    <div style={{fontSize:11,color:C.secondary,minWidth:32,textAlign:"right"}}>{alloc}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{fontSize:11,fontWeight:600,marginBottom:10,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>
        Current portfolio · {portfolio.length} stocks
        {betaStatus!=="ok"&&<span style={{marginLeft:10,color:C.amber,fontWeight:400,textTransform:"none",fontSize:11}}>⚠ Betas loading</span>}
      </div>
      <div style={{overflowX:"auto",border:`0.5px solid ${C.border}`,borderRadius:8}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr>
            <Th label="Ticker" k="ticker"/><Th label="Company" k="name"/><Th label="Sector" k="sector"/>
            <Th label="RoE %" k="roe" right/><Th label="Rev CAGR" k="revCAGR" right/>
            <Th label="EPS CAGR" k="epsCAGR" right/><Th label="Beta ⚡" k="beta" right/>
            <Th label="P/E" k="pe" right/><Th label="G/P Score" k="gp" right/>
          </tr></thead>
          <tbody>
            {displayed.length===0?(
              <tr><td colSpan={9} style={{padding:"40px",textAlign:"center",color:C.muted,fontSize:13}}>
                {betaStatus==="loading"?"Computing portfolio...":"No stocks pass all filters."}
              </td></tr>
            ):displayed.map((s,i)=>(
              <tr key={s.ticker} style={{borderTop:`0.5px solid ${C.subtle}`,background:i%2===0?"transparent":C.card+"44"}}>
                <td style={{padding:"10px 12px",fontWeight:600,fontFamily:"var(--font-mono)",fontSize:12,color:C.primary}}>{s.ticker}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:C.secondary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{s.name}</td>
                <td style={{padding:"10px 12px"}}><span style={{fontSize:11,padding:"2px 7px",borderRadius:4,fontWeight:500,background:(SECTOR_COLORS[s.sector]||C.accent)+"18",color:SECTOR_COLORS[s.sector]||C.accent,whiteSpace:"nowrap"}}>{s.sector}</span></td>
                {[{v:s.roe.toFixed(1)+"%"},{v:s.revCAGR.toFixed(1)+"%"},{v:s.epsCAGR.toFixed(1)+"%"},{v:(s.beta??0).toFixed(2)},{v:s.pe.toFixed(1)+"x"},{v:growthScore(s).toFixed(2)}].map((cell,ci)=>(
                  <td key={ci} style={{padding:"10px 12px",textAlign:"right",color:C.primary,fontFamily:"var(--font-mono)",fontSize:12}}>{cell.v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:12,color:C.muted}}>All stocks pass RoE ≥ 13% · Rev CAGR ≥ 7% · EPS CAGR ≥ 10% · P/E ≤ 20x · Beta ≤ 1.2 · in target sectors</div>
    </div>
  );
}

// ── resources tab (inline — same content as before) ───────────
const METRICS=[
  {name:"Return on Equity",threshold:"RoE ≥ 13%",tagline:"What is the business actually earning for its equity investors?",why:"RoE is the most honest measure of business quality. A company's share price is ultimately a derived outcome of what the underlying business earns on the capital entrusted to it by equity investors. High RoE signals that management is deploying capital effectively and generating real value — not just growing revenue on paper.",detail:"The 13% threshold approximates the cost of equity in India — the minimum return an investor should expect for the risk of holding a stock. A company earning below this hurdle rate is destroying shareholder value even if it appears profitable. We only want companies genuinely earning above this bar."},
  {name:"Revenue CAGR",threshold:"Rev CAGR ≥ 7%",tagline:"Is the core business actually growing?",why:"Revenue growth is the foundation of everything else. A company can temporarily improve margins, but sustainable earnings growth must be supported by a growing top line. We want businesses expanding their operations, not just optimising an existing one.",detail:"The 7% threshold corresponds to India's nominal GDP growth rate. Any company growing slower than the economy is losing market share in real terms. This floor ensures every stock in the portfolio is, at minimum, keeping pace with the expanding economy."},
  {name:"EPS CAGR",threshold:"EPS CAGR ≥ 10%",tagline:"Are profits growing — not just revenues?",why:"Revenue growth alone is insufficient. A business can grow its top line while profits erode if costs rise faster. EPS growth ensures the growth is profitable and that shareholders are actually better off. This separates genuine compounders from revenue-chasing businesses.",detail:"The 10% EPS growth can be achieved two ways — both valid. First: high revenue growth at stable margins. Second: moderate revenue growth with improving net profit margins. We don't distinguish between paths — what matters is that EPS compounds at ≥10%."},
  {name:"Price-to-Earnings",threshold:"P/E ≤ 20x",tagline:"Are we paying a fair price for these earnings?",why:"This is where the mispricing thesis lives. A company can have exceptional fundamentals and still be a poor investment if you overpay. A low P/E on a fundamentally strong company signals the market has undervalued it.",detail:"Markets frequently misprice strong companies in out-of-favour sectors: PSU banks dismissed as structurally weak, energy companies written off as value traps. These mispricings correct over time. Combining P/E ≤ 20x with strong RoE and growth filters systematically hunts for quality at a discount."},
  {name:"Beta",threshold:"Beta ≤ 1.2",tagline:"How volatile is this stock relative to the market?",why:"Beta measures how much a stock moves relative to the broader market. A beta of 1.0 means it tracks the index. A beta of 1.5 amplifies market moves by 50% in both directions. We want a portfolio that broadly tracks the market's risk level.",detail:"The 1.2 cap allows for slightly above-market volatility while filtering out speculative names. Combined with equal-weight construction, this keeps the overall portfolio beta near 1.0, delivering market-like risk with historically significantly above-market returns."},
];
const SECTOR_CARDS=[
  {name:"Banks",tagline:"Credit growth + balance sheet recovery",color:"#06b6d4",thesis:"India's credit growth runs at 12–14% annually, driven by retail lending and MSME formalisation. PSU banks have completed a decade-long balance sheet cleanup and now offer structural earnings growth at valuations that reflect none of this recovery.",initiatives:["Jan Dhan Yojana","PM Mudra Yojana","Credit Guarantee Schemes","Financial Inclusion Index"]},
  {name:"Financial Services",tagline:"Underpenetrated markets + digital delivery",color:"#3b82f6",thesis:"Housing finance, gold lending, SME credit, and wealth management are structurally underpenetrated relative to India's income levels. UPI and digital infrastructure have dramatically reduced delivery costs, expanding addressable markets further.",initiatives:["UPI & Digital Payments Stack","GIFT City","SEBI Market Deepening","Account Aggregator Framework"]},
  {name:"Information Technology",tagline:"AI pivot + durable cost arbitrage",color:"#e11d48",thesis:"India's IT sector benefits from a structural cost arbitrage that remains durable, and is now pivoting toward AI-led services. Mid-tier IT names — filtered naturally by P/E ≤ 20x — often offer better growth-to-valuation ratios than largecap peers.",initiatives:["India AI Mission","Semiconductor Mission","Digital India","IT/ITeS PLI Scheme"]},
  {name:"Capital Goods",tagline:"₹11L Cr annual capex + multi-year orderbooks",color:"#8b5cf6",thesis:"The Government's capex push is the defining fiscal theme since 2021. Infrastructure spending on roads, railways, defence, and power transmission creates multi-year order book visibility for domestic capital goods manufacturers.",initiatives:["National Infrastructure Pipeline","PM Gati Shakti","Defence Indigenisation","PLI for Advanced Manufacturing"]},
  {name:"Construction",tagline:"Infrastructure spending cycle in full force",color:"#d946ef",thesis:"Directly linked to the infrastructure capex theme. Roads, metro rail, affordable housing, and urban infrastructure are all active areas of Government spending, creating sustained demand for quality construction companies.",initiatives:["PM Awas Yojana","Smart Cities Mission","NHAI Projects","Jal Jeevan Mission"]},
  {name:"Oil Gas & Consumable Fuels",tagline:"Stable volumes + deep value mispricing",color:"#f97316",thesis:"India is the world's third-largest energy consumer. Downstream refiners trade at very low P/E multiples due to perceived commodity risk, but their refining margins and volumes are relatively stable. The mispricing thesis is arguably strongest here.",initiatives:["City Gas Distribution","LPG Universalisation","Strategic Petroleum Reserve","Biofuel Blending Mandates"]},
  {name:"Power",tagline:"Record demand + decade-long capex cycle",color:"#f59e0b",thesis:"India's peak power demand hits record highs annually. The energy transition — renewables buildout, grid expansion, green hydrogen — represents a decade-long capex cycle. Established utilities offer stable regulated returns alongside capacity addition growth.",initiatives:["National Electricity Plan 2032","Green Hydrogen Mission","PM Surya Ghar","RDSS"]},
  {name:"Consumer Services",tagline:"60%+ consumption economy + income upgrades",color:"#ef4444",thesis:"Private consumption accounts for over 60% of India's GDP. As per capita income rises, the marginal rupee shifts from essential goods to discretionary services. Consumer services grows faster than FMCG by capturing this upgrade in spending patterns.",initiatives:["Tourism Infrastructure Push","Swadesh Darshan 2.0","UDAN Scheme","National Logistics Policy"]},
  {name:"Telecommunication",tagline:"AI backbone + BharatNet + rising ARPU",color:"#34d399",thesis:"India's telecom sector has consolidated into an effective duopoly, restoring pricing power. Telecom infrastructure is becoming the backbone of AI and data centre expansion — network utilisation grows with every AI workload. BharatNet extends the addressable market to 6 lakh villages.",initiatives:["BharatNet Phase III","5G Spectrum Rollout","National Broadband Mission","Digital Connectivity Districts"]},
  {name:"Chemicals",tagline:"China+1 shift + specialty value chain",color:"#14b8a6",thesis:"India is positioned as a credible alternative to China in specialty chemicals, driven by global supply chain diversification. Indian specialty chemical companies with established client relationships are well-placed to capture this decade-long structural shift.",initiatives:["PLI for Specialty Chemicals","PCPIR Zones","Bulk Drug Parks","Zero Liquid Discharge mandates"]},
  {name:"Media Entertainment & Publication",tagline:"Content boom + new entrants + ad growth",color:"#f43f5e",thesis:"Content consumption in India is accelerating — driven by affordable data, smartphone penetration, and a young population. The ecosystem is expanding with new OTT entrants, regional content, live sports streaming, and digital advertising.",initiatives:["National Broadcasting Policy","AVGC-XR National Centre of Excellence","India as Global Animation Hub"]},
  {name:"Textiles",tagline:"PM MITRA parks + China+1 in apparel",color:"#a3e635",thesis:"India is a natural beneficiary of China+1 in apparel and technical textiles. Government investment in dedicated textile parks accelerates cluster-based manufacturing competitiveness.",initiatives:["PM MITRA Textile Parks (7 mega parks)","PLI for Textiles","ATUF Scheme","National Technical Textiles Mission"]},
];
const EXCLUDED=[
  {name:"Healthcare & Pharma",reason:"Quality names trade well above P/E 20x. Requires a dedicated screen with higher valuation tolerance."},
  {name:"FMCG",reason:"Mature, low-growth, structurally high P/E. As income rises, the marginal rupee shifts to services — Consumer Services captures this better."},
  {name:"Automobiles & Auto Components",reason:"Cyclical, exposed to EV disruption risk and commodity input cost volatility."},
  {name:"Metals & Mining",reason:"Commodity-price driven earnings make fundamental screening unreliable."},
  {name:"Realty",reason:"Lumpy project-based revenue recognition makes trailing metrics misleading."},
  {name:"Consumer Durables",reason:"Mixed sector — most names trade at elevated valuations that fail the P/E screen."},
  {name:"Diversified / Others",reason:"Heterogeneous sectors where a consistent macro thesis is difficult to construct."},
];

function FlipCard({front,back,height=190}){
  const [flipped,setFlipped]=useState(false);
  return(
    <div onClick={()=>setFlipped(f=>!f)} style={{height,cursor:"pointer",perspective:1000,userSelect:"none"}}>
      <div style={{position:"relative",width:"100%",height:"100%",transformStyle:"preserve-3d",transition:"transform 0.45s cubic-bezier(0.4,0.2,0.2,1)",transform:flipped?"rotateY(180deg)":"rotateY(0deg)"}}>
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",background:C.card,border:`0.5px solid ${C.border}`,borderRadius:10,padding:"18px 20px",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          {front}
          <div style={{fontSize:10,color:C.muted,alignSelf:"flex-end",letterSpacing:"0.04em"}}>tap to flip ↻</div>
        </div>
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",transform:"rotateY(180deg)",background:C.hover,border:`0.5px solid ${C.accent}44`,borderRadius:10,padding:"18px 20px",display:"flex",flexDirection:"column",justifyContent:"space-between",overflowY:"auto"}}>
          {back}
          <div style={{fontSize:10,color:C.muted,alignSelf:"flex-end",letterSpacing:"0.04em",marginTop:8}}>tap to flip ↻</div>
        </div>
      </div>
    </div>
  );
}
function FAQItem({q,a}){
  const [open,setOpen]=useState(false);
  return(
    <div style={{borderBottom:`0.5px solid ${C.border}`}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"14px 4px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16}}>
        <div style={{fontSize:13,fontWeight:500,color:C.primary}}>{q}</div>
        <div style={{color:C.muted,fontSize:14,flexShrink:0,transition:"transform 0.2s",transform:open?"rotate(45deg)":"rotate(0deg)"}}>+</div>
      </div>
      {open&&<div style={{padding:"0 4px 14px",fontSize:13,color:C.secondary,lineHeight:1.8}}>{a}</div>}
    </div>
  );
}
function RSection({title,children}){
  return(
    <div style={{marginBottom:48}}>
      <div style={{fontSize:11,fontWeight:600,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:20,paddingBottom:10,borderBottom:`0.5px solid ${C.border}`}}>{title}</div>
      {children}
    </div>
  );
}
function ResourcesTab(){
  return(
    <div>
      <RSection title="How this works">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
          {[{label:"The problem",text:"Most retail investors are caught between two extremes — chasing momentum stocks that carry high risk, or parking money in fixed deposits that barely beat inflation. There is a disciplined middle path."},{label:"The approach",text:"Apply five quantitative filters to the entire Nifty 500 universe to find companies that are genuinely profitable, growing faster than the economy, and available at a reasonable price. No gut feel. No tips."},{label:"The result",text:"A compact, equal-weight portfolio concentrated in sectors with structural tailwinds. Backtested over 5 years: 393% total return vs 93% for the SENSEX, Sharpe Ratio of 1.53. Not multibaggers — steady, disciplined compounding."}].map(({label,text})=>(
            <div key={label} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
              <div style={{fontSize:11,fontWeight:600,color:C.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>{label}</div>
              <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{text}</div>
            </div>
          ))}
        </div>
      </RSection>
      <RSection title="The 5 metrics — tap a card to explore">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
          {METRICS.map(m=>(
            <FlipCard key={m.name} height={200}
              front={<div><div style={{display:"inline-block",background:C.accentDim,borderRadius:5,padding:"3px 10px",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:C.accent,marginBottom:12}}>{m.threshold}</div><div style={{fontSize:15,fontWeight:600,color:C.primary,marginBottom:6}}>{m.name}</div><div style={{fontSize:13,color:C.secondary,lineHeight:1.7}}>{m.tagline}</div></div>}
              back={<div><div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:8}}>{m.name}</div><div style={{fontSize:12,color:C.primary,lineHeight:1.7,marginBottom:8}}>{m.why}</div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>{m.detail}</div></div>}
            />
          ))}
        </div>
      </RSection>
      <RSection title="Portfolio construction">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
          {[{q:"Why equal weight?",a:"Equal weighting removes the temptation to overweight high-conviction picks. Every stock gets the same allocation, automatically forcing you to buy more of fallen stocks and trim those that have run up. Disciplined, emotion-free rebalancing built in."},{q:"Why quarterly rebalancing?",a:"Fundamentals change at the speed of business, not markets. Quarterly aligns with India's earnings calendar, ensuring the screen always runs on fresh data. More frequent rebalancing adds noise and costs."},{q:"Why a sector cap?",a:"Without a cap, value screens naturally overweight cheap sectors like Banks and Financial Services. The cap — min(3, max(1, floor(20% of sector size in universe))) — ensures genuine diversification across conviction sectors."},{q:"How are stocks ranked within a sector?",a:"By the Growth/P/E Score: EPS CAGR divided by P/E. This directly captures the mispricing thesis — the most earnings growth per rupee of valuation paid."}].map(({q,a})=>(
            <div key={q} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
              <div style={{fontSize:13,fontWeight:600,color:C.primary,marginBottom:8}}>{q}</div>
              <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{a}</div>
            </div>
          ))}
        </div>
      </RSection>
      <RSection title="Sector selection — India macro thesis — tap a card to explore">
        <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:20}}>The 12 included sectors are chosen based on structural macroeconomic tailwinds, Government policy direction, and valuation discipline. Reviewed at each quarterly rebalance.</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14,marginBottom:28}}>
          {SECTOR_CARDS.map(s=>(
            <FlipCard key={s.name} height={180}
              front={<div><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/><div style={{fontSize:14,fontWeight:600,color:C.primary}}>{s.name}</div></div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>{s.tagline}</div></div>}
              back={<div><div style={{fontSize:12,fontWeight:600,color:s.color,marginBottom:8}}>{s.name}</div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7,marginBottom:10}}>{s.thesis}</div><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{s.initiatives.map((init,i)=>(<span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:C.bg,color:C.secondary,border:`0.5px solid ${C.border}`}}>{init}</span>))}</div></div>}
            />
          ))}
        </div>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Excluded sectors</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {EXCLUDED.map(e=>(<div key={e.name} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 14px",opacity:0.6}}><div style={{fontSize:12,fontWeight:600,color:C.secondary,marginBottom:4}}>{e.name}</div><div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>{e.reason}</div></div>))}
        </div>
      </RSection>
      <RSection title="FAQ">
        <div>
          {[{q:"Is this a guaranteed return?",a:"No. Past performance, including the 5-year backtest and 2-year live track record, does not guarantee future results. This is a rules-based strategy that has historically outperformed — not a promise of future outperformance."},{q:"How do I actually invest in this portfolio?",a:"Divide your investment amount equally across all stocks in the current portfolio table. At the next quarterly rebalance, review the updated portfolio — sell stocks that have been removed, buy new additions, and rebalance to equal weight."},{q:"What if a stock I hold gets dropped at rebalance?",a:"Sell it and redeploy the proceeds into new additions, bringing all positions back to equal weight. Discipline is the edge."},{q:"Why not just buy an index fund?",a:"You absolutely can. This strategy is for investors who want to attempt to outperform the index with a disciplined, fundamentals-based approach — accepting the complexity of quarterly rebalancing in exchange for potentially higher risk-adjusted returns."},{q:"What are the risks?",a:"Sector concentration, single-stock risk, liquidity risk for smaller names, model risk, and execution risk — the strategy requires consistent quarterly discipline."},{q:"Who built this and why?",a:"Originally developed as a group assignment at IIM Bangalore for the Financial Markets course, backtested and validated against the SENSEX. Productised as a publicly accessible tool for hobby investors who want institutional-grade equity screening."}].map(({q,a})=><FAQItem key={q} q={q} a={a}/>)}
        </div>
      </RSection>
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────
export default function App(){
  const [activeTab,   setActiveTab]   = useState("overview");
  const [stocks,      setStocks]      = useState([]);
  const [dataStatus,  setDataStatus]  = useState("loading");
  const [betaStatus,  setBetaStatus]  = useState("loading");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [perf,        setPerf]        = useState(null);
  const [nav,         setNav]         = useState(null);
  const [trades,      setTrades]      = useState(null);

  useEffect(()=>{
    fetch(URLS.fundamentals).then(r=>{if(!r.ok)throw new Error();return r.text();})
      .then(t=>{setStocks(parseCSV(t));setDataStatus("ok");}).catch(()=>setDataStatus("error"));
  },[]);

  useEffect(()=>{
    fetch(URLS.betas).then(r=>{if(!r.ok)throw new Error();return r.json();})
      .then(d=>{setStocks(prev=>prev.map(s=>({...s,beta:d[s.ticker]??null,betaStatus:d[s.ticker]!=null?"done":"idle"})));setBetaStatus("ok");})
      .catch(()=>setBetaStatus("error"));
  },[]);

  useEffect(() => {
    const loadPerformanceData = async () => {
      const results = await Promise.allSettled([
        fetch(URLS.perfSummary).then(r => { if (!r.ok) throw new Error("perf_err"); return r.json(); }),
        fetch(URLS.nav).then(r => { if (!r.ok) throw new Error("nav_err"); return r.json(); }),
        fetch(URLS.tradeLog).then(r => { if (!r.ok) throw new Error("trade_err"); return r.json(); })
      ]);

      if (results[0].status === "fulfilled") setPerf(results[0].value);
      else console.warn("Failed to load Performance Summary.");

      if (results[1].status === "fulfilled") setNav(results[1].value);
      else console.warn("Failed to load NAV data.");

      if (results[2].status === "fulfilled") setTrades(results[2].value);
      else console.warn("Failed to load Trade Log.");
    };

    loadPerformanceData();
  }, []);

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",height:52,borderBottom:`0.5px solid ${C.border}`,background:C.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:180}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>Fundamental Screener</span>
        </div>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex"}}>
          {TABS.map(t=>{
            const active=activeTab===t.id;
            return(<button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:"0 18px",height:52,border:"none",borderBottom:active?`2px solid ${C.accent}`:"2px solid transparent",background:"transparent",color:active?C.primary:C.secondary,fontWeight:active?600:400,fontSize:13,cursor:"pointer",transition:"all 0.15s",fontFamily:"Inter,sans-serif",whiteSpace:"nowrap"}}>{t.label}</button>);
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14,fontSize:12,color:C.secondary,minWidth:180,justifyContent:"flex-end"}}>
          <span>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></span>
          <span style={{color:C.muted}}>·</span>
          <span>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>{betaStatus==="ok"?"Live":"Loading"}</span></span>
        </div>
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
        <Sidebar collapsed={!sidebarOpen} onToggle={()=>setSidebarOpen(o=>!o)} perf={perf}/>
        <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:C.bg}}>
          {activeTab==="overview"&&(
            dataStatus==="loading"?<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:C.secondary,fontSize:14}}>Loading universe...</div>:
            dataStatus==="error"?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"50vh",gap:10}}><div style={{fontSize:14,color:C.red}}>Could not load fundamentals.csv from GitHub.</div></div>:
            <OverviewTab stocks={stocks} betaStatus={betaStatus} perf={perf}/>
          )}
          {activeTab==="performance"&&<PerformanceTab perf={perf} nav={nav} trades={trades}/>}
          {activeTab==="explore"&&<ComingSoon title="Build & Test" description="Experiment with the strategy parameters and see how the portfolio composition would change." items={["Adjust all 5 screening filters with live sliders","Sector inclusion / exclusion toggle","See funnel change in real time","Compare your custom screen vs the base strategy","What-if scenarios — P/E at 25x, Beta at 1.5x"]}/>}
          {activeTab==="resources"&&<ResourcesTab/>}
        </div>
      </div>
    </div>
  );
}