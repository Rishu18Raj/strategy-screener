import { useOutletContext } from "react-router-dom";
import { C } from "../config";
import OverviewTab from "../tabs/OverviewTab";

export default function OverviewPage(){
  const { stocks, dataStatus, betaStatus, perf } = useOutletContext();

  if (dataStatus === "loading") {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"50vh",color:C.secondary,fontSize:14}}>
        Loading universe...
      </div>
    );
  }

  if (dataStatus === "error") {
    return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"50vh",gap:10}}>
        <div style={{fontSize:14,color:C.red}}>Could not load fundamentals.csv from GitHub.</div>
      </div>
    );
  }

  return <OverviewTab stocks={stocks} betaStatus={betaStatus} perf={perf}/>;
}
