import { C } from "../config";

export const pill=(bg,color,label)=>(
  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:bg,color,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{label}</span>
);

export function StatCard({label,value,sub,color,warn,small}){
  return(
    <div style={{background:C.card,borderRadius:8,padding:small?"12px 14px":"16px 18px",border:`0.5px solid ${warn?C.amber:C.border}`}}>
      <div style={{fontSize:10,color:C.secondary,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>{label}</div>
      <div style={{fontSize:small?18:24,fontWeight:700,color:color||C.primary,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:C.secondary,marginTop:5,lineHeight:1.4}}>{sub}</div>}
    </div>
  );
}

export function DonutChart({data,size=120}){
  const total=data.reduce((s,d)=>s+d.count,0);
  if(!total)return null;
  let a=-Math.PI/2;
  const cx=size/2,cy=size/2,r=size*.38,ri=size*.23;
  return(
    <svg width={size} height={size} style={{flexShrink:0}}>
      {data.map((d,i)=>{
        const sw=(d.count/total)*2*Math.PI;
        const x1=cx+r*Math.cos(a),y1=cy+r*Math.sin(a);a+=sw;
        const x2=cx+r*Math.cos(a),y2=cy+r*Math.sin(a);
        const xi1=cx+ri*Math.cos(a-sw),yi1=cy+ri*Math.sin(a-sw);
        const xi2=cx+ri*Math.cos(a),yi2=cy+ri*Math.sin(a);
        const lg=sw>Math.PI?1:0;
        return <path key={i} d={`M${x1},${y1} A${r},${r} 0 ${lg},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${lg},0 ${xi1},${yi1} Z`} fill={d.color} opacity={0.85}/>;
      })}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight="700" fill={C.primary}>{total}</text>
      <text x={cx} y={cy+15} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={C.secondary} letterSpacing="0.05em">STOCKS</text>
    </svg>
  );
}

export function FunnelBar({label,count,total,color}){
  const pct=total>0?(count/total)*100:0;
  return(
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

export function ComingSoon({title,description,items}){
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"55vh",gap:20,textAlign:"center",padding:"60px 24px"}}>
      <div style={{width:48,height:48,borderRadius:12,background:C.card,border:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.secondary}}>◈</div>
      <div>
        <div style={{fontSize:19,fontWeight:600,marginBottom:8,letterSpacing:"-0.01em"}}>{title}</div>
        <div style={{fontSize:14,color:C.secondary,maxWidth:460,lineHeight:1.7}}>{description}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,width:"100%",maxWidth:380}}>
        {items.map((item,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",background:C.card,borderRadius:6,border:`0.5px solid ${C.border}`,textAlign:"left"}}>
            <div style={{width:4,height:4,borderRadius:"50%",background:C.muted,flexShrink:0}}/>
            <div style={{fontSize:13,color:C.secondary}}>{item}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:C.muted,letterSpacing:"0.04em",textTransform:"uppercase"}}>In development</div>
    </div>
  );
}
