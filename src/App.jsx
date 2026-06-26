import { useState, useMemo, useEffect } from "react";

// ── constants ─────────────────────────────────────────────────
const SECTORS = ["Energy","Financial Services","Banks","IT","Telecom","Shipping & Ports"];
const SECTOR_COLORS = {
  "Energy":"#f59e0b","Financial Services":"#3b82f6","Banks":"#8b5cf6",
  "IT":"#ef4444","Telecom":"#22c55e","Shipping & Ports":"#06b6d4",
};
const FILTERS_DEFAULT = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };
const LAST_REBALANCE  = new Date("2026-06-25");
const NEXT_REBALANCE  = new Date("2026-09-25");
const DATA_QUARTER    = "Q4 FY26";
const FUNDAMENTALS_URL = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/fundamentals.csv";
const BETAS_URL        = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/betas.json";

const TABS = [
  { id:"overview",    label:"Overview"             },
  { id:"performance", label:"Portfolio Performance" },
  { id:"explore",     label:"Build & Test"          },
  { id:"resources",   label:"Resources"             },
];

// ── helpers ───────────────────────────────────────────────────
function parseCSV(text) {
  const [h,...rows] = text.trim().split("\n");
  const headers = h.split(",").map(x=>x.trim());
  return rows.map(row=>{
    const vals=row.split(",").map(v=>v.trim()), obj={};
    headers.forEach((hh,i)=>{ obj[hh]=vals[i]; });
    return {
      ticker:obj.ticker, name:obj.name, sector:obj.sector,
      roe:parseFloat(obj.roe), revCAGR:parseFloat(obj.revCAGR),
      epsCAGR:parseFloat(obj.epsCAGR), pe:parseFloat(obj.pe),
      beta:null, betaStatus:"idle",
    };
  });
}

function passes(s,f) {
  const b=s.beta??0.9;
  return s.roe>=f.roe && s.revCAGR>=f.revCAGR && s.epsCAGR>=f.epsCAGR && b<=f.beta && s.pe<=f.pe;
}

function daysUntil(d) { return Math.ceil((d-new Date())/(864e5)); }

function fmtDate(d) {
  return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}

// ── design tokens (JS) ────────────────────────────────────────
const C = {
  bg:        "var(--bg)",
  card:      "var(--bg-card)",
  hover:     "var(--bg-hover)",
  border:    "var(--border)",
  subtle:    "var(--border-subtle)",
  primary:   "var(--text-primary)",
  secondary: "var(--text-secondary)",
  muted:     "var(--text-muted)",
  accent:    "var(--accent)",
  accentDim: "var(--accent-dim)",
  green:     "var(--green)",
  greenDim:  "var(--green-dim)",
  red:       "var(--red)",
  redDim:    "var(--red-dim)",
  amber:     "var(--amber)",
  amberDim:  "var(--amber-dim)",
};

// ── shared primitives ─────────────────────────────────────────
const pill = (bg,color,label) => (
  <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:bg,color,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
    {label}
  </span>
);

function MetricCard({label,value,sub,color,warn}) {
  return (
    <div style={{background:C.card,borderRadius:8,padding:"16px 18px",
      border:`0.5px solid ${warn?C.amber:C.border}`,transition:"border 0.2s"}}>
      <div style={{fontSize:10,color:C.secondary,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>{label}</div>
      <div style={{fontSize:26,fontWeight:700,color:color||C.primary,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:C.secondary,marginTop:6,lineHeight:1.4}}>{sub}</div>}
    </div>
  );
}

function DonutChart({data,size=120}) {
  const total=data.reduce((s,d)=>s+d.count,0);
  if(!total) return null;
  let a=-Math.PI/2;
  const cx=size/2,cy=size/2,r=size*.38,ri=size*.23;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {data.map((d,i)=>{
        const sw=(d.count/total)*2*Math.PI;
        const x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a); a+=sw;
        const x2=cx+r*Math.cos(a),y2=cy+r*Math.sin(a);
        const xi1=cx+ri*Math.cos(a-sw),yi1=cy+ri*Math.sin(a-sw);
        const xi2=cx+ri*Math.cos(a),yi2=cy+ri*Math.sin(a);
        const lg=sw>Math.PI?1:0;
        return <path key={i} d={`M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${lg},0 ${xi1},${yi1} Z`} fill={d.color} opacity={0.85}/>;
      })}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight="700" fill={C.primary}>{total}</text>
      <text x={cx} y={cy+14} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={C.secondary} letterSpacing="0.05em">STOCKS</text>
    </svg>
  );
}

function ComingSoon({title,description,items}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"55vh",gap:20,textAlign:"center",padding:"60px 24px"}}>
      <div style={{width:48,height:48,borderRadius:12,background:C.card,border:`0.5px solid ${C.border}`,
        display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.secondary}}>◈</div>
      <div>
        <div style={{fontSize:18,fontWeight:600,marginBottom:8,letterSpacing:"-0.01em"}}>{title}</div>
        <div style={{fontSize:13,color:C.secondary,maxWidth:460,lineHeight:1.7}}>{description}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,width:"100%",maxWidth:380}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",
            background:C.card,borderRadius:6,border:`0.5px solid ${C.border}`,textAlign:"left"}}>
            <div style={{width:4,height:4,borderRadius:"50%",background:C.muted,flexShrink:0}}/>
            <div style={{fontSize:12,color:C.secondary}}>{item}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,letterSpacing:"0.04em",textTransform:"uppercase"}}>In development</div>
    </div>
  );
}

// ── overview tab ──────────────────────────────────────────────
function OverviewTab({stocks,betaStatus}) {
  const [filters,setFilters]           = useState(FILTERS_DEFAULT);
  const [sectorFilter,setSectorFilter] = useState("All");
  const [showFailed,setShowFailed]     = useState(false);
  const [sortKey,setSortKey]           = useState("roe");
  const [sortDir,setSortDir]           = useState(-1);

  const screened = useMemo(()=>stocks.map(s=>({...s,status:passes(s,filters)?"PASS":"FAIL"})),[stocks,filters]);
  const passed   = screened.filter(s=>s.status==="PASS");
  const sectorData = useMemo(()=>SECTORS.map(sec=>({
    sector:sec, color:SECTOR_COLORS[sec],
    count:passed.filter(s=>s.sector===sec).length,
    total:screened.filter(s=>s.sector===sec).length,
  })),[passed,screened]);

  const displayed = useMemo(()=>{
    let list=showFailed?screened:passed;
    if(sectorFilter!=="All") list=list.filter(s=>s.sector===sectorFilter);
    const key=sortKey==="beta"?(s=>s.beta??0.9):(s=>s[sortKey]);
    return [...list].sort((a,b)=>sortDir*(key(a)>key(b)?1:-1));
  },[screened,passed,showFailed,sectorFilter,sortKey,sortDir]);

  const toggleSort = k=>{ if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(-1);} };
  const setFilter  = (k,v)=>setFilters(f=>({...f,[k]:parseFloat(v)}));
  const betaDone   = stocks.filter(s=>s.betaStatus==="done").length;
  const daysToNext = daysUntil(NEXT_REBALANCE);

  const Th = ({label,k,right})=>(
    <th onClick={()=>toggleSort(k)} style={{padding:"8px 12px",cursor:"pointer",fontWeight:500,fontSize:11,
      color:C.secondary,textAlign:right?"right":"left",whiteSpace:"nowrap",userSelect:"none",
      background:C.hover,letterSpacing:"0.04em",textTransform:"uppercase"}}>
      {label}{sortKey===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  return (
    <div>
      {/* metric cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:24}}>
        <MetricCard label="Passing screen" value={passed.length} sub={`of ${stocks.length} stocks`} color={C.green}/>
        <MetricCard label="Sectors active" value={sectorData.filter(s=>s.count>0).length} sub={`of ${SECTORS.length} sectors`}/>
        <MetricCard label="Sharpe ratio"   value="1.53" sub="5Y backtest vs SENSEX" color={C.accent}/>
        <MetricCard label="Last rebalance" value={fmtDate(LAST_REBALANCE)} sub="Quarterly cadence"/>
        <MetricCard label="Next rebalance" value={fmtDate(NEXT_REBALANCE)}
          sub={daysToNext>0?`${daysToNext} days away`:"Due now"}
          color={daysToNext<=14?C.amber:C.primary} warn={daysToNext<=14}/>
      </div>

      {/* sector breakdown */}
      <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.06em"}}>Sector allocation · Equal weight</div>
        <div style={{display:"flex",gap:24,alignItems:"center",flexWrap:"wrap"}}>
          <DonutChart data={sectorData.filter(s=>s.count>0)} size={120}/>
          <div style={{flex:1,minWidth:200}}>
            {sectorData.map(s=>{
              const alloc=passed.length>0?((s.count/passed.length)*100).toFixed(1):"0.0";
              return (
                <div key={s.sector} onClick={()=>setSectorFilter(f=>f===s.sector?"All":s.sector)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"5px 8px",borderRadius:5,
                    cursor:"pointer",marginBottom:2,transition:"background 0.12s",
                    background:sectorFilter===s.sector?C.hover:"transparent"}}>
                  <div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:12,color:sectorFilter===s.sector?C.primary:C.secondary}}>{s.sector}</div>
                  <div style={{fontSize:11,color:C.muted,minWidth:30}}>{s.count}/{s.total}</div>
                  <div style={{width:64,height:3,borderRadius:2,background:C.border}}>
                    <div style={{width:`${alloc}%`,height:"100%",borderRadius:2,background:s.color,transition:"width 0.3s"}}/>
                  </div>
                  <div style={{fontSize:11,color:C.secondary,minWidth:32,textAlign:"right"}}>{alloc}%</div>
                </div>
              );
            })}
          </div>
        </div>
        {sectorFilter!=="All"&&(
          <div style={{marginTop:12,fontSize:12,color:C.secondary}}>
            Sector: <strong style={{color:C.primary}}>{sectorFilter}</strong>
            <span style={{marginLeft:8,cursor:"pointer",color:C.accent}} onClick={()=>setSectorFilter("All")}>Clear ×</span>
          </div>
        )}
      </div>

      {/* filter sliders */}
      <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:16,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.06em"}}>Screening filters</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:16}}>
          {[
            {k:"roe",    label:"5Y avg RoE ≥",  min:5,  max:50, step:0.5,  suffix:"%"},
            {k:"revCAGR",label:"5Y rev CAGR ≥", min:0,  max:30, step:0.5,  suffix:"%"},
            {k:"epsCAGR",label:"5Y EPS CAGR ≥", min:0,  max:50, step:0.5,  suffix:"%"},
            {k:"beta",   label:"3Y beta ≤",      min:0.4,max:2,  step:0.05, suffix:""},
            {k:"pe",     label:"P/E ≤",          min:3,  max:25, step:0.5,  suffix:"x"},
          ].map(({k,label,min,max,step,suffix})=>(
            <div key={k}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.secondary,marginBottom:6}}>
                <span>{label}</span>
                <span style={{fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>
                  {parseFloat(filters[k]).toFixed(k==="beta"?2:1)}{suffix}
                </span>
              </div>
              <input type="range" min={min} max={max} step={step} value={filters[k]} onChange={e=>setFilter(k,e.target.value)}/>
            </div>
          ))}
        </div>
      </div>

      {/* table */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:13,fontWeight:500,color:C.secondary}}>
          {sectorFilter!=="All"?`${sectorFilter} · `:""}<span style={{color:C.primary,fontWeight:600}}>{displayed.length}</span> {showFailed?"total":"passing"} stocks
        </div>
        <label style={{fontSize:12,color:C.secondary,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
          <input type="checkbox" checked={showFailed} onChange={e=>setShowFailed(e.target.checked)}/>
          Show all
        </label>
      </div>
      <div style={{overflowX:"auto",border:`0.5px solid ${C.border}`,borderRadius:8}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <Th label="Ticker" k="ticker"/>
              <Th label="Company" k="name"/>
              <Th label="Sector" k="sector"/>
              <Th label="RoE %" k="roe" right/>
              <Th label="Rev CAGR" k="revCAGR" right/>
              <Th label="EPS CAGR" k="epsCAGR" right/>
              <Th label={`Beta ${betaStatus==="ok"?"⚡":""}`} k="beta" right/>
              <Th label="P/E" k="pe" right/>
              <th style={{padding:"8px 12px",fontSize:11,fontWeight:500,color:C.secondary,
                background:C.hover,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((s,i)=>{
              const pass=s.status==="PASS";
              const bv=s.beta??0.9;
              return (
                <tr key={s.ticker} style={{borderTop:`0.5px solid ${C.subtle}`,
                  background:i%2===0?"transparent":C.card+"55",transition:"background 0.1s"}}>
                  <td style={{padding:"10px 12px",fontWeight:600,fontFamily:"var(--font-mono)",fontSize:12,color:C.primary}}>{s.ticker}</td>
                  <td style={{padding:"10px 12px",color:C.secondary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{s.name}</td>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,fontWeight:500,
                      background:SECTOR_COLORS[s.sector]+"18",color:SECTOR_COLORS[s.sector],whiteSpace:"nowrap"}}>
                      {s.sector}
                    </span>
                  </td>
                  {[
                    {v:s.roe.toFixed(1)+"%",     ok:s.roe>=filters.roe},
                    {v:s.revCAGR.toFixed(1)+"%", ok:s.revCAGR>=filters.revCAGR},
                    {v:s.epsCAGR.toFixed(1)+"%", ok:s.epsCAGR>=filters.epsCAGR},
                    {v:bv.toFixed(2),             ok:bv<=filters.beta},
                    {v:s.pe.toFixed(1)+"x",       ok:s.pe<=filters.pe},
                  ].map((cell,ci)=>(
                    <td key={ci} style={{padding:"10px 12px",textAlign:"right",
                      color:cell.ok?C.primary:C.red,fontWeight:cell.ok?400:500,
                      fontFamily:"var(--font-mono)",fontSize:12}}>
                      {cell.v}
                    </td>
                  ))}
                  <td style={{padding:"10px 12px",textAlign:"right"}}>
                    {pill(pass?C.greenDim:C.redDim, pass?C.green:C.red, pass?"PASS":"FAIL")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayed.length===0&&(
          <div style={{padding:"48px",textAlign:"center",color:C.muted,fontSize:13}}>
            No stocks match the current filters.
          </div>
        )}
      </div>
      <div style={{marginTop:10,fontSize:11,color:C.muted}}>
        ⚡ Live beta · Failing criteria in red · Click column headers to sort · Click sectors to filter
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
        setStocks(prev=>prev.map(s=>({...s,beta:d[s.ticker]??null,betaStatus:d[s.ticker]!=null?"done":"idle"})));
        setBetaStatus("ok");
      })
      .catch(()=>setBetaStatus("error"));
  },[]);

  const daysToNext = daysUntil(NEXT_REBALANCE);

  return (
    <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gridTemplateRows:"auto 1fr",minHeight:"100vh"}}>

      {/* ── top bar (full width) ── */}
      <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 32px",height:56,borderBottom:`0.5px solid ${C.border}`,background:C.bg}}>

        {/* left: wordmark */}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>Fundamental Screener</span>
        </div>

        {/* center: tabs */}
        <div style={{display:"flex",gap:0,position:"absolute",left:"50%",transform:"translateX(-50%)"}}>
          {TABS.map(t=>{
            const active=activeTab===t.id;
            return (
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{padding:"0 18px",height:56,border:"none",borderBottom:active?`2px solid ${C.accent}`:"2px solid transparent",
                  background:"transparent",color:active?C.primary:C.secondary,fontWeight:active?600:400,
                  fontSize:13,cursor:"pointer",transition:"all 0.15s",fontFamily:"Inter,sans-serif",whiteSpace:"nowrap"}}>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* right: data freshness */}
        <div style={{display:"flex",alignItems:"center",gap:16,fontSize:11,color:C.secondary}}>
          <span>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></span>
          <span style={{color:C.muted}}>|</span>
          <span>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>{betaStatus==="ok"?"Live":"—"}</span></span>
          <span style={{color:C.muted}}>|</span>
          <span>As of <span style={{color:C.primary,fontWeight:500}}>{fmtDate(new Date())}</span></span>
        </div>
      </div>

      {/* ── left sidebar ── */}
      <div style={{borderRight:`0.5px solid ${C.border}`,padding:"28px 20px",background:C.bg,
        display:"flex",flexDirection:"column",gap:24}}>

        {/* rebalance status */}
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Rebalance</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:C.secondary,marginBottom:3}}>Last</div>
              <div style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(LAST_REBALANCE)}</div>
            </div>
            <div style={{background:daysToNext<=14?C.amberDim:C.card,
              border:`0.5px solid ${daysToNext<=14?C.amber:C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:C.secondary,marginBottom:3}}>Next</div>
              <div style={{fontSize:12,fontWeight:600,color:daysToNext<=14?C.amber:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(NEXT_REBALANCE)}</div>
              <div style={{fontSize:10,color:C.secondary,marginTop:2}}>{daysToNext>0?`${daysToNext}d away`:"Due now"}</div>
            </div>
          </div>
        </div>

        {/* strategy stats */}
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
              <span style={{fontSize:11,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>

        {/* about — placeholder */}
        <div style={{marginTop:"auto"}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,fontWeight:500}}>About</div>
          <div style={{fontSize:11,color:C.secondary,lineHeight:1.6}}>
            IIMB MBA · Deutsche Bank IB alumni · Built for hobby investors who want institutional-grade equity screening.
          </div>
        </div>
      </div>

      {/* ── main content ── */}
      <div style={{padding:"28px 32px",overflowY:"auto",background:C.bg}}>
        {activeTab==="overview" && (
          dataStatus==="loading" ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:C.secondary,fontSize:13}}>
              Loading...
            </div>
          ) : dataStatus==="error" ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"50vh",gap:10}}>
              <div style={{fontSize:13,color:C.red}}>Could not load fundamentals.csv from GitHub.</div>
              <div style={{fontSize:11,color:C.secondary}}>Ensure <code>data/fundamentals.csv</code> exists and the repo is public.</div>
            </div>
          ) : (
            <OverviewTab stocks={stocks} betaStatus={betaStatus}/>
          )
        )}
        {activeTab==="performance"&&<ComingSoon title="Portfolio Performance"
          description="Track how the Strategy 2 portfolio has performed since inception against the SENSEX, sector by sector, and stock by stock."
          items={["Cumulative return chart — portfolio vs SENSEX","Quarterly active return bars","Stock-level contribution to return","Key winners since inception","Max drawdown & recovery periods"]}/>}
        {activeTab==="explore"&&<ComingSoon title="Build & Test"
          description="Experiment with the strategy parameters and see how the portfolio composition and historical returns would change."
          items={["Adjust any of the 5 screening filters","See live stock count and sector mix change","Compare your custom screen vs the base strategy","What-if scenarios — P/E at 25x, Beta at 1.5x, etc."]}/>}
        {activeTab==="resources"&&<ComingSoon title="Resources"
          description="Everything you need to understand how this strategy works, what each metric means, and why we built it this way."
          items={["How this strategy works — plain English","Metric glossary — RoE, CAGR, Beta, P/E explained","Why equal weight? Why quarterly rebalance?","Sector selection rationale","FAQ for first-time investors"]}/>}
      </div>

    </div>
  );
}