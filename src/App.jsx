import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import OverviewPage from "./pages/OverviewPage";
import PerformancePage from "./pages/PerformancePage";
import BuildTestPage from "./pages/BuildTestPage";
import ResourcesPage from "./pages/ResourcesPage";

function App(){
  return (
    <Routes>
      <Route element={<Layout/>}>
        <Route index element={<OverviewPage/>} />
        <Route path="performance" element={<PerformancePage/>} />
        <Route path="build-test" element={<BuildTestPage/>} />
        <Route path="resources" element={<ResourcesPage/>} />
        {/* Unknown paths fall back to the landing page rather than a blank screen */}
        <Route path="*" element={<OverviewPage/>} />
      </Route>
    </Routes>
  );
}

export default App;
