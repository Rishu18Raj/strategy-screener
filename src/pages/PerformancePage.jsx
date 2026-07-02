import { useOutletContext } from "react-router-dom";
import PerformanceTab from "../tabs/PerformanceTab";

export default function PerformancePage(){
  const { perf, nav, trades } = useOutletContext();
  return <PerformanceTab perf={perf} nav={nav} trades={trades}/>;
}
