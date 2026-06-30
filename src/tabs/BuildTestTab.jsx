import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { C, FILTERS, SELECTED_SECTORS, SECTOR_COLORS } from "../config";
import { StatCard, FunnelBar } from "../components/primitives";
import {
  loadBacktestData, runCustomBacktest, computeCustomMetrics,
  CUSTOM_BACKTEST_REBALANCE_DATES,
} from "../utils/backtest";

// ── small local primitives ──────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange, suffix = "" }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.secondary }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: C.accent }}>
          {value}{suffix}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 10, color: C.muted }}>{min}{suffix}</span>
        <span style={{ fontSize: 10, color: C.muted }}>{max}{suffix}</span>
      </div>
    </div>
  );
}

function SectorToggle({ sector, active, onToggle }) {
  const color = SECTOR_COLORS[sector] || C.accent;
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        borderRadius: 6, cursor: "pointer", userSelect: "none",
        background: active ? color + "18" : "transparent",
        border: `0.5px solid ${active ? color + "55" : C.border}`,
      }}
    >
      <div style={{
        width: 13, height: 13, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${active ? color : C.muted}`,
        background: active ? color : "transparent",
      }} />
      <span style={{ fontSize: 12, color: active ? C.primary : C.muted }}>{sector}</span>
    </div>
  );
}

function MetricCompareRow({ label, customVal, baseVal, suffix = "", higherIsBetter = true }) {
  const cNum = Number(customVal), bNum = Number(baseVal);
  const hasComparison = Number.isFinite(cNum) && Number.isFinite(bNum);
  const better = hasComparison ? (higherIsBetter ? cNum >= bNum : cNum <= bNum) : null;
  return (
    <tr style={{ borderTop: `0.5px solid ${C.subtle}` }}>
      <td style={{ padding: "9px 12px", fontSize: 12, color: C.accent }}>{label}</td>
      <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", color: C.secondary }}>
        {baseVal != null ? `${baseVal}${suffix}` : "—"}
      </td>
      <td style={{
        padding: "9px 12px", fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, textAlign: "right",
        color: hasComparison ? (better ? C.green : C.red) : C.primary,
      }}>
        {customVal != null ? `${customVal}${suffix}` : "—"}
      </td>
    </tr>
  );
}

// ── main tab ──────────────────────────────────────────────────────────

export default function BuildTestTab() {
  const [loadState, setLoadState] = useState("loading"); // loading | ok | error
  const [errorMsg, setErrorMsg] = useState("");
  const [backtestData, setBacktestData] = useState(null);

  const [filters, setFilters] = useState({ ...FILTERS });
  const [sectors, setSectors] = useState(new Set(SELECTED_SECTORS));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadBacktestData()
      .then(data => { if (!cancelled) { setBacktestData(data); setLoadState("ok"); } })
      .catch(err => { if (!cancelled) { setErrorMsg(err.message || "Could not load backtest data."); setLoadState("error"); } });
    return () => { cancelled = true; };
  }, []);

  // current-quarter (most recent) universe — used for the live funnel preview,
  // same data OverviewTab uses for the production filters
  const latestUniverse = useMemo(() => {
    if (!backtestData) return [];
    const dates = CUSTOM_BACKTEST_REBALANCE_DATES;
    return backtestData.universeByDate[dates[dates.length - 1]] || [];
  }, [backtestData]);

  const allSectors = useMemo(
    () => [...new Set(latestUniverse.map(s => s.sector).filter(Boolean))].sort(),
    [latestUniverse]
  );

  const liveFunnel = useMemo(() => {
    if (!latestUniverse.length) return { fp: 0, sp: 0, bp: 0, total: 0 };
    const fund = latestUniverse.filter(s =>
      !isNaN(s.roe) && s.roe >= filters.roe &&
      !isNaN(s.revCAGR) && s.revCAGR >= filters.revCAGR &&
      !isNaN(s.epsCAGR) && s.epsCAGR >= filters.epsCAGR &&
      !isNaN(s.pe) && s.pe <= filters.pe
    );
    const sec = fund.filter(s => sectors.has(s.sector));
    const bet = sec.filter(s => s.beta != null && s.beta <= filters.beta);
    return { fp: fund.length, sp: sec.length, bp: bet.length, total: latestUniverse.length };
  }, [latestUniverse, filters, sectors]);

  const toggleSector = sec => {
    setSectors(prev => {
      const next = new Set(prev);
      next.has(sec) ? next.delete(sec) : next.add(sec);
      return next;
    });
  };

  const resetToBase = () => {
    setFilters({ ...FILTERS });
    setSectors(new Set(SELECTED_SECTORS));
    setResult(null);
  };

  const runBacktest = () => {
    if (!backtestData) return;
    setRunning(true);
    // yield to the browser so the button's pressed state paints before the
    // (synchronous, fairly heavy) 9-quarter simulation runs
    setTimeout(() => {
      const sim = runCustomBacktest(backtestData, filters, sectors);
      const metrics = computeCustomMetrics(sim.navSeries);
      const baseSim = runCustomBacktest(backtestData, { ...FILTERS }, new Set(SELECTED_SECTORS));
      const baseMetrics = computeCustomMetrics(baseSim.navSeries);
      setResult({ sim, metrics, baseSim, baseMetrics });
      setRunning(false);
    }, 30);
  };

  const navChart = useMemo(() => {
    if (!result) return [];
    const { sim, baseSim } = result;
    return sim.navSeries.map((d, i) => ({
      date: d.date,
      custom_nav: d.portfolio_nav,
      base_nav: baseSim.navSeries[i]?.portfolio_nav ?? null,
      sensex_nav: d.sensex_nav,
    }));
  }, [result]);

  const filtersChanged =
    filters.roe !== FILTERS.roe || filters.revCAGR !== FILTERS.revCAGR ||
    filters.epsCAGR !== FILTERS.epsCAGR || filters.beta !== FILTERS.beta ||
    filters.pe !== FILTERS.pe ||
    sectors.size !== SELECTED_SECTORS.size ||
    [...sectors].some(s => !SELECTED_SECTORS.has(s));

  const sectionLabel = { fontSize: 11, fontWeight: 600, marginBottom: 14, color: C.secondary, textTransform: "uppercase", letterSpacing: "0.07em" };
  const card = { background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "18px 20px" };

  if (loadState === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: C.secondary, fontSize: 14 }}>
        Loading 9 quarters of historical fundamentals, betas, and prices...
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 10 }}>
        <div style={{ fontSize: 14, color: C.red }}>Could not load backtest data.</div>
        <div style={{ fontSize: 12, color: C.muted }}>{errorMsg}</div>
      </div>
    );
  }

  return (
    <div>
      {/* header / methodology disclosure */}
      <div style={{ ...card, marginBottom: 16, borderColor: C.accent + "55" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 8 }}>How this backtest works</div>
        <div style={{ fontSize: 12.5, color: C.secondary, lineHeight: 1.7 }}>
          Adjusting a filter below doesn't just refilter today's stock list — it rebuilds the portfolio at <b style={{ color: C.primary }}>each of the 9 historical rebalance dates</b> using <b style={{ color: C.primary }}>that quarter's actual fundamentals and beta data</b>, then holds equal-weight to the next rebalance. This answers "if this strategy had been running for the last 2 years with these thresholds," not "what would today's filtered list have returned if bought 2 years ago."
        </div>
        <div style={{ fontSize: 12.5, color: C.amber, lineHeight: 1.7, marginTop: 8 }}>
          Limitation: this simulation assumes <b>hold-to-next-rebalance</b> for every position. It does not model the live strategy's intra-quarter early-exit rule (20% return + P/E &gt; 20x), which requires daily price data only available for stocks that have actually been in the real portfolio. Expect these numbers to run lower than the live track record — that gap is expected, not an error.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        {/* ── left: controls ── */}
        <div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={sectionLabel}>Screening filters</div>
            <Slider label="Return on Equity ≥" value={filters.roe} min={0} max={35} step={1} suffix="%" onChange={v => setFilters(f => ({ ...f, roe: v }))} />
            <Slider label="Revenue CAGR ≥" value={filters.revCAGR} min={0} max={25} step={1} suffix="%" onChange={v => setFilters(f => ({ ...f, revCAGR: v }))} />
            <Slider label="EPS CAGR ≥" value={filters.epsCAGR} min={0} max={30} step={1} suffix="%" onChange={v => setFilters(f => ({ ...f, epsCAGR: v }))} />
            <Slider label="P/E ≤" value={filters.pe} min={5} max={50} step={1} suffix="x" onChange={v => setFilters(f => ({ ...f, pe: v }))} />
            <Slider label="Beta ≤" value={filters.beta} min={0.3} max={2} step={0.05} onChange={v => setFilters(f => ({ ...f, beta: v }))} />
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            <div style={sectionLabel}>Sectors ({sectors.size} of {allSectors.length} selected)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
              {allSectors.map(sec => (
                <SectorToggle key={sec} sector={sec} active={sectors.has(sec)} onToggle={() => toggleSector(sec)} />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={runBacktest}
              disabled={running}
              style={{
                flex: 1, border: "none", borderRadius: 6, padding: "11px 0", fontSize: 13, fontWeight: 600,
                cursor: running ? "default" : "pointer", background: C.accent, color: "#fff",
                fontFamily: "Inter,sans-serif", opacity: running ? 0.7 : 1,
              }}
            >
              {running ? "Running 9-quarter backtest..." : "Run historical backtest"}
            </button>
            <button
              onClick={resetToBase}
              disabled={!filtersChanged && !result}
              style={{
                border: `0.5px solid ${C.border}`, borderRadius: 6, padding: "11px 16px", fontSize: 13, fontWeight: 500,
                cursor: "pointer", background: "transparent", color: C.secondary, fontFamily: "Inter,sans-serif",
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── right: live funnel + results ── */}
        <div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={sectionLabel}>Selection funnel — current quarter, live preview</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <FunnelBar label="Nifty 500 universe" count={liveFunnel.total} total={liveFunnel.total} color={C.accent} />
                <FunnelBar label="Pass fundamental criteria" count={liveFunnel.fp} total={liveFunnel.total} color="#8b5cf6" />
                <FunnelBar label="In selected sectors" count={liveFunnel.sp} total={liveFunnel.total} color={C.amber} />
                <FunnelBar label="Pass beta filter" count={liveFunnel.bp} total={liveFunnel.total} color="#f97316" />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <StatCard label="Candidates this quarter" value={liveFunnel.bp} sub="Before sector cap — run backtest for full portfolio" color={C.green} />
              </div>
            </div>
          </div>

          {!result && (
            <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, gap: 10, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.secondary }}>Adjust filters and sectors, then run the backtest to see how this strategy would have performed over the last 2 years.</div>
              <div style={{ fontSize: 11, color: C.muted }}>Reconstructs all 9 quarterly portfolios from point-in-time data — takes a few seconds.</div>
            </div>
          )}

          {result && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                <StatCard label="Custom total return" value={`${result.metrics.totalPct > 0 ? "+" : ""}${result.metrics.totalPct}%`} sub={`Base strategy: ${result.baseMetrics.totalPct > 0 ? "+" : ""}${result.baseMetrics.totalPct}%`} color={result.metrics.totalPct >= result.baseMetrics.totalPct ? C.green : C.red} small />
                <StatCard label="Custom Sharpe (quarterly)" value={result.metrics.sharpe} sub={`Base: ${result.baseMetrics.sharpe}`} color={C.accent} small />
                <StatCard label="Data gaps" value={result.sim.dataGaps.length} sub="Position-quarters skipped, no price" color={result.sim.dataGaps.length > 0 ? C.amber : C.green} small />
              </div>

              <div style={{ ...card, marginBottom: 16 }}>
                <div style={sectionLabel}>NAV — custom screen vs. base strategy vs. SENSEX</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={navChart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.subtle} vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                    <YAxis tick={{ fontSize: 10, fill: C.muted }} />
                    <Tooltip contentStyle={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
                    <Line type="monotone" dataKey="custom_nav" stroke={C.accent} strokeWidth={2} dot={{ r: 3 }} name="Your custom screen" />
                    <Line type="monotone" dataKey="base_nav" stroke={C.green} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Base strategy" />
                    <Line type="monotone" dataKey="sensex_nav" stroke={C.muted} strokeWidth={1.5} dot={false} name="SENSEX" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{ ...card, marginBottom: 16 }}>
                <div style={sectionLabel}>Custom screen vs. base strategy — full comparison</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Metric</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Base</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Your screen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricCompareRow label="Total return" customVal={result.metrics.totalPct} baseVal={result.baseMetrics.totalPct} suffix="%" />
                    <MetricCompareRow label="Annualised return" customVal={result.metrics.annPct} baseVal={result.baseMetrics.annPct} suffix="%" />
                    <MetricCompareRow label="Alpha (ann, vs SENSEX)" customVal={result.metrics.alphaAnnPct} baseVal={result.baseMetrics.alphaAnnPct} suffix="%" />
                    <MetricCompareRow label="Sharpe (quarterly basis)" customVal={result.metrics.sharpe} baseVal={result.baseMetrics.sharpe} />
                    <MetricCompareRow label="Sortino (quarterly basis)" customVal={result.metrics.sortino} baseVal={result.baseMetrics.sortino} />
                    <MetricCompareRow label="Beta vs SENSEX" customVal={result.metrics.beta} baseVal={result.baseMetrics.beta} higherIsBetter={false} />
                    <MetricCompareRow label="Treynor" customVal={result.metrics.treynor} baseVal={result.baseMetrics.treynor} />
                    <MetricCompareRow label="Jensen Alpha" customVal={result.metrics.jensenAlpha} baseVal={result.baseMetrics.jensenAlpha} suffix="%" />
                    <MetricCompareRow label="Information Ratio" customVal={result.metrics.infoRatio} baseVal={result.baseMetrics.infoRatio} />
                    <MetricCompareRow label="Tracking error" customVal={result.metrics.trackingError} baseVal={result.baseMetrics.trackingError} suffix="%" higherIsBetter={false} />
                    <MetricCompareRow label="Max drawdown" customVal={result.metrics.maxDrawdownPct} baseVal={result.baseMetrics.maxDrawdownPct} suffix="%" higherIsBetter={false} />
                  </tbody>
                </table>
                <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                  Sharpe/Sortino/Treynor/Jensen Alpha/Information Ratio here are computed from 8 quarterly observations, not the ~500 daily observations behind the live Performance tab's numbers — treat these as directional, not as precise as the live track record.
                </div>
              </div>

              <div style={card}>
                <div style={sectionLabel}>Quarterly portfolio sizes</div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${result.sim.quarterlyPortfolios.length}, 1fr)`, gap: 8 }}>
                  {result.sim.quarterlyPortfolios.map(q => (
                    <div key={q.date} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: C.primary }}>{q.portfolio.length}</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{q.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
