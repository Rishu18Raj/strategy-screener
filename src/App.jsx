import { useState, useMemo, useEffect } from "react";

// ── strategy config ───────────────────────────────────────────
const SELECTED_SECTORS = new Set([
  "Banks",
  "Financial Services",
  "Media Entertainment & Publication",
  "Information Technology",
  "Telecommunication",
  "Capital Goods",
  "Construction",
  "Consumer Services",
  "Chemicals",
  "Oil Gas & Consumable Fuels",
  "Power",
  "Textiles",
]);

const FILTERS = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };

const LAST_REBALANCE = new Date("2026-06-25");
const NEXT_REBALANCE = new Date("2026-09-25");
const DATA_QUARTER   = "Q4 FY26";

const FUNDAMENTALS_URL = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/fundamentals.csv";
const BETAS_URL        = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/betas.json";

// sector → colour (generated for all 21 sectors)
const SECTOR_COLORS = {
  "Financial Services":                "#3b82f6",
  "Diversified":                       "#6366f1",
  "Capital Goods":                     "#8b5cf6",
  "Construction Materials":            "#a78bfa",
  "Power":                             "#f59e0b",
  "Banks":                             "#06b6d4",
  "Fast Moving Consumer Goods":        "#10b981",
  "Chemicals":                         "#14b8a6",
  "Healthcare":                        "#22c55e",
  "Metals & Mining":                   "#84cc16",
  "Services":                          "#eab308",
  "Oil Gas & Consumable Fuels":        "#f97316",
  "Consumer Services":                 "#ef4444",
  "Realty":                            "#ec4899",
  "Construction":                      "#d946ef",
  "Information Technology":            "#e11d48",
  "Automobile and Auto Components":    "#fb7185",
  "Consumer Durables":                 "#fbbf24",
  "Telecommunication":                 "#34d399",
  "Textiles":                          "#a3e635",
  "Media Entertainment & Publication": "#f43f5e",
};

const TABS = [
  { id:"overview",    label:"Overview"             },
  { id:"performance", label:"Portfolio Performance" },
  { id:"explore",     label:"Build & Test"          },
  { id:"resources",   label:"Resources"             },
];

// ── helpers ───────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(x => x.trim());

  return lines.slice(1).map(line => {
    // handle quoted fields (e.g. "3,889")
    const vals = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; continue; }
      if (line[i] === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += line[i];
    }
    vals.push(cur.trim());

    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });

    // strip % and parse — missing/invalid → NaN
    const pct = v => parseFloat((v||"").replace("%","").replace(",",""));

    return {
      ticker:    obj.ticker?.trim(),
      name:      obj.name?.trim(),
      sector:    obj.sector?.trim(),
      roe:       pct(obj.roe),
      revCAGR:   pct(obj.revCAGR),
      epsCAGR:   pct(obj.epsCAGR),
      pe:        pct(obj.pe),
      beta:      null,
      betaStatus:"idle",
    };
  }).filter(s => s.ticker); // drop empty rows
}

function passesFundamentals(s) {
  return !isNaN(s.roe)     && s.roe     >= FILTERS.roe     &&
         !isNaN(s.revCAGR) && s.revCAGR >= FILTERS.revCAGR &&
         !isNaN(s.epsCAGR) && s.epsCAGR >= FILTERS.epsCAGR &&
         !isNaN(s.pe)      && s.pe      <= FILTERS.pe;
}

// sector cap: min(3, max(1, floor(0.20 × sector_count_in_full_universe)))
function getSectorCaps(allStocks) {
  const counts = {};
  allStocks.forEach(s => {
    if (s.sector) counts[s.sector] = (counts[s.sector] || 0) + 1;
  });
  const caps = {};
  Object.entries(counts).forEach(([sec, n]) => {
    caps[sec] = Math.min(3, Math.max(1, Math.floor(0.20 * n)));
  });
  return caps;
}

// growth/P/E score — higher is better
function growthScore(s) {
  return s.pe > 0 ? s.epsCAGR / s.pe : 0;
}

function buildPortfolio(allStocks) {
  const caps = getSectorCaps(allStocks);

  // step 1 — fundamentals
  const fundPass = allStocks.filter(passesFundamentals);

  // step 2 — sector filter
  const sectorPass = fundPass.filter(s => SELECTED_SECTORS.has(s.sector));

  // step 3 — beta filter
  const betaPass = sectorPass.filter(s => s.beta != null && s.beta <= FILTERS.beta);

  // step 4 — within-sector ranking by growth/P/E, apply cap
  const bySector = {};
  betaPass.forEach(s => {
    if (!bySector[s.sector]) bySector[s.sector] = [];
    bySector[s.sector].push(s);
  });

  const portfolio = [];
  Object.entries(bySector).forEach(([sec, stocks]) => {
    const cap = caps[sec] || 1;
    const ranked = [...stocks].sort((a, b) => growthScore(b) - growthScore(a));
    portfolio.push(...ranked.slice(0, cap));
  });

  return { fundPass, sectorPass, betaPass, portfolio };
}

function daysUntil(d) { return Math.ceil((d - new Date()) / 864e5); }

function fmtDate(d) {
  return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

// ── design tokens ─────────────────────────────────────────────
const C = {
  bg:"var(--bg)", card:"var(--bg-card)", hover:"var(--bg-hover)",
  border:"var(--border)", subtle:"var(--border-subtle)",
  primary:"var(--text-primary)", secondary:"var(--text-secondary)", muted:"var(--text-muted)",
  accent:"var(--accent)", accentDim:"var(--accent-dim)",
  green:"var(--green)", greenDim:"var(--green-dim)",
  red:"var(--red)", redDim:"var(--red-dim)",
  amber:"var(--amber)", amberDim:"var(--amber-dim)",
};

// ── primitives ────────────────────────────────────────────────
const pill = (bg, color, label) => (
  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:bg,color,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
    {label}
  </span>
);

function MetricCard({label, value, sub, color, warn}) {
  return (
    <div style={{background:C.card,borderRadius:8,padding:"16px 18px",
      border:`0.5px solid ${warn ? C.amber : C.border}`,transition:"border 0.2s"}}>
      <div style={{fontSize:11,color:C.secondary,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>{label}</div>
      <div style={{fontSize:26,fontWeight:700,color:color||C.primary,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:12,color:C.secondary,marginTop:6,lineHeight:1.4}}>{sub}</div>}
    </div>
  );
}

function DonutChart({data, size=120}) {
  const total = data.reduce((s,d) => s+d.count, 0);
  if (!total) return null;
  let a = -Math.PI/2;
  const cx=size/2, cy=size/2, r=size*.38, ri=size*.23;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {data.map((d,i) => {
        const sw = (d.count/total)*2*Math.PI;
        const x1=cx+r*Math.cos(a), y1=cy+r*Math.sin(a); a+=sw;
        const x2=cx+r*Math.cos(a), y2=cy+r*Math.sin(a);
        const xi1=cx+ri*Math.cos(a-sw), yi1=cy+ri*Math.sin(a-sw);
        const xi2=cx+ri*Math.cos(a), yi2=cy+ri*Math.sin(a);
        const lg = sw>Math.PI?1:0;
        return <path key={i} d={`M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${lg},0 ${xi1},${yi1} Z`} fill={d.color} opacity={0.85}/>;
      })}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight="700" fill={C.primary}>{total}</text>
      <text x={cx} y={cy+15} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={C.secondary} letterSpacing="0.05em">STOCKS</text>
    </svg>
  );
}

function FunnelBar({label, count, total, color}) {
  const pct = total > 0 ? (count/total)*100 : 0;
  return (
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

function ComingSoon({title, description, items}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"55vh",gap:20,textAlign:"center",padding:"60px 24px"}}>
      <div style={{width:48,height:48,borderRadius:12,background:C.card,border:`0.5px solid ${C.border}`,
        display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.secondary}}>◈</div>
      <div>
        <div style={{fontSize:19,fontWeight:600,marginBottom:8,letterSpacing:"-0.01em"}}>{title}</div>
        <div style={{fontSize:14,color:C.secondary,maxWidth:460,lineHeight:1.7}}>{description}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,width:"100%",maxWidth:380}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",
            background:C.card,borderRadius:6,border:`0.5px solid ${C.border}`,textAlign:"left"}}>
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
function Sidebar({collapsed, onToggle}) {
  const daysToNext = daysUntil(NEXT_REBALANCE);
  const W = 210;
  return (
    <div style={{position:"relative",flexShrink:0,width:collapsed?0:W,transition:"width 0.25s ease"}}>
      <div style={{position:"absolute",top:0,left:0,bottom:0,width:W,
        borderRight:`0.5px solid ${C.border}`,background:C.bg,
        overflowY:"auto",overflowX:"hidden",
        transform:collapsed?"translateX(-100%)":"translateX(0)",
        transition:"transform 0.25s ease",
        display:"flex",flexDirection:"column",gap:24,padding:"24px 18px"}}>

        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Rebalance</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Last</div>
              <div style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(LAST_REBALANCE)}</div>
            </div>
            <div style={{background:daysToNext<=14?C.amberDim:C.card,
              border:`0.5px solid ${daysToNext<=14?C.amber:C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Next</div>
              <div style={{fontSize:12,fontWeight:600,color:daysToNext<=14?C.amber:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(NEXT_REBALANCE)}</div>
              <div style={{fontSize:11,color:C.secondary,marginTop:2}}>{daysToNext>0?`${daysToNext}d away`:"Due now"}</div>
            </div>
          </div>
        </div>

        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Strategy stats</div>
          {[
            {label:"5Y Total Return", value:"393%"},
            {label:"Sharpe Ratio",    value:"1.53"},
            {label:"Jensen Alpha",    value:"28.09"},
            {label:"Benchmark",       value:"SENSEX"},
          ].map(({label,value})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}}>
              <span style={{fontSize:12,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{marginTop:"auto"}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,fontWeight:500}}>About</div>
          <div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>
            IIMB MBA · Deutsche Bank IB alumni · Built for hobby investors who want institutional-grade equity screening.
          </div>
        </div>
      </div>

      <button onClick={onToggle}
        style={{position:"absolute",top:"50%",right:-14,transform:"translateY(-50%)",
          width:14,height:40,border:`0.5px solid ${C.border}`,borderLeft:"none",
          background:C.bg,color:C.secondary,cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",
          borderRadius:"0 6px 6px 0",fontSize:10,zIndex:10,padding:0,
          transition:"background 0.15s"}}
        onMouseEnter={e=>e.currentTarget.style.background=C.hover}
        onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
        {collapsed?"›":"‹"}
      </button>
    </div>
  );
}

// ── overview tab ──────────────────────────────────────────────
function OverviewTab({stocks, betaStatus}) {
  const [sortKey, setSortKey] = useState("roe");
  const [sortDir, setSortDir] = useState(-1);

  // derive all unique sectors from the universe
  const allSectors = useMemo(()=>[...new Set(stocks.map(s=>s.sector).filter(Boolean))].sort(),[stocks]);
  const totalSectors = allSectors.length;

  // funnel + portfolio via ranked construction
  const { fundPass, sectorPass, betaPass, portfolio } = useMemo(
    ()=> stocks.length > 0 ? buildPortfolio(stocks) : { fundPass:[], sectorPass:[], betaPass:[], portfolio:[] },
    [stocks]
  );

  // sector allocation of final portfolio
  const sectorAlloc = useMemo(()=>{
    const map = {};
    portfolio.forEach(s=>{
      if (!map[s.sector]) map[s.sector]={sector:s.sector,count:0,color:SECTOR_COLORS[s.sector]||C.accent};
      map[s.sector].count++;
    });
    return Object.values(map).sort((a,b)=>b.count-a.count);
  },[portfolio]);

  const displayed = useMemo(()=>{
    const key = sortKey==="beta" ? (s=>s.beta??999)
              : sortKey==="gp"   ? (s=>growthScore(s))
              : (s=>s[sortKey]);
    return [...portfolio].sort((a,b)=>sortDir*(key(a)>key(b)?1:-1));
  },[portfolio,sortKey,sortDir]);

  const toggleSort = k=>{ if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(-1);} };

  const Th = ({label,k,right})=>(
    <th onClick={()=>toggleSort(k)} style={{padding:"9px 12px",cursor:"pointer",fontWeight:500,fontSize:11,
      color:C.secondary,textAlign:right?"right":"left",whiteSpace:"nowrap",userSelect:"none",
      background:C.hover,letterSpacing:"0.05em",textTransform:"uppercase"}}>
      {label}{sortKey===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:24}}>
        <MetricCard label="Universe"          value={stocks.length.toLocaleString()} sub="Nifty 500 stocks"/>
        <MetricCard label="Pass fundamental"  value={fundPass.length} sub="RoE · CAGR · P/E filters" color={C.accent}/>
        <MetricCard label="Sectors selected"  value={`${SELECTED_SECTORS.size} of ${totalSectors}`} sub="Active sector conviction"/>
        <MetricCard label="Pass beta filter"  value={betaPass.length} sub="β ≤ 1.2 in target sectors" color="#f97316"/>
        <MetricCard label="In portfolio"      value={portfolio.length} sub="After sector cap" color={C.green}/>
        <MetricCard label="Next rebalance"    value={fmtDate(NEXT_REBALANCE)}
          sub={daysUntil(NEXT_REBALANCE)>0?`${daysUntil(NEXT_REBALANCE)} days away`:"Due now"}
          color={daysUntil(NEXT_REBALANCE)<=14?C.amber:C.primary}
          warn={daysUntil(NEXT_REBALANCE)<=14}/>
      </div>

      {/* funnel + donut */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>

        {/* selection funnel */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>Selection funnel</div>
          <FunnelBar label="Nifty 500 universe"           count={stocks.length}     total={stocks.length}  color={C.accent}/>
          <FunnelBar label="Pass fundamental criteria"    count={fundPass.length}   total={stocks.length}  color="#8b5cf6"/>
          <FunnelBar label="In target sectors"            count={sectorPass.length} total={stocks.length}  color={C.amber}/>
          <FunnelBar label="Pass beta filter (β ≤ 1.2)"  count={betaPass.length}   total={stocks.length}  color="#f97316"/>
          <FunnelBar label="Final portfolio (sector cap)" count={portfolio.length}  total={stocks.length}  color={C.green}/>
          <div style={{marginTop:14,paddingTop:12,borderTop:`0.5px solid ${C.subtle}`,fontSize:11,color:C.muted}}>
            Filters: RoE ≥ 13% · Rev CAGR ≥ 7% · EPS CAGR ≥ 10% · P/E ≤ 20x · Beta ≤ 1.2 · Sector cap: min(3, max(1, ⌊20% × sector size⌋)) · Ranked by EPS CAGR / P/E
          </div>
        </div>

        {/* sector allocation */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>Sector allocation · Equal weight</div>
          <div style={{display:"flex",gap:20,alignItems:"center"}}>
            <DonutChart data={sectorAlloc} size={110}/>
            <div style={{flex:1}}>
              {sectorAlloc.map(s=>{
                const alloc = portfolio.length>0?((s.count/portfolio.length)*100).toFixed(1):"0.0";
                return (
                  <div key={s.sector} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",marginBottom:2}}>
                    <div style={{width:7,height:7,borderRadius:2,background:s.color,flexShrink:0}}/>
                    <div style={{flex:1,fontSize:12,color:C.secondary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.sector}</div>
                    <div style={{fontSize:11,color:C.muted,minWidth:28}}>{s.count}</div>
                    <div style={{width:48,height:3,borderRadius:2,background:C.border}}>
                      <div style={{width:`${alloc}%`,height:"100%",borderRadius:2,background:s.color}}/>
                    </div>
                    <div style={{fontSize:11,color:C.secondary,minWidth:32,textAlign:"right"}}>{alloc}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* portfolio table */}
      <div style={{fontSize:11,fontWeight:600,marginBottom:10,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>
        Current portfolio · {portfolio.length} stocks
        {betaStatus!=="ok" && <span style={{marginLeft:10,color:C.amber,fontWeight:400,textTransform:"none",fontSize:11}}>⚠ Betas loading — portfolio may be incomplete</span>}
      </div>
      <div style={{overflowX:"auto",border:`0.5px solid ${C.border}`,borderRadius:8}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr>
              <Th label="Ticker" k="ticker"/>
              <Th label="Company" k="name"/>
              <Th label="Sector" k="sector"/>
              <Th label="RoE %" k="roe" right/>
              <Th label="Rev CAGR" k="revCAGR" right/>
              <Th label="EPS CAGR" k="epsCAGR" right/>
              <Th label="Beta ⚡" k="beta" right/>
              <Th label="P/E" k="pe" right/>
              <Th label="G/P Score" k="gp" right/>
            </tr>
          </thead>
          <tbody>
            {displayed.length===0 ? (
              <tr><td colSpan={8} style={{padding:"40px",textAlign:"center",color:C.muted,fontSize:13}}>
                {betaStatus==="loading" ? "Computing portfolio — waiting for beta data..." : "No stocks pass all filters."}
              </td></tr>
            ) : displayed.map((s,i)=>(
              <tr key={s.ticker} style={{borderTop:`0.5px solid ${C.subtle}`,background:i%2===0?"transparent":C.card+"44"}}>
                <td style={{padding:"10px 12px",fontWeight:600,fontFamily:"var(--font-mono)",fontSize:12,color:C.primary}}>{s.ticker}</td>
                <td style={{padding:"10px 12px",fontSize:13,color:C.secondary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{s.name}</td>
                <td style={{padding:"10px 12px"}}>
                  <span style={{fontSize:11,padding:"2px 7px",borderRadius:4,fontWeight:500,
                    background:(SECTOR_COLORS[s.sector]||C.accent)+"18",color:SECTOR_COLORS[s.sector]||C.accent,whiteSpace:"nowrap"}}>
                    {s.sector}
                  </span>
                </td>
                {[
                  {v:s.roe.toFixed(1)+"%"},
                  {v:s.revCAGR.toFixed(1)+"%"},
                  {v:s.epsCAGR.toFixed(1)+"%"},
                  {v:(s.beta??0).toFixed(2)},
                  {v:s.pe.toFixed(1)+"x"},
                  {v:growthScore(s).toFixed(2)},
                ].map((cell,ci)=>(
                  <td key={ci} style={{padding:"10px 12px",textAlign:"right",
                    color:C.primary,fontFamily:"var(--font-mono)",fontSize:12}}>
                    {cell.v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:12,color:C.muted}}>
        All stocks shown pass RoE ≥ 13% · Rev CAGR ≥ 7% · EPS CAGR ≥ 10% · P/E ≤ 20x · Beta ≤ 1.2 · in target sectors
      </div>
    </div>
  );
}

// ── resources tab ─────────────────────────────────────────────
function Section({title, children}) {
  return (
    <div style={{marginBottom:40}}>
      <div style={{fontSize:11,fontWeight:600,color:C.secondary,textTransform:"uppercase",
        letterSpacing:"0.1em",marginBottom:16,paddingBottom:10,
        borderBottom:`0.5px solid ${C.border}`}}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricExplainer({name, threshold, oneLiner, why, detail}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,
      marginBottom:10,overflow:"hidden",transition:"all 0.2s"}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"14px 18px",cursor:"pointer",
        display:"flex",alignItems:"center",gap:14,
        background:open?C.hover:C.card,transition:"background 0.15s"}}>
        <div style={{flexShrink:0,background:C.accentDim,borderRadius:6,
          padding:"4px 10px",fontFamily:"var(--font-mono)",fontSize:12,
          fontWeight:600,color:C.accent,whiteSpace:"nowrap"}}>
          {threshold}
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:600,color:C.primary,marginBottom:2}}>{name}</div>
          <div style={{fontSize:13,color:C.secondary}}>{oneLiner}</div>
        </div>
        <div style={{color:C.muted,fontSize:12,transition:"transform 0.2s",
          transform:open?"rotate(90deg)":"rotate(0deg)"}}>▶</div>
      </div>
      {open && (
        <div style={{padding:"14px 18px",borderTop:`0.5px solid ${C.border}`,
          background:C.bg}}>
          <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:10,
            fontWeight:500,color:C.primary}}>{why}</div>
          <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{detail}</div>
        </div>
      )}
    </div>
  );
}

function SectorCard({name, thesis, initiatives, excluded}) {
  return (
    <div style={{background:C.card,border:`0.5px solid ${excluded?C.border:C.accentDim}`,
      borderRadius:8,padding:"14px 18px",marginBottom:10,
      opacity:excluded?0.6:1}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:excluded?0:10}}>
        {!excluded && <div style={{width:6,height:6,borderRadius:"50%",
          background:SECTOR_COLORS[name]||C.accent,flexShrink:0}}/>}
        <div style={{fontSize:13,fontWeight:600,color:excluded?C.secondary:C.primary}}>{name}</div>
        {excluded && <span style={{fontSize:10,color:C.muted,padding:"1px 6px",
          borderRadius:4,border:`0.5px solid ${C.border}`}}>Excluded</span>}
      </div>
      {!excluded && (
        <>
          <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:10}}>{thesis}</div>
          {initiatives && initiatives.length > 0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {initiatives.map((init,i)=>(
                <span key={i} style={{fontSize:11,padding:"2px 8px",borderRadius:4,
                  background:C.hover,color:C.secondary,border:`0.5px solid ${C.border}`}}>
                  {init}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {excluded && (
        <div style={{fontSize:12,color:C.muted,marginTop:4,lineHeight:1.7}}>{thesis}</div>
      )}
    </div>
  );
}

function FAQItem({q, a}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{borderBottom:`0.5px solid ${C.border}`}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:"14px 4px",cursor:"pointer",display:"flex",
          justifyContent:"space-between",alignItems:"center",gap:16}}>
        <div style={{fontSize:13,fontWeight:500,color:C.primary}}>{q}</div>
        <div style={{color:C.muted,fontSize:12,flexShrink:0,
          transition:"transform 0.2s",transform:open?"rotate(45deg)":"rotate(0deg)"}}>+</div>
      </div>
      {open && (
        <div style={{padding:"0 4px 14px",fontSize:13,color:C.secondary,lineHeight:1.8}}>
          {a}
        </div>
      )}
    </div>
  );
}

function ResourcesTab() {
  return (
    <div style={{maxWidth:780}}>

      {/* S1 — how this works */}
      <Section title="How this works">
        <div style={{fontSize:14,color:C.secondary,lineHeight:1.9,marginBottom:14}}>
          Most retail investors are caught between two extremes — chasing momentum stocks that carry high risk,
          or parking money in fixed deposits that barely beat inflation. There is a disciplined middle path:
          find fundamentally strong businesses that the market has temporarily undervalued, hold them with
          equal weight, and rebalance quarterly as conditions change.
        </div>
        <div style={{fontSize:14,color:C.secondary,lineHeight:1.9,marginBottom:14}}>
          This screener applies five quantitative filters to the entire Nifty 500 universe to identify
          companies that are genuinely profitable, growing faster than the economy, and available at a
          reasonable price. The result is a compact, equal-weight portfolio concentrated in sectors with
          strong structural tailwinds in the Indian economy.
        </div>
        <div style={{fontSize:14,color:C.secondary,lineHeight:1.9}}>
          Backtested over five years against the SENSEX, this approach delivered a total return of{" "}
          <span style={{color:C.green,fontWeight:600}}>393%</span> versus the benchmark's{" "}
          <span style={{color:C.secondary,fontWeight:500}}>93%</span>, with a Sharpe Ratio of{" "}
          <span style={{color:C.accent,fontWeight:600}}>1.53</span> — meaning significantly more
          return per unit of risk taken. The goal is not to find multibaggers. It is to build a
          low-effort, high-discipline portfolio that compounds steadily over time.
        </div>
      </Section>

      {/* S2 — the 5 metrics */}
      <Section title="The 5 metrics, explained">
        <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:16}}>
          Click any metric to understand what it measures, why it matters, and how the threshold was chosen.
        </div>
        <MetricExplainer
          name="Return on Equity (RoE)"
          threshold="RoE ≥ 13%"
          oneLiner="How much is the business actually returning to its equity investors?"
          why="RoE is the most honest measure of business quality. A company's share price is ultimately a derived outcome of what the underlying business earns on the capital entrusted to it by equity investors. A high RoE signals that management is deploying capital effectively and generating real value — not just growing revenue on paper."
          detail="The 13% threshold is not arbitrary. It approximates the cost of equity in India — the minimum return an equity investor should expect for the risk of holding a stock rather than a risk-free instrument. A company earning below its cost of equity is destroying value for shareholders, even if it appears profitable. We only want companies that are genuinely earning above this hurdle rate."
        />
        <MetricExplainer
          name="Revenue CAGR"
          threshold="Rev CAGR ≥ 7%"
          oneLiner="Is the core business actually growing?"
          why="Revenue growth is the foundation of everything else. A company can temporarily improve margins or reduce costs, but sustainable earnings growth must ultimately be supported by a growing top line. We want companies that are expanding their business, not just optimising an existing one."
          detail="The 7% threshold corresponds approximately to India's nominal GDP growth rate. Any company growing slower than the overall economy is losing market share in real terms. By setting this floor, we ensure every stock in the portfolio is, at minimum, keeping pace with the expanding economy — and ideally outgrowing it."
        />
        <MetricExplainer
          name="EPS CAGR"
          threshold="EPS CAGR ≥ 10%"
          oneLiner="Are profits growing — not just revenues?"
          why="Revenue growth alone is insufficient. A business can grow its top line while simultaneously seeing profits erode if costs are rising faster. EPS growth ensures that the growth is profitable and that shareholders are actually better off over time. This is the filter that separates genuinely compounding businesses from revenue-chasing ones."
          detail={`The 10% EPS growth threshold can be achieved in two ways, and both are valid. The first is a high-growth company: strong revenue growth (say, 10%+) with stable margins naturally translates to equivalent EPS growth. The second is a stable compounder: moderate revenue growth (say, 7%) combined with improving net profit margins year-on-year (say, 3% annually) can deliver the same 10% EPS CAGR. We deliberately do not distinguish between these paths — what matters is that earnings per share are compounding at ≥10%, however that is achieved.`}
        />
        <MetricExplainer
          name="Price-to-Earnings (P/E)"
          threshold="P/E ≤ 20x"
          oneLiner="Are we paying a fair price for these earnings?"
          why="This is where the mispricing thesis lives. A company can have exceptional fundamentals — high RoE, strong growth — and still be a poor investment if you overpay for it. The P/E ratio is the market's current price for each rupee of earnings. A low P/E on a fundamentally strong company signals that the market has, for some reason, undervalued it."
          detail="The 20x cap is not a universal fair value — it is a discipline mechanism. Markets frequently misprice fundamentally strong companies in cyclical or out-of-favour sectors: PSU banks dismissed as structurally weak, energy companies written off as value traps, capital goods names ignored during capex downturns. These mispricings correct over time. By combining P/E ≤ 20x with strong RoE and growth filters, we are systematically hunting for exactly these opportunities — quality at a discount."
        />
        <MetricExplainer
          name="Beta"
          threshold="Beta ≤ 1.2"
          oneLiner="How volatile is this stock relative to the market?"
          why="Beta measures how much a stock moves relative to the broader market. A beta of 1.0 means the stock moves in line with the index. A beta of 1.5 means it amplifies market moves by 50% — both up and down. We want a portfolio that broadly tracks the market's risk level, not one that swings dramatically with every macro event."
          detail="The 1.2 cap allows for slightly above-market volatility, which is acceptable and expected for individual stocks, while filtering out highly speculative or illiquid names that tend to have outsized beta. Combined with the equal-weight construction, this keeps the overall portfolio beta close to 1.0 — delivering market-like risk with, historically, significantly above-market returns. This is precisely what a Sharpe Ratio of 1.53 captures: superior risk-adjusted performance."
        />
      </Section>

      {/* S3 — portfolio construction */}
      <Section title="Portfolio construction">
        {[
          {
            q:"Why equal weight?",
            a:"Equal weighting removes the temptation to overweight high-conviction picks — a bias that frequently destroys retail portfolios. Every stock in the portfolio gets the same allocation. This automatically forces you to buy more of stocks that have fallen (at rebalance) and trim those that have run up — a disciplined, emotion-free version of buy low, sell high. It also prevents any single stock from disproportionately impacting the portfolio.",
          },
          {
            q:"Why quarterly rebalancing?",
            a:"Quarterly rebalancing is the right cadence for a fundamentals-driven strategy. Fundamentals — RoE, revenue growth, earnings growth — change at the speed of business, not at the speed of markets. Rebalancing more frequently introduces noise and transaction costs without improving signal quality. Rebalancing less frequently risks holding stocks whose fundamentals have deteriorated. Quarterly aligns with the Indian earnings calendar, ensuring the screen is always run on fresh, publicly reported data.",
          },
          {
            q:"Why a sector cap?",
            a:"The sector cap — min(3, max(1, floor(20% of sector size in universe))) — prevents overconcentration in any single sector, regardless of how many stocks pass the fundamental filters. Without this, value-oriented screens naturally overweight cheap sectors like Banks and Financial Services, which are structurally low P/E. The cap ensures genuine diversification across the portfolio's conviction sectors.",
          },
          {
            q:"How are stocks ranked within a sector?",
            a:"Once a sector's cap is determined, stocks are ranked by the Growth/P/E Score — EPS CAGR divided by P/E. This metric directly captures the strategy's core thesis: we want the most growth per rupee of valuation paid. A stock with 25% EPS CAGR at P/E 10x scores 2.5. A stock with 15% EPS CAGR at P/E 12x scores 1.25. The higher-scoring stock offers more compounding power at a cheaper price.",
          },
        ].map(({q,a})=>(
          <div key={q} style={{marginBottom:14,background:C.card,border:`0.5px solid ${C.border}`,
            borderRadius:8,padding:"14px 18px"}}>
            <div style={{fontSize:13,fontWeight:600,color:C.primary,marginBottom:8}}>{q}</div>
            <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{a}</div>
          </div>
        ))}
      </Section>

      {/* S4 — sector selection */}
      <Section title="Sector selection — India macro thesis">
        <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:20}}>
          Sector selection is the most active judgment call in this strategy. The 12 included sectors
          are chosen based on a combination of structural macroeconomic tailwinds, Government policy
          direction, and valuation discipline. Sectors with strong earnings visibility, policy support,
          and reasonable valuations are included. Cyclical, commodity-driven, or structurally overvalued
          sectors are excluded. The selection is reviewed at each quarterly rebalance.
        </div>

        {[
          {
            name:"Banks",
            thesis:"India's credit growth is running at 12–14% annually, driven by retail lending, MSME formalisation, and financial inclusion. PSU banks have completed a decade-long balance sheet cleanup post the NPA crisis and are now in strong capital positions with improving return ratios. The sector offers structural earnings growth at valuation multiples that reflect none of this recovery.",
            initiatives:["Jan Dhan Yojana","PM Mudra Yojana","Credit Guarantee Schemes for MSMEs","Financial Inclusion Index"],
          },
          {
            name:"Financial Services",
            thesis:"Beyond banks, India's financial services ecosystem is undergoing a generational expansion. Housing finance, gold lending, SME credit, and wealth management are all structurally underpenetrated relative to India's income levels. UPI and digital infrastructure have dramatically reduced the cost of financial service delivery, expanding addressable markets further.",
            initiatives:["UPI & Digital Payments Stack","GIFT City Financial Hub","SEBI Market Deepening Initiatives","Account Aggregator Framework"],
          },
          {
            name:"Information Technology",
            thesis:"India's IT sector benefits from a structural cost arbitrage that remains durable, and is now pivoting toward AI-led services and solutions. Mid-tier IT names — filtered naturally by the P/E ≤ 20x discipline — often offer better growth-to-valuation ratios than the largecap names the market obsesses over. The 5-year earnings trajectory for quality IT names remains intact.",
            initiatives:["India AI Mission","Semiconductor Mission","Digital India","IT/ITeS PLI Scheme"],
          },
          {
            name:"Capital Goods",
            thesis:"The Government's capital expenditure push is the defining theme of India's fiscal policy since 2021. Infrastructure spending on roads, railways, defence, and power transmission is running at ₹11 lakh crore annually and rising. This creates a multi-year order book visibility for domestic capital goods manufacturers that is difficult to replicate in other sectors.",
            initiatives:["National Infrastructure Pipeline","PM Gati Shakti","Defence indigenisation (Atmanirbhar Bharat)","PLI for Advanced Manufacturing","RDSO certification push"],
          },
          {
            name:"Construction",
            thesis:"Directly linked to the infrastructure capex theme. Roads, metro rail, affordable housing, and urban infrastructure are all active areas of Government spending. Construction companies with strong execution track records and healthy order books benefit from this multi-year cycle.",
            initiatives:["PM Awas Yojana","Smart Cities Mission","National Highways Authority projects","Jal Jeevan Mission"],
          },
          {
            name:"Oil Gas & Consumable Fuels",
            thesis:"India is the world's third-largest energy consumer with structural demand growth tied to GDP expansion. Downstream refiners trade at very low P/E multiples due to perceived commodity risk, but their refining margins and throughput volumes are relatively stable. The mispricing thesis is arguably strongest in this sector — quality businesses treated as cyclical commodities by the market.",
            initiatives:["City Gas Distribution expansion","LPG universalisation","Strategic Petroleum Reserve","Biofuel blending mandates"],
          },
          {
            name:"Power",
            thesis:"India's peak power demand has been hitting record highs annually. The energy transition — renewables buildout, grid expansion, green hydrogen — represents a decade-long capital expenditure cycle. Established power utilities offer stable regulated returns alongside growth from capacity additions.",
            initiatives:["National Electricity Plan 2032","Green Hydrogen Mission","PM Surya Ghar (Muft Bijli Yojana)","ISTS waiver for renewables","Revamped Distribution Sector Scheme (RDSS)"],
          },
          {
            name:"Consumer Services",
            thesis:"India is a consumption-driven economy — private consumption accounts for over 60% of GDP. As per capita income rises, the marginal rupee shifts away from essential goods toward discretionary services: dining, travel, hospitality, entertainment, and personal services. This structural shift means consumer services grows faster than FMCG over a multi-year horizon, capturing income growth more efficiently than staples.",
            initiatives:["Tourism Infrastructure push","Swadesh Darshan 2.0","UDAN Regional Connectivity Scheme","National Logistics Policy"],
          },
          {
            name:"Telecommunication",
            thesis:"India's telecom sector has consolidated into an effective duopoly, restoring pricing power after years of tariff wars. ARPU is rising structurally. Beyond traditional connectivity, telecom infrastructure is becoming the backbone of India's AI and data centre expansion — network utilisation grows with every AI workload, every streaming hour, every connected device. The BharatNet programme is extending broadband to 6 lakh villages, expanding the addressable market significantly.",
            initiatives:["BharatNet Phase III","5G Spectrum Rollout","Digital Connectivity in Aspirational Districts","National Broadband Mission"],
          },
          {
            name:"Chemicals",
            thesis:"India is positioned as a credible alternative to China in specialty chemicals, driven by the global China+1 supply chain diversification trend. This is not a short-term trade — it reflects a decade-long reorientation of global chemical supply chains. Indian specialty chemical companies with established client relationships are well-placed to capture this shift.",
            initiatives:["PLI for Specialty Chemicals","Petroleum, Chemicals and Petrochemicals Investment Region (PCPIR)","Bulk Drug Parks","Zero Liquid Discharge mandates creating barriers to entry"],
          },
          {
            name:"Media Entertainment & Publication",
            thesis:"Content consumption in India is accelerating — driven by affordable data, smartphone penetration, and a young population. This is not limited to legacy broadcasters; the ecosystem is expanding with new OTT entrants, regional content, live sports streaming, and digital advertising. The sector offers selective opportunities where content moats and distribution scale meet reasonable valuations.",
            initiatives:["National Broadcasting Policy","Digital Media Regulations","AVGC-XR National Centre of Excellence","India as Global Animation Hub"],
          },
          {
            name:"Textiles",
            thesis:"India is a natural beneficiary of China+1 in apparel and technical textiles. Rising labour costs in China and global brand diversification of sourcing are structural tailwinds. Government infrastructure investment in dedicated textile parks accelerates cluster-based manufacturing competitiveness.",
            initiatives:["PM MITRA Textile Parks (7 mega parks)","PLI for Textiles","Amended Technology Upgradation Fund (ATUF)","National Technical Textiles Mission"],
          },
        ].map(s=><SectorCard key={s.name} {...s}/>)}

        <div style={{marginTop:20,fontSize:12,fontWeight:600,color:C.secondary,
          textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:12}}>Excluded sectors</div>
        {[
          {name:"Healthcare & Pharma",    thesis:"Strong sector fundamentally, but quality names trade well above P/E 20x. A pharma-specific screen with a higher valuation tolerance would be more appropriate."},
          {name:"Fast Moving Consumer Goods", thesis:"Mature, low-growth, structurally high-P/E sector. FMCG captures the maintenance of existing consumption, not the growth in discretionary spending. As per capita income rises, the marginal rupee increasingly shifts to services — making FMCG a slower-growing opportunity relative to Consumer Services."},
          {name:"Automobiles & Auto Components", thesis:"Cyclical sector exposed to EV disruption risk, commodity input costs, and credit cycle sensitivity. Difficult to screen fundamentally with confidence."},
          {name:"Metals & Mining",        thesis:"Commodity-price driven earnings make fundamental screening unreliable. A company's RoE and EPS CAGR in this sector is as much a function of global steel or aluminium prices as management quality."},
          {name:"Realty",                 thesis:"Lumpy, project-based revenue recognition makes trailing metrics misleading. Capital-intensive with long working capital cycles."},
          {name:"Consumer Durables",      thesis:"Mixed sector. Some quality compounders, but many trade at elevated valuations that fail the P/E screen. Would benefit from a dedicated screen."},
        ].map(s=><SectorCard key={s.name} {...s} excluded/>)}
      </Section>

      {/* S5 — FAQ */}
      <Section title="FAQ">
        {[
          {
            q:"Is this a guaranteed return?",
            a:"No. Past performance, including the 393% 5-year backtest return, does not guarantee future results. This is a rules-based strategy that has historically outperformed — not a promise of future outperformance. Markets can remain irrational for extended periods, and any individual stock in the portfolio can underperform or lose value.",
          },
          {
            q:"How do I actually invest in this portfolio?",
            a:"Divide your investment amount equally across all stocks currently shown in the portfolio table. For example, if you are investing ₹1,00,000 and there are 14 stocks, allocate approximately ₹7,143 to each. Buy at current market prices. At the next quarterly rebalance date, review the updated portfolio — sell any stocks that have been removed from the screen and buy any new additions, rebalancing to equal weight.",
          },
          {
            q:"What if a stock I hold gets dropped at rebalance?",
            a:"Sell it and redeploy the proceeds into the new additions, bringing all positions back to equal weight. This is the discipline the strategy requires. It is uncomfortable to sell a stock you may have gains in, or to hold a stock through a drawdown — but the systematic approach is precisely what generates the risk-adjusted returns over time.",
          },
          {
            q:"Why not just buy an index fund?",
            a:"You absolutely can, and for many investors it is the right answer. Index funds are low-cost, diversified, and require no effort. This strategy is for investors who want to attempt to outperform the index with a disciplined, fundamentals-based approach — accepting the additional complexity of quarterly rebalancing and single-stock risk in exchange for the potential of higher risk-adjusted returns.",
          },
          {
            q:"What are the risks?",
            a:"Sector concentration — the portfolio is deliberately concentrated in 12 of 21 sectors, which means it can significantly underperform the index if those sectors are out of favour. Single-stock risk — despite diversification, individual holdings can decline sharply. Liquidity risk — some smaller names may have limited trading volumes. Model risk — the strategy is based on historical relationships between fundamentals and returns; these may not persist. And execution risk — the strategy requires consistent quarterly discipline, which many investors struggle to maintain.",
          },
          {
            q:"Who built this and why?",
            a:"This screener was originally developed as a group assignment at IIM Bangalore for the Financial Markets course, where it was backtested and validated against the SENSEX. It was then productised as a publicly accessible tool for hobby investors who want institutional-grade equity screening without institutional access. The methodology is transparent, the data sources are public, and the code is open source.",
          },
        ].map(({q,a})=><FAQItem key={q} q={q} a={a}/>)}
      </Section>

    </div>
  );
}

// ── root ──────────────────────────────────────────────────────
export default function App() {
  const [activeTab,   setActiveTab]   = useState("overview");
  const [stocks,      setStocks]      = useState([]);
  const [dataStatus,  setDataStatus]  = useState("loading");
  const [betaStatus,  setBetaStatus]  = useState("loading");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(()=>{
    fetch(FUNDAMENTALS_URL)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); })
      .then(t=>{ setStocks(parseCSV(t)); setDataStatus("ok"); })
      .catch(()=>setDataStatus("error"));
  },[]);

  useEffect(()=>{
    fetch(BETAS_URL)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(d=>{
        setStocks(prev=>prev.map(s=>({
          ...s,
          beta:      d[s.ticker]??null,
          betaStatus:d[s.ticker]!=null?"done":"idle",
        })));
        setBetaStatus("ok");
      })
      .catch(()=>setBetaStatus("error"));
  },[]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>

      {/* top bar */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 28px",height:52,borderBottom:`0.5px solid ${C.border}`,background:C.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:180}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>Fundamental Screener</span>
        </div>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex"}}>
          {TABS.map(t=>{
            const active=activeTab===t.id;
            return (
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{padding:"0 18px",height:52,border:"none",
                  borderBottom:active?`2px solid ${C.accent}`:"2px solid transparent",
                  background:"transparent",color:active?C.primary:C.secondary,
                  fontWeight:active?600:400,fontSize:13,cursor:"pointer",
                  transition:"all 0.15s",fontFamily:"Inter,sans-serif",whiteSpace:"nowrap"}}>
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14,fontSize:12,color:C.secondary,minWidth:180,justifyContent:"flex-end"}}>
          <span>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></span>
          <span style={{color:C.muted}}>·</span>
          <span>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>{betaStatus==="ok"?"Live":"Loading"}</span></span>
        </div>
      </div>

      {/* body */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
        <Sidebar collapsed={!sidebarOpen} onToggle={()=>setSidebarOpen(o=>!o)}/>
        <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:C.bg}}>
          {activeTab==="overview" && (
            dataStatus==="loading" ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:C.secondary,fontSize:14}}>Loading universe...</div>
            ) : dataStatus==="error" ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"50vh",gap:10}}>
                <div style={{fontSize:14,color:C.red}}>Could not load fundamentals.csv from GitHub.</div>
                <div style={{fontSize:12,color:C.secondary}}>Ensure <code>data/fundamentals.csv</code> exists and the repo is public.</div>
              </div>
            ) : <OverviewTab stocks={stocks} betaStatus={betaStatus}/>
          )}
          {activeTab==="performance" && <ComingSoon title="Portfolio Performance"
            description="Track how the strategy portfolio has performed since inception against the SENSEX, sector by sector, and stock by stock."
            items={["Cumulative return chart — portfolio vs SENSEX","Quarterly active return bars","Stock-level contribution to return","Key winners since inception","Max drawdown & recovery periods","Sector decomposition & multiple expansion attribution"]}/>}
          {activeTab==="explore" && <ComingSoon title="Build & Test"
            description="Experiment with the strategy parameters and see how the portfolio composition would change."
            items={["Adjust all 5 screening filters with live sliders","Sector inclusion / exclusion toggle","See funnel change in real time","Compare your custom screen vs the base strategy","What-if scenarios — P/E at 25x, Beta at 1.5x"]}/>}
          {activeTab==="resources" && <ResourcesTab/>}
        </div>
      </div>
    </div>
  );
}