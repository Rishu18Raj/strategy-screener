import { useState, useEffect } from "react";
import Sidebar        from "./components/Sidebar";
import OverviewTab    from "./tabs/OverviewTab";
import PerformanceTab from "./tabs/PerformanceTab";
import ResourcesTab   from "./tabs/ResourcesTab";
import { C, fmtDate } from "./utils";

const BASE = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data";
export const URLS = {
  fundamentals:     `${BASE}/fundamentals.csv`,
  betas:            `${BASE}/betas.json`,
  perfSummary:      `${BASE}/performance_summary.json`,
  nav:              `${BASE}/nav.json`,
  tradeLog:         `${BASE}/trade_log.json`,
  portfolioCurrent: `${BASE}/portfolio_current.json`,
};

const TABS = [
  { id:"overview",    label:"Overview"             },
  { id:"performance", label:"Portfolio Performance" },
  { id:"explore",     label:"Build & Test"          },
  { id:"resources",   label:"Resources"             },
];

const DATA_QUARTER = "Q4 FY26";

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(x=>x.trim());
  return lines.slice(1).map(line=>{
    const vals=[]; let cur="", inQ=false;
    for (let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;continue;}
      if(line[i]===','&&!inQ){vals.push(cur.trim());cur="";continue;}
      cur+=line[i];
    }
    vals.push(cur.trim());
    const obj={};
    headers.forEach((h,i)=>{obj[h]=vals[i]??""});
    const pct=v=>parseFloat((v||"").replace("%","").replace(",",""));
    return {
      ticker:obj.ticker?.trim(), name:obj.name?.trim(), sector:obj.sector?.trim(),
      roe:pct(obj.roe), revCAGR:pct(obj.revCAGR), epsCAGR:pct(obj.epsCAGR), pe:pct(obj.pe),
      beta:null, betaStatus:"idle",
    };
  }).filter(s=>s.ticker);
}

export default function App() {
  const [activeTab,    setActiveTab]    = useState("overview");
  const [stocks,       setStocks]       = useState([]);
  const [dataStatus,   setDataStatus]   = useState("loading");
  const [betaStatus,   setBetaStatus]   = useState("loading");
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [perf,         setPerf]         = useState(null);
  const [nav,          setNav]          = useState(null);
  const [trades,       setTrades]       = useState(null);
  const [currentPort,  setCurrentPort]  = useState(null);

  useEffect(()=>{
    fetch(URLS.fundamentals).then(r=>{if(!r.ok)throw new Error();return r.text();})
      .then(t=>{setStocks(parseCSV(t));setDataStatus("ok");}).catch(()=>setDataStatus("error"));
  },[]);

  useEffect(()=>{
    fetch(URLS.betas).then(r=>{if(!r.ok)throw new Error();return r.json();})
      .then(d=>{
        setStocks(prev=>prev.map(s=>({
          ...s,
          beta:      d[s.ticker]??null,
          betaStatus:d[s.ticker]!=null?"done":"idle",
        })));
        setBetaStatus("ok");
      }).catch(()=>setBetaStatus("error"));
  },[]);

  useEffect(()=>{
    fetch(URLS.perfSummary).then(r=>r.json()).then(setPerf).catch(()=>{});
    fetch(URLS.nav).then(r=>r.json()).then(setNav).catch(()=>{});
    fetch(URLS.tradeLog).then(r=>r.json()).then(setTrades).catch(()=>{});
    fetch(URLS.portfolioCurrent).then(r=>r.json()).then(setCurrentPort).catch(()=>{});
  },[]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>

      {/* ── top bar ── */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 28px",height:52,borderBottom:`0.5px solid ${C.border}`,background:C.bg,zIndex:20}}>

        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:180}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>
            Fundamental Screener
          </span>
        </div>

        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex"}}>
          {TABS.map(t=>{
            const active = activeTab===t.id;
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

        <div style={{display:"flex",alignItems:"center",gap:14,fontSize:12,
          color:C.secondary,minWidth:180,justifyContent:"flex-end"}}>
          <span>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></span>
          <span style={{color:C.muted}}>·</span>
          <span>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>
            {betaStatus==="ok"?"Live":"Loading"}
          </span></span>
        </div>
      </div>

      {/* ── body ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <Sidebar collapsed={!sidebarOpen} onToggle={()=>setSidebarOpen(o=>!o)} perf={perf}/>

        <div style={{flex:1,overflowY:"auto",padding:"28px 32px",background:C.bg}}>
          {activeTab==="overview" && (
            dataStatus==="loading" ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                height:"50vh",color:C.secondary,fontSize:14}}>Loading universe...</div>
            ) : dataStatus==="error" ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",height:"50vh",gap:10}}>
                <div style={{fontSize:14,color:C.red}}>Could not load fundamentals.csv</div>
                <div style={{fontSize:12,color:C.secondary}}>Ensure the repo is public and data/fundamentals.csv exists.</div>
              </div>
            ) : (
              <OverviewTab stocks={stocks} betaStatus={betaStatus} perf={perf} currentPort={currentPort}/>
            )
          )}
          {activeTab==="performance" && (
            <PerformanceTab perf={perf} nav={nav} trades={trades}/>
          )}
          {activeTab==="explore" && (
            <ComingSoon
              title="Build & Test"
              description="Experiment with the strategy parameters and see how the portfolio composition would change."
              items={["Adjust all 5 screening filters with live sliders","Sector inclusion/exclusion toggle","See funnel change in real time","Compare your custom screen vs the base strategy","What-if scenarios — P/E at 25x, Beta at 1.5x"]}
            />
          )}
          {activeTab==="resources" && <ResourcesTab/>}
        </div>
      </div>
    </div>
  );
}

function ComingSoon({title,description,items}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"55vh",gap:20,textAlign:"center",padding:"60px 24px"}}>
      <div style={{width:48,height:48,borderRadius:12,background:C.card,border:`0.5px solid ${C.border}`,
        display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.secondary}}>◈</div>
      <div>
        <div style={{fontSize:19,fontWeight:600,marginBottom:8}}>{title}</div>
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