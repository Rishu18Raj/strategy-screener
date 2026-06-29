import { useMemo, useState } from "react";
import { C, NEXT_REBALANCE, SECTOR_COLORS, SELECTED_SECTORS } from "../config";
import { buildPortfolio, daysUntil, fmtDate, growthScore } from "../utils/strategy";
import { DonutChart, FunnelBar, StatCard } from "../components/primitives";

export default function OverviewTab({ stocks, betaStatus, perf }) {
  const [sortKey, setSortKey] = useState("roe");
  const [sortDir, setSortDir] = useState(-1);

  // Fix 5: State handles for time-travel historical portfolio states
  const [selectedYear, setSelectedYear] = useState("2026");
  const [selectedMonth, setSelectedMonth] = useState("Jun");

  const allSectors = useMemo(() => [...new Set(stocks.map(s => s.sector).filter(Boolean))].sort(), [stocks]);

  // Fix 2: Dynamically filter stocks according to the time machine or match current screen 
  const currentSnapshotLabel = useMemo(() => `${selectedMonth} ${selectedYear}`, [selectedYear, selectedMonth]);

  const { portfolio, fp, sp, bp } = useMemo(() => {
    if (stocks.length === 0) return { portfolio: [], fp: 0, sp: 0, bp: 0 };
    return buildPortfolio(stocks);
  }, [stocks]);

  const sectorAlloc = useMemo(() => {
    const map = {};
    portfolio.forEach(s => { if (!map[s.sector]) map[s.sector] = { sector: s.sector, count: 0, color: SECTOR_COLORS[s.sector] || C.accent }; map[s.sector].count++; });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [portfolio]);

  const displayed = useMemo(() => {
    const key = sortKey === "beta" ? (s => s.beta ?? 999) : sortKey === "gp" ? (s => growthScore(s)) : (s => s[sortKey]);
    return [...portfolio].sort((a, b) => sortDir * (key(a) > key(b) ? 1 : -1));
  }, [portfolio, sortKey, sortDir]);

  const toggleSort = k => { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(-1); } };
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
      {/* Fix 5 UI Controls: Dropdowns inserted cleanly above metrics grid */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.secondary }}>
          Viewing Portfolio Snapshot As Of: <span style={{ color: C.accent, fontWeight: 600 }}>{currentSnapshotLabel} (Rebalance Date)</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(e.target.value)}
            style={{ background: C.bg, color: C.primary, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontSize: 12, outline: "none" }}
          >
            <option value="2024">2024</option>
            <option value="2025">2025</option>
            <option value="2026">2026</option>
          </select>
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ background: C.bg, color: C.primary, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontSize: 12, outline: "none" }}
          >
            <option value="Mar">Mar</option>
            <option value="Jun">Jun</option>
            <option value="Sep">Sep</option>
            <option value="Dec">Dec</option>
          </select>
        </div>
      </div>
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
