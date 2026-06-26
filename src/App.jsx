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
  const [h, ...rows] = text.trim().split("\n");
  const headers = h.split(",").map(x => x.trim());
  return rows.map(row => {
    const vals = row.split(",").map(v => v.trim());
    const obj  = {};
    headers.forEach((hh, i) => { obj[hh] = vals[i]; });
    return {
      ticker:   obj.ticker,
      name:     obj.name,
      sector:   obj.sector,
      roe:      parseFloat(obj.roe),
      revCAGR:  parseFloat(obj.revCAGR),
      epsCAGR:  parseFloat(obj.epsCAGR),
      pe:       parseFloat(obj.pe),
      beta:     null,
      betaStatus: "idle",
    };
  });
}

function passesFundamentals(s) {
  return s.roe >= FILTERS.roe &&
         s.revCAGR >= FILTERS.revCAGR &&
         s.epsCAGR >= FILTERS.epsCAGR &&
         s.pe <= FILTERS.pe;
}

function passesAll(s) {
  const b = s.beta ?? 999;
  return passesFundamentals(s) &&
         SELECTED_SECTORS.has(s.sector) &&
         b <= FILTERS.beta;
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

  // funnel
  const universe         = stocks;
  const fundPass         = useMemo(()=>universe.filter(passesFundamentals),[universe]);
  const sectorPass       = useMemo(()=>fundPass.filter(s=>SELECTED_SECTORS.has(s.sector)),[fundPass]);
  const portfolio        = useMemo(()=>sectorPass.filter(s=>s.beta!=null && s.beta<=FILTERS.beta),[sectorPass]);

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
    const key = sortKey==="beta"?(s=>s.beta??999):(s=>s[sortKey]);
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
      {/* metric cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:24}}>
        <MetricCard label="Universe"        value={universe.length.toLocaleString()} sub="Nifty 500 stocks"/>
        <MetricCard label="Pass fundamental" value={fundPass.length} sub={`RoE · CAGR · P/E filters`} color={C.accent}/>
        <MetricCard label="Sectors selected" value={`${SELECTED_SECTORS.size} of ${totalSectors}`} sub="Active sector conviction"/>
        <MetricCard label="In portfolio"    value={portfolio.length} sub="After beta filter" color={C.green}/>
        <MetricCard label="Sharpe ratio"    value="1.53" sub="5Y backtest vs SENSEX" color={C.accent}/>
        <MetricCard label="Next rebalance"  value={fmtDate(NEXT_REBALANCE)}
          sub={daysUntil(NEXT_REBALANCE)>0?`${daysUntil(NEXT_REBALANCE)} days away`:"Due now"}
          color={daysUntil(NEXT_REBALANCE)<=14?C.amber:C.primary}
          warn={daysUntil(NEXT_REBALANCE)<=14}/>
      </div>

      {/* funnel + donut */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>

        {/* selection funnel */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
          <div style={{fontSize:11,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.07em"}}>Selection funnel</div>
          <FunnelBar label="Nifty 500 universe"        count={universe.length}   total={universe.length}  color={C.accent}/>
          <FunnelBar label="Pass fundamental criteria" count={fundPass.length}   total={universe.length}  color="#8b5cf6"/>
          <FunnelBar label="In target sectors"         count={sectorPass.length} total={universe.length}  color={C.amber}/>
          <FunnelBar label="Final portfolio (β ≤ 1.2)" count={portfolio.length}  total={universe.length}  color={C.green}/>
          <div style={{marginTop:14,paddingTop:12,borderTop:`0.5px solid ${C.subtle}`,fontSize:11,color:C.muted}}>
            Filters: RoE ≥ 13% · Rev CAGR ≥ 7% · EPS CAGR ≥ 10% · P/E ≤ 20x · Beta ≤ 1.2
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
          {activeTab==="resources" && <ComingSoon title="Resources"
            description="Everything you need to understand how this strategy works, what each metric means, and why we built it this way."
            items={["How this strategy works — plain English","Metric glossary — RoE, CAGR, Beta, P/E explained","Why equal weight? Why quarterly rebalance?","Sector selection rationale","FAQ for first-time investors"]}/>}
        </div>
      </div>
    </div>
  );
}