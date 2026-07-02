import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { C, DATA_QUARTER, LAST_REBALANCE, NEXT_REBALANCE, TABS, URLS } from "../config";
import Sidebar from "./Sidebar";
import { parseCSV, daysUntil, fmtDate } from "../utils/strategy";

export default function Layout(){
  const location = useLocation();
  const [stocks,      setStocks]      = useState([]);
  const [dataStatus,  setDataStatus]  = useState("loading");
  const [betaStatus,  setBetaStatus]  = useState("loading");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [perf,        setPerf]        = useState(null);
  const [nav,         setNav]         = useState(null);
  const [trades,      setTrades]      = useState(null);
  
  const isPerformancePage = location.pathname === "/performance";

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"0 16px":"0 28px",height:52,borderBottom:`0.5px solid ${C.border}`,background:C.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:isMobile?"auto":180}}>
          {isMobile && (
            <button 
              onClick={()=>setMobileMenuOpen(!mobileMenuOpen)}
              style={{background:"none",border:"none",color:C.primary,fontSize:24,cursor:"pointer",padding:4,lineHeight:1}}
            >
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
          )}
          <div style={{width:7,height:7,borderRadius:"50%",background:C.accent}}/>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:"-0.01em",color:C.primary}}>Fundamental Screener</span>
        </div>
        {!isMobile && (
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
        )}
        <div style={{display:"flex",alignItems:"center",gap:isMobile?8:14,fontSize:12,color:C.secondary,minWidth:isMobile?"auto":180,justifyContent:"flex-end"}}>
          {!isMobile && (
            <>
              <span>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></span>
              <span style={{color:C.muted}}>·</span>
              <span>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>{betaStatus==="ok"?"Live":"Loading"}</span></span>
            </>
          )}
        </div>
      </div>
      
      {/* Mobile menu overlay */}
      {isMobile && mobileMenuOpen && (
        <div style={{position:"fixed",top:52,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:30}} onClick={()=>setMobileMenuOpen(false)}>
          <div style={{background:C.card,height:"100%",width:280,padding:20,overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {TABS.map(t=>(
                <NavLink
                  key={t.id}
                  to={t.path}
                  end={t.path==="/"}
                  onClick={()=>setMobileMenuOpen(false)}
                  style={({isActive})=>({padding:"12px 16px",borderRadius:6,background:isActive?C.hover:"transparent",color:isActive?C.primary:C.secondary,fontWeight:isActive?600:400,fontSize:14,textDecoration:"none",display:"block"})}
                >
                  {t.label}
                </NavLink>
              ))}
            </div>
            
            {/* Rebalance info */}
            <div style={{marginTop:24,paddingTop:24,borderTop:`0.5px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Rebalance</div>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Last</div>
                  <div style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(LAST_REBALANCE)}</div>
                </div>
                <div style={{background:daysUntil(NEXT_REBALANCE)<=14?C.amberDim:C.card,border:`0.5px solid ${daysUntil(NEXT_REBALANCE)<=14?C.amber:C.border}`,borderRadius:6,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Next</div>
                  <div style={{fontSize:12,fontWeight:600,color:daysUntil(NEXT_REBALANCE)<=14?C.amber:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(NEXT_REBALANCE)}</div>
                  <div style={{fontSize:11,color:C.secondary,marginTop:2}}>{daysUntil(NEXT_REBALANCE)>0?`${daysUntil(NEXT_REBALANCE)}d away`:"Due now"}</div>
                </div>
              </div>
            </div>

            {/* Performance metrics */}
            {perf && (
              <div style={{marginTop:24,paddingTop:24,borderTop:`0.5px solid ${C.border}`}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Live track record</div>
                {[
                  {label:"Total return",  value:`${perf.returns.total_pct>0?"+":""}${perf.returns.total_pct}%`},
                  {label:"Ann. return",   value:`${perf.returns.annualised_pct>0?"+":""}${perf.returns.annualised_pct}%`},
                  {label:"Alpha (ann)",   value:`${perf.returns.alpha_ann>0?"+":""}${perf.returns.alpha_ann}%`},
                  {label:"Sharpe",        value:perf.risk.sharpe},
                  {label:"Sortino",       value:perf.risk.sortino},
                  {label:"Info Ratio",    value:perf.risk.info_ratio},
                  {label:"Win rate",      value:`${perf.trades.win_rate_pct}%`},
                  {label:"Benchmark",     value:"SENSEX"},
                ].map(({label,value})=>(
                  <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}}>
                    <span style={{fontSize:11,color:C.secondary}}>{label}</span>
                    <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{marginTop:24,paddingTop:24,borderTop:`0.5px solid ${C.border}`}}>
              <div style={{fontSize:12,color:C.secondary,marginBottom:8}}>Fundamentals: <span style={{color:C.primary,fontWeight:500}}>{DATA_QUARTER}</span></div>
              <div style={{fontSize:12,color:C.secondary}}>Beta: <span style={{color:betaStatus==="ok"?C.green:C.amber,fontWeight:500}}>{betaStatus==="ok"?"Live":"Loading"}</span></div>
            </div>
          </div>
        </div>
      )}
      
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative"}}>
        {!isMobile && isPerformancePage && <Sidebar collapsed={!sidebarOpen} onToggle={()=>setSidebarOpen(o=>!o)} perf={perf}/>}
        <div style={{flex:1,overflowY:"auto",padding:isMobile?"16px":"28px 32px",background:C.bg}}>
          <Outlet context={outletContext}/>
        </div>
      </div>
    </div>
  );
}
