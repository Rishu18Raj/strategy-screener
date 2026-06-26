import { useState, useMemo, useEffect } from "react";

// ── constants ────────────────────────────────────────────────
const SECTORS = ["Energy","Financial Services","Banks","IT","Telecom","Shipping & Ports"];
const SECTOR_COLORS = {
  "Energy":"#EF9F27","Financial Services":"#378ADD","Banks":"#7F77DD",
  "IT":"#D85A30","Telecom":"#1D9E75","Shipping & Ports":"#639922",
};
const FILTERS_DEFAULT = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };
const LAST_REBALANCE  = new Date("2026-06-25");
const NEXT_REBALANCE  = new Date("2026-09-25");
const FUNDAMENTALS_URL = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/fundamentals.csv";
const BETAS_URL        = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data/betas.json";

const TABS = [
  { id:"overview",     label:"Overview",             icon:"◈" },
  { id:"performance",  label:"Portfolio Performance", icon:"↗" },
  { id:"explore",      label:"Build & Test",          icon:"⚙" },
  { id:"resources",    label:"Resources",             icon:"?" },
];

// ── helpers ──────────────────────────────────────────────────
function parseCSV(text) {
  const [headerLine, ...rows] = text.trim().split("\n");
  const headers = headerLine.split(",").map(h=>h.trim());
  return rows.map(row=>{
    const vals = row.split(",").map(v=>v.trim());
    const obj  = {};
    headers.forEach((h,i)=>{ obj[h]=vals[i]; });
    return {
      ticker:obj.ticker, name:obj.name, sector:obj.sector,
      roe:parseFloat(obj.roe), revCAGR:parseFloat(obj.revCAGR),
      epsCAGR:parseFloat(obj.epsCAGR), pe:parseFloat(obj.pe),
      beta:null, betaStatus:"idle",
    };
  });
}

function passes(s,f) {
  const beta=s.beta??0.9;
  return s.roe>=f.roe && s.revCAGR>=f.revCAGR && s.epsCAGR>=f.epsCAGR && beta<=f.beta && s.pe<=f.pe;
}

function daysUntil(date) {
  return Math.ceil((date-new Date())/(1000*60*60*24));
}

function fmtDate(date) {
  return date.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}

// ── shared ui ────────────────────────────────────────────────
function MetricCard({label,value,sub,color,highlight}) {
  return (
    <div style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-lg)",
      padding:"14px 16px",border:highlight?"0.5px solid var(--color-text-info)":"0.5px solid transparent"}}>
      <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
      <div style={{fontSize:24,fontWeight:600,color:color||"var(--color-text-primary)",lineHeight:1.1}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:"var(--color-text-secondary)",marginTop:4}}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ok,label}) {
  return (
    <span style={{fontSize:11,padding:"3px 10px",borderRadius:"var(--border-radius-md)",fontWeight:500,
      background:ok?"var(--color-background-success)":"var(--color-background-warning)",
      color:ok?"var(--color-text-success)":"var(--color-text-warning)"}}>
      {label}
    </span>
  );
}

function DonutChart({data,size=130}) {
  const total=data.reduce((s,d)=>s+d.count,0);
  if(!total) return null;
  let angle=-Math.PI/2;
  const cx=size/2,cy=size/2,r=size*0.38,inner=size*0.22;
  const slices=data.map(d=>{
    const sweep=(d.count/total)*2*Math.PI;
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle);
    angle+=sweep;
    const x2=cx+r*Math.cos(angle),y2=cy+r*Math.sin(angle);
    const xi1=cx+inner*Math.cos(angle-sweep),yi1=cy+inner*Math.sin(angle-sweep);
    const xi2=cx+inner*Math.cos(angle),yi2=cy+inner*Math.sin(angle);
    const large=sweep>Math.PI?1:0;
    return {path:`M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${large},0 ${xi1},${yi1} Z`,color:d.color};
  });
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {slices.map((s,i)=><path key={i} d={s.path} fill={s.color} opacity={0.9}/>)}
      <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle" fontSize={18} fontWeight="600" fill="var(--color-text-primary)">{total}</text>
      <text x={cx} y={cy+14} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="var(--color-text-secondary)">stocks</text>
    </svg>
  );
}

// ── placeholder tab ───────────────────────────────────────────
function ComingSoon({title, description, items}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"60vh",gap:24,textAlign:"center",padding:"40px 20px"}}>
      <div style={{fontSize:40,opacity:0.2}}>◈</div>
      <div>
        <div style={{fontSize:20,fontWeight:600,marginBottom:8}}>{title}</div>
        <div style={{fontSize:14,color:"var(--color-text-secondary)",maxWidth:480,lineHeight:1.6}}>{description}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,width:"100%",maxWidth:400}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",
            background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",
            border:"0.5px solid var(--color-border-tertiary)",textAlign:"left"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"var(--color-text-secondary)",flexShrink:0}}/>
            <div style={{fontSize:13,color:"var(--color-text-secondary)"}}>{item}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:12,color:"var(--color-text-secondary)",opacity:0.5}}>Coming in next build</div>
    </div>
  );
}

// ── overview tab ─────────────────────────────────────────────
function OverviewTab({stocks,dataStatus,betaStatus,lastUpdated}) {
  const [filters,setFilters]           = useState(FILTERS_DEFAULT);
  const [sectorFilter,setSectorFilter] = useState("All");
  const [showFailed,setShowFailed]     = useState(false);
  const [sortKey,setSortKey]           = useState("roe");
  const [sortDir,setSortDir]           = useState(-1);

  const screened = useMemo(()=>stocks.map(s=>({...s,status:passes(s,filters)?"PASS":"FAIL"})),[stocks,filters]);
  const passed   = screened.filter(s=>s.status==="PASS");

  const sectorData = useMemo(()=>SECTORS.map(sec=>({
    sector:sec,color:SECTOR_COLORS[sec],
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

  const SortHeader = ({label,k,right})=>(
    <th onClick={()=>toggleSort(k)} style={{padding:"8px 10px",cursor:"pointer",fontWeight:500,fontSize:12,
      color:"var(--color-text-secondary)",textAlign:right?"right":"left",whiteSpace:"nowrap",
      userSelect:"none",background:"var(--color-background-secondary)"}}>
      {label}{sortKey===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  return (
    <div>
      {/* status badges */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        <StatusBadge ok={dataStatus==="ok"} label={dataStatus==="ok"?`Fundamentals · ${lastUpdated?.toLocaleDateString("en-IN")}`:"Fundamentals unavailable"}/>
        <StatusBadge ok={betaStatus==="ok"} label={betaStatus==="ok"?`Beta · ${betaDone}/${stocks.length} stocks`:"Beta unavailable"}/>
      </div>

      {/* metric cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:20}}>
        <MetricCard label="Passing screen" value={passed.length} sub={`of ${stocks.length} stocks`} color="var(--color-text-success)"/>
        <MetricCard label="Sectors active" value={sectorData.filter(s=>s.count>0).length} sub={`of ${SECTORS.length} sectors`}/>
        <MetricCard label="Sharpe ratio" value="1.53" sub="5Y backtest vs SENSEX" color="var(--color-text-info)"/>
        <MetricCard label="Last rebalance" value={fmtDate(LAST_REBALANCE)} sub="Quarterly cadence"/>
        <MetricCard label="Next rebalance" value={fmtDate(NEXT_REBALANCE)}
          sub={daysToNext>0?`${daysToNext} days away`:"Due now"}
          color={daysToNext<=14?"var(--color-text-warning)":"var(--color-text-primary)"}
          highlight={daysToNext<=14}/>
      </div>

      {/* sector breakdown */}
      <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)",padding:"16px",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:500,marginBottom:14}}>Sector breakdown & equal-weight allocation</div>
        <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
          <DonutChart data={sectorData.filter(s=>s.count>0)} size={130}/>
          <div style={{flex:1,minWidth:220}}>
            {sectorData.map(s=>{
              const alloc=passed.length>0?((s.count/passed.length)*100).toFixed(1):"0.0";
              return (
                <div key={s.sector} onClick={()=>setSectorFilter(f=>f===s.sector?"All":s.sector)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",
                    borderRadius:"var(--border-radius-md)",cursor:"pointer",marginBottom:2,
                    background:sectorFilter===s.sector?"var(--color-background-secondary)":"transparent",
                    transition:"background 0.15s"}}>
                  <div style={{width:10,height:10,borderRadius:2,background:s.color,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:13}}>{s.sector}</div>
                  <div style={{fontSize:12,color:"var(--color-text-secondary)"}}>{s.count}/{s.total}</div>
                  <div style={{width:80,height:4,borderRadius:3,background:"var(--color-border-tertiary)"}}>
                    <div style={{width:`${alloc}%`,height:"100%",borderRadius:3,background:s.color,transition:"width 0.3s"}}/>
                  </div>
                  <div style={{fontSize:12,color:"var(--color-text-secondary)",minWidth:36,textAlign:"right"}}>{alloc}%</div>
                </div>
              );
            })}
          </div>
        </div>
        {sectorFilter!=="All"&&(
          <div style={{marginTop:10,fontSize:12,color:"var(--color-text-secondary)"}}>
            Filtering by <strong>{sectorFilter}</strong> — <span style={{cursor:"pointer",color:"var(--color-text-info)",textDecoration:"underline"}} onClick={()=>setSectorFilter("All")}>clear</span>
          </div>
        )}
      </div>

      {/* filter sliders */}
      <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)",padding:"16px",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:500,marginBottom:12}}>Screening filters</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14}}>
          {[
            {k:"roe",    label:"5Y avg RoE ≥",  min:5,   max:50, step:0.5,  suffix:"%"},
            {k:"revCAGR",label:"5Y rev CAGR ≥", min:0,   max:30, step:0.5,  suffix:"%"},
            {k:"epsCAGR",label:"5Y EPS CAGR ≥", min:0,   max:50, step:0.5,  suffix:"%"},
            {k:"beta",   label:"3Y beta ≤",      min:0.4, max:2,  step:0.05, suffix:""},
            {k:"pe",     label:"P/E ≤",          min:3,   max:25, step:0.5,  suffix:"x"},
          ].map(({k,label,min,max,step,suffix})=>(
            <div key={k}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--color-text-secondary)",marginBottom:4}}>
                <span>{label}</span>
                <span style={{fontWeight:600,color:"var(--color-text-primary)"}}>{parseFloat(filters[k]).toFixed(k==="beta"?2:1)}{suffix}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={filters[k]} onChange={e=>setFilter(k,e.target.value)}/>
            </div>
          ))}
        </div>
      </div>

      {/* table */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:500}}>
          {sectorFilter!=="All"?`${sectorFilter} · `:""}{displayed.length} {showFailed?"total":"passing"} stocks
        </div>
        <label style={{fontSize:13,color:"var(--color-text-secondary)",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
          <input type="checkbox" checked={showFailed} onChange={e=>setShowFailed(e.target.checked)}/>
          Show failed screens
        </label>
      </div>
      <div style={{overflowX:"auto",border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"fixed"}}>
          <colgroup>
            <col style={{width:95}}/><col style={{width:155}}/><col style={{width:145}}/>
            <col style={{width:65}}/><col style={{width:72}}/><col style={{width:78}}/><col style={{width:78}}/><col style={{width:55}}/><col style={{width:70}}/>
          </colgroup>
          <thead>
            <tr>
              <SortHeader label="Ticker" k="ticker"/>
              <SortHeader label="Company" k="name"/>
              <SortHeader label="Sector" k="sector"/>
              <SortHeader label="RoE %" k="roe" right/>
              <SortHeader label="RevCAGR" k="revCAGR" right/>
              <SortHeader label="EPS CAGR" k="epsCAGR" right/>
              <SortHeader label="Beta" k="beta" right/>
              <SortHeader label="P/E" k="pe" right/>
              <th style={{padding:"8px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",background:"var(--color-background-secondary)"}}>Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((s,i)=>{
              const pass=s.status==="PASS";
              const betaVal=s.beta??0.9;
              const betaLive=s.betaStatus==="done";
              return (
                <tr key={s.ticker} style={{borderTop:"0.5px solid var(--color-border-tertiary)",background:i%2===0?"transparent":"var(--color-background-secondary)"}}>
                  <td style={{padding:"9px 10px",fontWeight:600}}>{s.ticker}</td>
                  <td style={{padding:"9px 10px",fontSize:12,color:"var(--color-text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</td>
                  <td style={{padding:"9px 10px"}}>
                    <span style={{fontSize:11,padding:"2px 7px",borderRadius:"var(--border-radius-md)",
                      background:SECTOR_COLORS[s.sector]+"22",color:SECTOR_COLORS[s.sector],fontWeight:500,whiteSpace:"nowrap"}}>
                      {s.sector}
                    </span>
                  </td>
                  {[
                    {v:s.roe.toFixed(1),     pass:s.roe>=filters.roe},
                    {v:s.revCAGR.toFixed(1), pass:s.revCAGR>=filters.revCAGR},
                    {v:s.epsCAGR.toFixed(1), pass:s.epsCAGR>=filters.epsCAGR},
                    {v:`${betaVal.toFixed(2)}${betaLive?" ⚡":""}`,pass:betaVal<=filters.beta},
                    {v:s.pe.toFixed(2)+"x",  pass:s.pe<=filters.pe},
                  ].map((cell,ci)=>(
                    <td key={ci} style={{padding:"9px 10px",textAlign:"right",
                      color:cell.pass?"var(--color-text-primary)":"var(--color-text-danger)",fontWeight:cell.pass?400:500}}>
                      {cell.v}
                    </td>
                  ))}
                  <td style={{padding:"9px 10px"}}>
                    <span style={{fontSize:11,padding:"2px 8px",borderRadius:"var(--border-radius-md)",fontWeight:500,
                      background:pass?"var(--color-background-success)":"var(--color-background-danger)",
                      color:pass?"var(--color-text-success)":"var(--color-text-danger)"}}>
                      {pass?"Pass":"Fail"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayed.length===0&&(
          <div style={{padding:"40px",textAlign:"center",color:"var(--color-text-secondary)",fontSize:14}}>
            No stocks match current filters.
          </div>
        )}
      </div>
      <div style={{marginTop:12,fontSize:12,color:"var(--color-text-secondary)"}}>
        ⚡ = live beta · Red = failing criterion · Click headers to sort · Click sectors to filter
      </div>
    </div>
  );
}

// ── root app ──────────────────────────────────────────────────
export default function App() {
  const [activeTab,   setActiveTab]   = useState("overview");
  const [stocks,      setStocks]      = useState([]);
  const [dataStatus,  setDataStatus]  = useState("loading");
  const [betaStatus,  setBetaStatus]  = useState("loading");
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(()=>{
    fetch(FUNDAMENTALS_URL)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); })
      .then(text=>{ setStocks(parseCSV(text)); setDataStatus("ok"); setLastUpdated(new Date()); })
      .catch(()=>setDataStatus("error"));
  },[]);

  useEffect(()=>{
    fetch(BETAS_URL)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(parsed=>{
        setStocks(prev=>prev.map(s=>({
          ...s,
          beta:parsed[s.ticker]??null,
          betaStatus:parsed[s.ticker]!=null?"done":"idle",
        })));
        setBetaStatus("ok");
      })
      .catch(()=>setBetaStatus("error"));
  },[]);

  return (
    <div style={{fontFamily:"var(--font-sans)",minHeight:"100vh"}}>

      {/* ── global header ── */}
      <div style={{borderBottom:"0.5px solid var(--color-border-tertiary)",marginBottom:24,paddingBottom:0}}>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,letterSpacing:"-0.02em"}}>Strategy 2</div>
            <div style={{fontSize:13,color:"var(--color-text-secondary)",marginTop:2}}>
              IIMB Financial Markets · NSE · Equal-weight · Quarterly rebalance
            </div>
          </div>
          <div style={{fontSize:12,color:"var(--color-text-secondary)"}}>
            As of {fmtDate(new Date())}
          </div>
        </div>

        {/* tab bar */}
        <div style={{display:"flex",gap:0}}>
          {TABS.map(tab=>{
            const active=activeTab===tab.id;
            return (
              <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
                style={{padding:"10px 20px",border:"none",borderBottom:active?"2px solid var(--color-text-primary)":"2px solid transparent",
                  background:"transparent",color:active?"var(--color-text-primary)":"var(--color-text-secondary)",
                  fontWeight:active?600:400,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",
                  gap:6,transition:"all 0.15s",whiteSpace:"nowrap"}}>
                <span style={{fontSize:11,opacity:0.7}}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── tab content ── */}
      {activeTab==="overview" && (
        dataStatus==="loading" ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:"var(--color-text-secondary)",fontSize:14}}>
            Loading...
          </div>
        ) : dataStatus==="error" ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"50vh",gap:12}}>
            <div style={{fontSize:14,color:"var(--color-text-danger)"}}>Could not load fundamentals.csv from GitHub.</div>
            <div style={{fontSize:12,color:"var(--color-text-secondary)"}}>Make sure <code>data/fundamentals.csv</code> exists in the repo and the repo is public.</div>
          </div>
        ) : (
          <OverviewTab stocks={stocks} dataStatus={dataStatus} betaStatus={betaStatus} lastUpdated={lastUpdated}/>
        )
      )}

      {activeTab==="performance" && (
        <ComingSoon
          title="Portfolio Performance"
          description="Track how the Strategy 2 portfolio has performed since inception — against the SENSEX benchmark, sector by sector, and stock by stock."
          items={[
            "Cumulative return chart — portfolio vs SENSEX",
            "Quarterly active return bars",
            "Stock-level contribution to return",
            "Key winners since inception",
            "Max drawdown & recovery periods",
          ]}
        />
      )}

      {activeTab==="explore" && (
        <ComingSoon
          title="Build & Test"
          description="Experiment with the strategy parameters and see how the portfolio composition and historical returns would change."
          items={[
            "Adjust any of the 5 screening filters",
            "See live stock count and sector mix change",
            "Compare your custom screen vs the base strategy",
            "What-if scenarios — P/E at 25x, Beta at 1.5x, etc.",
          ]}
        />
      )}

      {activeTab==="resources" && (
        <ComingSoon
          title="Resources"
          description="Everything you need to understand how this strategy works, what each metric means, and why we built it this way."
          items={[
            "How this strategy works — plain English",
            "Metric glossary — RoE, CAGR, Beta, P/E explained",
            "Why equal weight? Why quarterly rebalance?",
            "Sector selection rationale",
            "FAQ for first-time investors",
          ]}
        />
      )}

    </div>
  );
}