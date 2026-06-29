import { C, LAST_REBALANCE, NEXT_REBALANCE } from "../config";
import { daysUntil, fmtDate } from "../utils/strategy";

export default function Sidebar({collapsed,onToggle,perf}){
  const d=daysUntil(NEXT_REBALANCE);
  return(
    <div style={{position:"relative",flexShrink:0,width:collapsed?0:210,transition:"width 0.25s ease"}}>
      <div style={{position:"absolute",top:0,left:0,bottom:0,width:210,borderRight:`0.5px solid ${C.border}`,background:C.bg,overflowY:"auto",overflowX:"hidden",transform:collapsed?"translateX(-100%)":"translateX(0)",transition:"transform 0.25s ease",display:"flex",flexDirection:"column",gap:24,padding:"24px 18px"}}>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Rebalance</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Last</div>
              <div style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(LAST_REBALANCE)}</div>
            </div>
            <div style={{background:d<=14?C.amberDim:C.card,border:`0.5px solid ${d<=14?C.amber:C.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:C.secondary,marginBottom:2}}>Next</div>
              <div style={{fontSize:12,fontWeight:600,color:d<=14?C.amber:C.primary,fontFamily:"var(--font-mono)"}}>{fmtDate(NEXT_REBALANCE)}</div>
              <div style={{fontSize:11,color:C.secondary,marginTop:2}}>{d>0?`${d}d away`:"Due now"}</div>
            </div>
          </div>
        </div>
        <div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10,fontWeight:500}}>Live track record</div>
          {[
            {label:"Total return",  value:perf?`${perf.returns.total_pct>0?"+":""}${perf.returns.total_pct}%`:"—"},
            {label:"Ann. return",   value:perf?`${perf.returns.annualised_pct>0?"+":""}${perf.returns.annualised_pct}%`:"—"},
            {label:"Alpha (ann)",   value:perf?`${perf.returns.alpha_ann>0?"+":""}${perf.returns.alpha_ann}%`:"—"},
            {label:"Sharpe",        value:perf?perf.risk.sharpe:"—"},
            {label:"Sortino",       value:perf?perf.risk.sortino:"—"},
            {label:"Info Ratio",    value:perf?perf.risk.info_ratio:"—"},
            {label:"Win rate",      value:perf?`${perf.trades.win_rate_pct}%`:"—"},
            {label:"Benchmark",     value:"SENSEX"},
          ].map(({label,value})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`0.5px solid ${C.subtle}`}}>
              <span style={{fontSize:11,color:C.secondary}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.primary,fontFamily:"var(--font-mono)"}}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{marginTop:"auto"}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,fontWeight:500}}>About</div>
          <div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>IIMB MBA · Deutsche Bank IB alumni · Built for hobby investors who want institutional-grade equity screening.</div>
        </div>
      </div>
      <button onClick={onToggle} style={{position:"absolute",top:"50%",right:-14,transform:"translateY(-50%)",width:14,height:40,border:`0.5px solid ${C.border}`,borderLeft:"none",background:C.bg,color:C.secondary,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"0 6px 6px 0",fontSize:10,zIndex:10,padding:0}} onMouseEnter={e=>e.currentTarget.style.background=C.hover} onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
        {collapsed?"›":"‹"}
      </button>
    </div>
  );
}
