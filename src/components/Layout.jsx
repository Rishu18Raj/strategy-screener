import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { C, DATA_QUARTER, TABS, URLS } from "../config";
import Sidebar from "./Sidebar";
import { parseCSV } from "../utils/strategy";

export default function Layout(){
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

  // Passed to every page via <Outlet context={...}/> and read with
  // useOutletContext() — this is what lets each page live at its own URL
  // while still sharing one set of fetches instead of every page re-fetching
  // the same data independently.
  const outletContext = { stocks, dataStatus, betaStatus, perf, nav, trades };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",height:52,borderBottom:`0.5px solid ${C.border}`,background:C.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:180}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>Fundamental Screener</span>
        </div>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex"}}>
          {TABS.map(t=>(
            <NavLink
              key={t.id}
              to={t.path}
              end={t.path==="/"}
              style={({isActive})=>({padding:"0 18px",height:52,display:"flex",alignItems:"center",border:"none",borderBottom:isActive?`2px solid ${C.accent}`:"2px solid transparent",background:"transparent",color:isActive?C.primary:C.secondary,fontWeight:isActive?600:400,fontSize:13,cursor:"pointer",transition:"all 0.15s",fontFamily:"Inter,sans-serif",whiteSpace:"nowrap",textDecoration:"none"})}
            >
              {t.label}
            </NavLink>
          ))}
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
          <Outlet context={outletContext}/>
        </div>
      </div>
    </div>
  );
}
