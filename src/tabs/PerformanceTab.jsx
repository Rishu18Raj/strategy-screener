import { useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { C, REBALANCE_DATES, SECTOR_COLORS } from "../config";
import { StatCard, pill } from "../components/primitives";

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
export default function PerformanceTab({perf,nav,trades}){
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
        // Fix 1: Keep the full date string so Recharts has a unique ID for the axis
        date:      d.date, 
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
      {/* Fix 1: Explicit Track Record Window Header */}
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "12px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: "0.05em" }}>Live Performance Track Record</div>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: C.secondary }}>
          Period: <span style={{ color: C.primary, fontWeight: 600 }}>25-Jun-2024</span> to <span style={{ color: C.primary, fontWeight: 600 }}>25-Jun-2026</span> (2Y Active Strategy)
        </div>
      </div>

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
            <XAxis 
		dataKey="date" 
  		tick={{fontSize:10,fill:C.secondary}} 
  		tickLine={false} 
	  	axisLine={false} 
  		interval={Math.floor(navChart.length/8)}
  		connectNulls={true}
	    />
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
            <Tooltip 
              // Fix: Use 'name' directly (which is 'Portfolio' or 'SENSEX') 
              // instead of checking the dataKey ('portfolio_ret')
              formatter={(value, name) => [
                `${value > 0 ? "+" : ""}${value}%`, 
                name.toUpperCase() // Uppercased to match your request
              ]} 
              contentStyle={{ background: "#0d1117", borderColor: "#1e2535", borderRadius: 6, fontSize: 12 }}
              itemStyle={{ color: "#e8eaf0" }}
              labelStyle={{ color: "#5a6480", fontFamily: "var(--font-mono)", marginBottom: 4 }}
            />
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
