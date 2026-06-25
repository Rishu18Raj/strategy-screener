import { useState, useMemo, useCallback } from "react";

const SECTORS = ["Energy","Financial Services","Banks","IT","Telecom","Shipping & Ports"];
const SECTOR_COLORS = {
  "Energy":            "#EF9F27",
  "Financial Services":"#378ADD",
  "Banks":             "#7F77DD",
  "IT":                "#D85A30",
  "Telecom":           "#1D9E75",
  "Shipping & Ports":  "#639922",
};

const STOCK_META = [
  { ticker:"NTPC",       name:"NTPC Ltd",               sector:"Energy",             roe:13.10, revCAGR:10.93, epsCAGR:11.93, pe:12.85 },
  { ticker:"ONGC",       name:"Oil & Natural Gas Corp",  sector:"Energy",             roe:14.21, revCAGR:16.86, epsCAGR:21.43, pe:7.14  },
  { ticker:"COALINDIA",  name:"Coal India Ltd",          sector:"Energy",             roe:42.06, revCAGR:13.34, epsCAGR:19.61, pe:8.65  },
  { ticker:"IOCL",       name:"Indian Oil Corp",         sector:"Energy",             roe:16.13, revCAGR:16.60, epsCAGR:14.24, pe:4.86  },
  { ticker:"BPCL",       name:"Bharat Petroleum",        sector:"Energy",             roe:23.84, revCAGR:14.61, epsCAGR:15.66, pe:5.25  },
  { ticker:"HPCL",       name:"Hindustan Petroleum",     sector:"Energy",             roe:18.33, revCAGR:13.63, epsCAGR:11.60, pe:4.88  },
  { ticker:"CPCL",       name:"Chennai Petroleum",       sector:"Energy",             roe:33.32, revCAGR:23.42, epsCAGR:64.54, pe:5.32  },
  { ticker:"OIL",        name:"Oil India Ltd",           sector:"Energy",             roe:16.91, revCAGR:14.02, epsCAGR:11.84, pe:10.08 },
  { ticker:"PFC",        name:"Power Finance Corp",      sector:"Financial Services", roe:20.91, revCAGR:10.01, epsCAGR:17.14, pe:5.58  },
  { ticker:"RECLTD",     name:"REC Ltd",                 sector:"Financial Services", roe:21.00, revCAGR:10.88, epsCAGR:14.26, pe:5.83  },
  { ticker:"HUDCO",      name:"HUDCO",                   sector:"Financial Services", roe:14.95, revCAGR:12.59, epsCAGR:20.64, pe:10.42 },
  { ticker:"LICHSGFIN",  name:"LIC Housing Finance",     sector:"Financial Services", roe:13.92, revCAGR:7.72,  epsCAGR:13.41, pe:5.45  },
  { ticker:"CANFINHOME", name:"Can Fin Homes",           sector:"Financial Services", roe:18.54, revCAGR:15.88, epsCAGR:18.94, pe:10.86 },
  { ticker:"MUTHOOTFIN", name:"Muthoot Finance",         sector:"Financial Services", roe:22.80, revCAGR:22.04, epsCAGR:22.69, pe:11.78 },
  { ticker:"CHOLAFIN",   name:"Cholamandalam Finance",   sector:"Financial Services", roe:18.40, revCAGR:22.96, epsCAGR:24.23, pe:12.54 },
  { ticker:"IIFLSEC",    name:"IIFL Finance",            sector:"Financial Services", roe:13.83, revCAGR:17.47, epsCAGR:16.65, pe:13.26 },
  { ticker:"IIFLCAP",    name:"IIFL Capital",            sector:"Financial Services", roe:25.92, revCAGR:23.55, epsCAGR:20.46, pe:18.96 },
  { ticker:"BANKBARODA", name:"Bank of Baroda",          sector:"Banks",              roe:13.96, revCAGR:12.56, epsCAGR:72.77, pe:7.33  },
  { ticker:"UNIONBANK",  name:"Union Bank of India",     sector:"Banks",              roe:14.13, revCAGR:9.03,  epsCAGR:41.80, pe:6.91  },
  { ticker:"CANBK",      name:"Canara Bank",             sector:"Banks",              roe:15.56, revCAGR:12.46, epsCAGR:41.58, pe:6.56  },
  { ticker:"JKB",        name:"J&K Bank",                sector:"Banks",              roe:14.07, revCAGR:10.15, epsCAGR:28.98, pe:7.45  },
  { ticker:"KARURVYSYA", name:"Karur Vysya Bank",        sector:"Banks",              roe:16.08, revCAGR:15.15, epsCAGR:47.30, pe:11.31 },
  { ticker:"TNMERCBANK", name:"TN Mercantile Bank",      sector:"Banks",              roe:14.89, revCAGR:10.03, epsCAGR:14.81, pe:9.01  },
  { ticker:"UJJIVANSFB", name:"Ujjivan Small Finance",   sector:"Banks",              roe:14.62, revCAGR:19.82, epsCAGR:187.13,pe:16.03 },
  { ticker:"INFY",       name:"Infosys Ltd",             sector:"IT",                 roe:30.67, revCAGR:12.20, epsCAGR:10.37, pe:14.23 },
  { ticker:"ECLERX",     name:"eClerx Services",         sector:"IT",                 roe:26.58, revCAGR:21.35, epsCAGR:24.16, pe:18.55 },
  { ticker:"ZENSARTECH", name:"Zensar Technologies",     sector:"IT",                 roe:16.65, revCAGR:8.51,  epsCAGR:18.97, pe:12.93 },
  { ticker:"BLS",        name:"BLS International",       sector:"IT",                 roe:31.48, revCAGR:44.35, epsCAGR:68.66, pe:15.63 },
  { ticker:"INDUSTOWER", name:"Indus Towers",            sector:"Telecom",            roe:23.68, revCAGR:18.42, epsCAGR:15.10, pe:14.70 },
  { ticker:"GESHIP",     name:"GE Shipping Co",          sector:"Shipping & Ports",   roe:17.89, revCAGR:10.15, epsCAGR:29.40, pe:7.30  },
];

const FILTERS_DEFAULT = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };

function passes(s, f) {
  const beta = s.beta ?? 0.9;
  return s.roe>=f.roe && s.revCAGR>=f.revCAGR && s.epsCAGR>=f.epsCAGR && beta<=f.beta && s.pe<=f.pe;
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-lg)",padding:"12px 16px"}}>
      <div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:500,color:color||"var(--color-text-primary)"}}>{value}</div>
      {sub && <div style={{fontSize:12,color:"var(--color-text-secondary)",marginTop:2}}>{sub}</div>}
    </div>
  );
}

function DonutChart({ data, size=130 }) {
  const total = data.reduce((s,d)=>s+d.count,0);
  if (!total) return null;
  let angle = -Math.PI/2;
  const cx=size/2,cy=size/2,r=size*0.38,inner=size*0.22;
  const slices = data.map(d=>{
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
      <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle" fontSize={18} fontWeight="500" fill="var(--color-text-primary)">{total}</text>
      <text x={cx} y={cy+14} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="var(--color-text-secondary)">stocks</text>
    </svg>
  );
}

export default function App() {
  const [stocks, setStocks]             = useState(STOCK_META.map(s=>({...s,beta:null,betaStatus:"idle"})));
  const [filters, setFilters]           = useState(FILTERS_DEFAULT);
  const [sectorFilter, setSectorFilter] = useState("All");
  const [showFailed, setShowFailed]     = useState(false);
  const [sortKey, setSortKey]           = useState("roe");
  const [sortDir, setSortDir]           = useState(-1);
  const [betaJson, setBetaJson]         = useState("");
  const [betaLoaded, setBetaLoaded]     = useState(false);
  const [jsonError, setJsonError]       = useState("");

  const applyBetaJson = useCallback(()=>{
    setJsonError("");
    try {
      const parsed = JSON.parse(betaJson);
      setStocks(prev=>prev.map(s=>({
        ...s,
        beta: parsed[s.ticker]!=null ? parsed[s.ticker] : s.beta,
        betaStatus: parsed[s.ticker]!=null ? "done" : "idle"
      })));
      setBetaLoaded(true);
    } catch(e) {
      setJsonError("Invalid JSON — copy the output from fetch_betas.py exactly.");
    }
  },[betaJson]);

  const screened = useMemo(()=>stocks.map(s=>({...s,status:passes(s,filters)?"PASS":"FAIL"})),[stocks,filters]);
  const passed   = screened.filter(s=>s.status==="PASS");

  const sectorData = useMemo(()=>SECTORS.map(sec=>({
    sector:sec, color:SECTOR_COLORS[sec],
    count: passed.filter(s=>s.sector===sec).length,
    total: screened.filter(s=>s.sector===sec).length,
  })),[passed,screened]);

  const displayed = useMemo(()=>{
    let list = showFailed ? screened : passed;
    if (sectorFilter!=="All") list=list.filter(s=>s.sector===sectorFilter);
    const key = sortKey==="beta" ? (s=>s.beta??0.9) : (s=>s[sortKey]);
    return [...list].sort((a,b)=>sortDir*(key(a)>key(b)?1:-1));
  },[screened,passed,showFailed,sectorFilter,sortKey,sortDir]);

  const toggleSort = k=>{ if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(-1);} };
  const setFilter  = (k,v)=>setFilters(f=>({...f,[k]:parseFloat(v)}));
  const betaDoneCount = stocks.filter(s=>s.betaStatus==="done").length;

  const SortHeader = ({label,k,right})=>(
    <th onClick={()=>toggleSort(k)} style={{padding:"8px 10px",cursor:"pointer",fontWeight:500,fontSize:12,
      color:"var(--color-text-secondary)",textAlign:right?"right":"left",whiteSpace:"nowrap",
      userSelect:"none",background:"var(--color-background-secondary)"}}>
      {label}{sortKey===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  return (
    <div style={{padding:"0",fontFamily:"var(--font-sans)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:600}}>Strategy 2 screener</div>
          <div style={{fontSize:13,color:"var(--color-text-secondary)"}}>30 stocks · 6 sectors · Screener.in fundamentals · Quarterly rebalance</div>
        </div>
        <span style={{fontSize:12,padding:"3px 10px",borderRadius:"var(--border-radius-md)",
          background:betaDoneCount>0?"var(--color-background-success)":"var(--color-background-warning)",
          color:betaDoneCount>0?"var(--color-text-success)":"var(--color-text-warning)"}}>
          {betaDoneCount>0?`Live beta · ${betaDoneCount}/${STOCK_META.length} stocks`:"Mock beta · paste JSON below"}
        </span>
      </div>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:20}}>
        <MetricCard label="Passing screen" value={passed.length} sub={`of ${STOCK_META.length} stocks`} color="var(--color-text-success)"/>
        <MetricCard label="Sectors active" value={sectorData.filter(s=>s.count>0).length} sub="of 6 sectors"/>
        <MetricCard label="Strategy Sharpe" value="1.53" sub="vs SENSEX 5Y"/>
        <MetricCard label="5Y total return" value="393%" sub="vs benchmark 93%"/>
      </div>

      {/* Sector breakdown */}
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
                    background:sectorFilter===s.sector?"var(--color-background-secondary)":"transparent"}}>
                  <div style={{width:10,height:10,borderRadius:2,background:s.color,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:13}}>{s.sector}</div>
                  <div style={{fontSize:13,color:"var(--color-text-secondary)"}}>{s.count}/{s.total}</div>
                  <div style={{width:80,height:5,borderRadius:3,background:"var(--color-border-tertiary)"}}>
                    <div style={{width:`${alloc}%`,height:"100%",borderRadius:3,background:s.color}}/>
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

      {/* Beta paste panel */}
      <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)",padding:"16px",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Beta — paste quarterly output</div>
        <div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:12}}>
          Run <code style={{background:"var(--color-background-secondary)",padding:"1px 6px",borderRadius:3}}>python fetch_betas.py</code> each quarter and paste the JSON output below.
        </div>
        <textarea value={betaJson} onChange={e=>setBetaJson(e.target.value)}
          placeholder={'{\n  "NTPC": 1.11,\n  "INFY": 0.68,\n  ...\n}'}
          rows={4}
          style={{width:"100%",padding:"8px 10px",borderRadius:"var(--border-radius-md)",
            border:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-secondary)",
            color:"var(--color-text-primary)",fontSize:12,boxSizing:"border-box",fontFamily:"monospace",resize:"vertical"}}/>
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8,flexWrap:"wrap"}}>
          <button onClick={applyBetaJson} disabled={!betaJson.trim()}
            style={{padding:"8px 18px",borderRadius:"var(--border-radius-md)",border:"none",
              cursor:betaJson.trim()?"pointer":"not-allowed",fontWeight:500,fontSize:13,
              background:betaJson.trim()?"var(--color-background-info)":"var(--color-background-secondary)",
              color:betaJson.trim()?"var(--color-text-info)":"var(--color-text-secondary)"}}>
            Apply betas
          </button>
          {betaLoaded&&<span style={{fontSize:12,color:"var(--color-text-success)"}}>✓ {betaDoneCount} stocks updated</span>}
          {jsonError&&<span style={{fontSize:12,color:"var(--color-text-danger)"}}>{jsonError}</span>}
        </div>
      </div>

      {/* Filter sliders */}
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
                <span style={{fontWeight:500,color:"var(--color-text-primary)"}}>{parseFloat(filters[k]).toFixed(k==="beta"?2:1)}{suffix}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={filters[k]} onChange={e=>setFilter(k,e.target.value)}/>
            </div>
          ))}
        </div>
      </div>

      {/* Table controls */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:500}}>
          {sectorFilter!=="All"?`${sectorFilter} · `:""}
          {displayed.length} {showFailed?"total":"passing"} stocks
        </div>
        <label style={{fontSize:13,color:"var(--color-text-secondary)",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
          <input type="checkbox" checked={showFailed} onChange={e=>setShowFailed(e.target.checked)}/>
          Show failed screens
        </label>
      </div>

      {/* Table */}
      <div style={{overflowX:"auto",border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"fixed"}}>
          <colgroup>
            <col style={{width:95}}/><col style={{width:155}}/><col style={{width:140}}/>
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
                  <td style={{padding:"9px 10px",fontWeight:500}}>{s.ticker}</td>
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
                    {v:`${betaVal.toFixed(2)}${betaLive?" ⚡":""}`, pass:betaVal<=filters.beta},
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
            No stocks match current filters. Try widening the thresholds.
          </div>
        )}
      </div>
      <div style={{marginTop:12,fontSize:12,color:"var(--color-text-secondary)"}}>
        ⚡ = live beta · Red = failing criterion · Click headers to sort · Click sectors to filter
      </div>
    </div>
  );
}