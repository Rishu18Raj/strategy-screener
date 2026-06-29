import { useState } from "react";
import { C } from "../config";

const METRICS=[
  {name:"Return on Equity",threshold:"RoE ≥ 13%",tagline:"What is the business actually earning for its equity investors?",why:"RoE is the most honest measure of business quality. A company's share price is ultimately a derived outcome of what the underlying business earns on the capital entrusted to it by equity investors. High RoE signals that management is deploying capital effectively and generating real value — not just growing revenue on paper.",detail:"The 13% threshold approximates the cost of equity in India — the minimum return an investor should expect for the risk of holding a stock. A company earning below this hurdle rate is destroying shareholder value even if it appears profitable. We only want companies genuinely earning above this bar."},
  {name:"Revenue CAGR",threshold:"Rev CAGR ≥ 7%",tagline:"Is the core business actually growing?",why:"Revenue growth is the foundation of everything else. A company can temporarily improve margins, but sustainable earnings growth must be supported by a growing top line. We want businesses expanding their operations, not just optimising an existing one.",detail:"The 7% threshold corresponds to India's nominal GDP growth rate. Any company growing slower than the economy is losing market share in real terms. This floor ensures every stock in the portfolio is, at minimum, keeping pace with the expanding economy."},
  {name:"EPS CAGR",threshold:"EPS CAGR ≥ 10%",tagline:"Are profits growing — not just revenues?",why:"Revenue growth alone is insufficient. A business can grow its top line while profits erode if costs rise faster. EPS growth ensures the growth is profitable and that shareholders are actually better off. This separates genuine compounders from revenue-chasing businesses.",detail:"The 10% EPS growth can be achieved two ways — both valid. First: high revenue growth at stable margins. Second: moderate revenue growth with improving net profit margins. We don't distinguish between paths — what matters is that EPS compounds at ≥10%."},
  {name:"Price-to-Earnings",threshold:"P/E ≤ 20x",tagline:"Are we paying a fair price for these earnings?",why:"This is where the mispricing thesis lives. A company can have exceptional fundamentals and still be a poor investment if you overpay. A low P/E on a fundamentally strong company signals the market has undervalued it.",detail:"Markets frequently misprice strong companies in out-of-favour sectors: PSU banks dismissed as structurally weak, energy companies written off as value traps. These mispricings correct over time. Combining P/E ≤ 20x with strong RoE and growth filters systematically hunts for quality at a discount."},
  {name:"Beta",threshold:"Beta ≤ 1.2",tagline:"How volatile is this stock relative to the market?",why:"Beta measures how much a stock moves relative to the broader market. A beta of 1.0 means it tracks the index. A beta of 1.5 amplifies market moves by 50% in both directions. We want a portfolio that broadly tracks the market's risk level.",detail:"The 1.2 cap allows for slightly above-market volatility while filtering out speculative names. Combined with equal-weight construction, this keeps the overall portfolio beta near 1.0, delivering market-like risk with historically significantly above-market returns."},
];
const SECTOR_CARDS=[
  {name:"Banks",tagline:"Credit growth + balance sheet recovery",color:"#06b6d4",thesis:"India's credit growth runs at 12–14% annually, driven by retail lending and MSME formalisation. PSU banks have completed a decade-long balance sheet cleanup and now offer structural earnings growth at valuations that reflect none of this recovery.",initiatives:["Jan Dhan Yojana","PM Mudra Yojana","Credit Guarantee Schemes","Financial Inclusion Index"]},
  {name:"Financial Services",tagline:"Underpenetrated markets + digital delivery",color:"#3b82f6",thesis:"Housing finance, gold lending, SME credit, and wealth management are structurally underpenetrated relative to India's income levels. UPI and digital infrastructure have dramatically reduced delivery costs, expanding addressable markets further.",initiatives:["UPI & Digital Payments Stack","GIFT City","SEBI Market Deepening","Account Aggregator Framework"]},
  {name:"Information Technology",tagline:"AI pivot + durable cost arbitrage",color:"#e11d48",thesis:"India's IT sector benefits from a structural cost arbitrage that remains durable, and is now pivoting toward AI-led services. Mid-tier IT names — filtered naturally by P/E ≤ 20x — often offer better growth-to-valuation ratios than largecap peers.",initiatives:["India AI Mission","Semiconductor Mission","Digital India","IT/ITeS PLI Scheme"]},
  {name:"Capital Goods",tagline:"₹11L Cr annual capex + multi-year orderbooks",color:"#8b5cf6",thesis:"The Government's capex push is the defining fiscal theme since 2021. Infrastructure spending on roads, railways, defence, and power transmission creates multi-year order book visibility for domestic capital goods manufacturers.",initiatives:["National Infrastructure Pipeline","PM Gati Shakti","Defence Indigenisation","PLI for Advanced Manufacturing"]},
  {name:"Construction",tagline:"Infrastructure spending cycle in full force",color:"#d946ef",thesis:"Directly linked to the infrastructure capex theme. Roads, metro rail, affordable housing, and urban infrastructure are all active areas of Government spending, creating sustained demand for quality construction companies.",initiatives:["PM Awas Yojana","Smart Cities Mission","NHAI Projects","Jal Jeevan Mission"]},
  {name:"Oil Gas & Consumable Fuels",tagline:"Stable volumes + deep value mispricing",color:"#f97316",thesis:"India is the world's third-largest energy consumer. Downstream refiners trade at very low P/E multiples due to perceived commodity risk, but their refining margins and volumes are relatively stable. The mispricing thesis is arguably strongest here.",initiatives:["City Gas Distribution","LPG Universalisation","Strategic Petroleum Reserve","Biofuel Blending Mandates"]},
  {name:"Power",tagline:"Record demand + decade-long capex cycle",color:"#f59e0b",thesis:"India's peak power demand hits record highs annually. The energy transition — renewables buildout, grid expansion, green hydrogen — represents a decade-long capex cycle. Established utilities offer stable regulated returns alongside capacity addition growth.",initiatives:["National Electricity Plan 2032","Green Hydrogen Mission","PM Surya Ghar","RDSS"]},
  {name:"Consumer Services",tagline:"60%+ consumption economy + income upgrades",color:"#ef4444",thesis:"Private consumption accounts for over 60% of India's GDP. As per capita income rises, the marginal rupee shifts from essential goods to discretionary services. Consumer services grows faster than FMCG by capturing this upgrade in spending patterns.",initiatives:["Tourism Infrastructure Push","Swadesh Darshan 2.0","UDAN Scheme","National Logistics Policy"]},
  {name:"Telecommunication",tagline:"AI backbone + BharatNet + rising ARPU",color:"#34d399",thesis:"India's telecom sector has consolidated into an effective duopoly, restoring pricing power. Telecom infrastructure is becoming the backbone of AI and data centre expansion — network utilisation grows with every AI workload. BharatNet extends the addressable market to 6 lakh villages.",initiatives:["BharatNet Phase III","5G Spectrum Rollout","National Broadband Mission","Digital Connectivity Districts"]},
  {name:"Chemicals",tagline:"China+1 shift + specialty value chain",color:"#14b8a6",thesis:"India is positioned as a credible alternative to China in specialty chemicals, driven by global supply chain diversification. Indian specialty chemical companies with established client relationships are well-placed to capture this decade-long structural shift.",initiatives:["PLI for Specialty Chemicals","PCPIR Zones","Bulk Drug Parks","Zero Liquid Discharge mandates"]},
  {name:"Media Entertainment & Publication",tagline:"Content boom + new entrants + ad growth",color:"#f43f5e",thesis:"Content consumption in India is accelerating — driven by affordable data, smartphone penetration, and a young population. The ecosystem is expanding with new OTT entrants, regional content, live sports streaming, and digital advertising.",initiatives:["National Broadcasting Policy","AVGC-XR National Centre of Excellence","India as Global Animation Hub"]},
  {name:"Textiles",tagline:"PM MITRA parks + China+1 in apparel",color:"#a3e635",thesis:"India is a natural beneficiary of China+1 in apparel and technical textiles. Government investment in dedicated textile parks accelerates cluster-based manufacturing competitiveness.",initiatives:["PM MITRA Textile Parks (7 mega parks)","PLI for Textiles","ATUF Scheme","National Technical Textiles Mission"]},
];
const EXCLUDED=[
  {name:"Healthcare & Pharma",reason:"Quality names trade well above P/E 20x. Requires a dedicated screen with higher valuation tolerance."},
  {name:"FMCG",reason:"Mature, low-growth, structurally high P/E. As income rises, the marginal rupee shifts to services — Consumer Services captures this better."},
  {name:"Automobiles & Auto Components",reason:"Cyclical, exposed to EV disruption risk and commodity input cost volatility."},
  {name:"Metals & Mining",reason:"Commodity-price driven earnings make fundamental screening unreliable."},
  {name:"Realty",reason:"Lumpy project-based revenue recognition makes trailing metrics misleading."},
  {name:"Consumer Durables",reason:"Mixed sector — most names trade at elevated valuations that fail the P/E screen."},
  {name:"Diversified / Others",reason:"Heterogeneous sectors where a consistent macro thesis is difficult to construct."},
];

function FlipCard({front,back,height=190}){
  const [flipped,setFlipped]=useState(false);
  return(
    <div onClick={()=>setFlipped(f=>!f)} style={{height,cursor:"pointer",perspective:1000,userSelect:"none"}}>
      <div style={{position:"relative",width:"100%",height:"100%",transformStyle:"preserve-3d",transition:"transform 0.45s cubic-bezier(0.4,0.2,0.2,1)",transform:flipped?"rotateY(180deg)":"rotateY(0deg)"}}>
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",background:C.card,border:`0.5px solid ${C.border}`,borderRadius:10,padding:"18px 20px",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          {front}
          <div style={{fontSize:10,color:C.muted,alignSelf:"flex-end",letterSpacing:"0.04em"}}>tap to flip ↻</div>
        </div>
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",transform:"rotateY(180deg)",background:C.hover,border:`0.5px solid ${C.accent}44`,borderRadius:10,padding:"18px 20px",display:"flex",flexDirection:"column",justifyContent:"space-between",overflowY:"auto"}}>
          {back}
          <div style={{fontSize:10,color:C.muted,alignSelf:"flex-end",letterSpacing:"0.04em",marginTop:8}}>tap to flip ↻</div>
        </div>
      </div>
    </div>
  );
}
function FAQItem({q,a}){
  const [open,setOpen]=useState(false);
  return(
    <div style={{borderBottom:`0.5px solid ${C.border}`}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"14px 4px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16}}>
        <div style={{fontSize:13,fontWeight:500,color:C.primary}}>{q}</div>
        <div style={{color:C.muted,fontSize:14,flexShrink:0,transition:"transform 0.2s",transform:open?"rotate(45deg)":"rotate(0deg)"}}>+</div>
      </div>
      {open&&<div style={{padding:"0 4px 14px",fontSize:13,color:C.secondary,lineHeight:1.8}}>{a}</div>}
    </div>
  );
}
function RSection({title,children}){
  return(
    <div style={{marginBottom:48}}>
      <div style={{fontSize:11,fontWeight:600,color:C.secondary,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:20,paddingBottom:10,borderBottom:`0.5px solid ${C.border}`}}>{title}</div>
      {children}
    </div>
  );
}
export default function ResourcesTab(){
  return(
    <div>
      <RSection title="How this works">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
          {[{label:"The problem",text:"Most retail investors are caught between two extremes — chasing momentum stocks that carry high risk, or parking money in fixed deposits that barely beat inflation. There is a disciplined middle path."},{label:"The approach",text:"Apply five quantitative filters to the entire Nifty 500 universe to find companies that are genuinely profitable, growing faster than the economy, and available at a reasonable price. No gut feel. No tips."},{label:"The result",text:"A compact, equal-weight portfolio concentrated in sectors with structural tailwinds. Backtested over 5 years: 393% total return vs 93% for the SENSEX, Sharpe Ratio of 1.53. Not multibaggers — steady, disciplined compounding."}].map(({label,text})=>(
            <div key={label} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
              <div style={{fontSize:11,fontWeight:600,color:C.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>{label}</div>
              <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{text}</div>
            </div>
          ))}
        </div>
      </RSection>
      <RSection title="The 5 metrics — tap a card to explore">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
          {METRICS.map(m=>(
            <FlipCard key={m.name} height={200}
              front={<div><div style={{display:"inline-block",background:C.accentDim,borderRadius:5,padding:"3px 10px",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,color:C.accent,marginBottom:12}}>{m.threshold}</div><div style={{fontSize:15,fontWeight:600,color:C.primary,marginBottom:6}}>{m.name}</div><div style={{fontSize:13,color:C.secondary,lineHeight:1.7}}>{m.tagline}</div></div>}
              back={<div><div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:8}}>{m.name}</div><div style={{fontSize:12,color:C.primary,lineHeight:1.7,marginBottom:8}}>{m.why}</div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>{m.detail}</div></div>}
            />
          ))}
        </div>
      </RSection>
      <RSection title="Portfolio construction">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
          {[{q:"Why equal weight?",a:"Equal weighting removes the temptation to overweight high-conviction picks. Every stock gets the same allocation, automatically forcing you to buy more of fallen stocks and trim those that have run up. Disciplined, emotion-free rebalancing built in."},{q:"Why quarterly rebalancing?",a:"Fundamentals change at the speed of business, not markets. Quarterly aligns with India's earnings calendar, ensuring the screen always runs on fresh data. More frequent rebalancing adds noise and costs."},{q:"Why a sector cap?",a:"Without a cap, value screens naturally overweight cheap sectors like Banks and Financial Services. The cap — min(3, max(1, floor(20% of sector size in universe))) — ensures genuine diversification across conviction sectors."},{q:"How are stocks ranked within a sector?",a:"By the Growth/P/E Score: EPS CAGR divided by P/E. This directly captures the mispricing thesis — the most earnings growth per rupee of valuation paid."}].map(({q,a})=>(
            <div key={q} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
              <div style={{fontSize:13,fontWeight:600,color:C.primary,marginBottom:8}}>{q}</div>
              <div style={{fontSize:13,color:C.secondary,lineHeight:1.8}}>{a}</div>
            </div>
          ))}
        </div>
      </RSection>
      <RSection title="Sector selection — India macro thesis — tap a card to explore">
        <div style={{fontSize:13,color:C.secondary,lineHeight:1.8,marginBottom:20}}>The 12 included sectors are chosen based on structural macroeconomic tailwinds, Government policy direction, and valuation discipline. Reviewed at each quarterly rebalance.</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14,marginBottom:28}}>
          {SECTOR_CARDS.map(s=>(
            <FlipCard key={s.name} height={180}
              front={<div><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/><div style={{fontSize:14,fontWeight:600,color:C.primary}}>{s.name}</div></div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7}}>{s.tagline}</div></div>}
              back={<div><div style={{fontSize:12,fontWeight:600,color:s.color,marginBottom:8}}>{s.name}</div><div style={{fontSize:12,color:C.secondary,lineHeight:1.7,marginBottom:10}}>{s.thesis}</div><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{s.initiatives.map((init,i)=>(<span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:C.bg,color:C.secondary,border:`0.5px solid ${C.border}`}}>{init}</span>))}</div></div>}
            />
          ))}
        </div>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Excluded sectors</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {EXCLUDED.map(e=>(<div key={e.name} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,padding:"10px 14px",opacity:0.6}}><div style={{fontSize:12,fontWeight:600,color:C.secondary,marginBottom:4}}>{e.name}</div><div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>{e.reason}</div></div>))}
        </div>
      </RSection>
      <RSection title="FAQ">
        <div>
          {[{q:"Is this a guaranteed return?",a:"No. Past performance, including the 5-year backtest and 2-year live track record, does not guarantee future results. This is a rules-based strategy that has historically outperformed — not a promise of future outperformance."},{q:"How do I actually invest in this portfolio?",a:"Divide your investment amount equally across all stocks in the current portfolio table. At the next quarterly rebalance, review the updated portfolio — sell stocks that have been removed, buy new additions, and rebalance to equal weight."},{q:"What if a stock I hold gets dropped at rebalance?",a:"Sell it and redeploy the proceeds into new additions, bringing all positions back to equal weight. Discipline is the edge."},{q:"Why not just buy an index fund?",a:"You absolutely can. This strategy is for investors who want to attempt to outperform the index with a disciplined, fundamentals-based approach — accepting the complexity of quarterly rebalancing in exchange for potentially higher risk-adjusted returns."},{q:"What are the risks?",a:"Sector concentration, single-stock risk, liquidity risk for smaller names, model risk, and execution risk — the strategy requires consistent quarterly discipline."},{q:"Who built this and why?",a:"Originally developed as a group assignment at IIM Bangalore for the Financial Markets course, backtested and validated against the SENSEX. Productised as a publicly accessible tool for hobby investors who want institutional-grade equity screening."}].map(({q,a})=><FAQItem key={q} q={q} a={a}/>)}
        </div>
      </RSection>
    </div>
  );
}
