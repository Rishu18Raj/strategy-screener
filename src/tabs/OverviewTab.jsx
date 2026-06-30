import { useEffect, useMemo, useState } from "react";
import { BASE, C, NEXT_REBALANCE, PORTFOLIO_SNAPSHOTS, SECTOR_COLORS, SELECTED_SECTORS, URLS } from "../config";
import { buildPortfolio, daysUntil, fmtDate, growthScore, parseCSV } from "../utils/strategy";
import { DonutChart, FunnelBar, StatCard } from "../components/primitives";

const MONTH_TO_QUARTER = { Mar: "Q1", Jun: "Q2", Sep: "Q3", Dec: "Q4" };
const RISK_FREE_RATE = 0.06; // 6% p.a. — must match compute_performance_metrics.py
const TRADING_DAYS = 252;

function snapshotFrom(year, month) {
  return PORTFOLIO_SNAPSHOTS.find(s => s.year === year && s.month === month) || null;
}

function parseDate(date) {
  return date ? new Date(`${date}T00:00:00`) : null;
}

function latestPriceFor(ticker, priceData) {
  const series = priceData?.[ticker];
  if (!series) return null;
  const dates = Object.keys(series).sort();
  const lastDate = dates[dates.length - 1];
  return lastDate ? { date: lastDate, price: series[lastDate] } : null;
}

async function fetchRequired(url, type = "json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  return type === "text" ? res.text() : res.json();
}

async function fetchOptional(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// Slice nav.json up to (and including) asOfDate, then compute the same
// metrics compute_performance_metrics.py computes over the full series —
// total return, annualised return, alpha vs SENSEX, Sharpe — but bounded
// to inception -> asOfDate instead of inception -> present.
function computeAsOfMetrics(navSeries, asOfDate) {
  if (!navSeries || navSeries.length < 2 || !asOfDate) return null;

  const cutoff = navSeries.filter(d => d.date <= asOfDate);
  if (cutoff.length < 2) return null;

  const portNavs = cutoff.map(d => d.portfolio_nav);
  const sensexNavs = cutoff.map(d => d.sensex_nav);
  const dates = cutoff.map(d => d.date);

  const portRet = portNavs.slice(1).map((v, i) => (v - portNavs[i]) / portNavs[i]);

  const nDays = (parseDate(dates[dates.length - 1]) - parseDate(dates[0])) / 86400000;
  if (!nDays) return null;

  const totalPct = (portNavs[portNavs.length - 1] / portNavs[0] - 1) * 100;
  const annPct = (Math.pow(portNavs[portNavs.length - 1] / portNavs[0], 365 / nDays) - 1) * 100;

  const sensexTotalPct = (sensexNavs[sensexNavs.length - 1] / sensexNavs[0] - 1) * 100;
  const sensexAnnPct = (Math.pow(sensexNavs[sensexNavs.length - 1] / sensexNavs[0], 365 / nDays) - 1) * 100;

  const alphaAnnPct = annPct - sensexAnnPct;

  const rfDaily = Math.pow(1 + RISK_FREE_RATE, 1 / TRADING_DAYS) - 1;
  const excess = portRet.map(r => r - rfDaily);
  const meanExc = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, x) => a + (x - meanExc) ** 2, 0) / excess.length;
  const std = Math.sqrt(variance);
  const sharpe = std ? (meanExc / std) * Math.sqrt(TRADING_DAYS) : 0;

  return {
    asOfDate: dates[dates.length - 1],
    totalPct: Number(totalPct.toFixed(2)),
    annPct: Number(annPct.toFixed(2)),
    sensexTotalPct: Number(sensexTotalPct.toFixed(2)),
    sensexAnnPct: Number(sensexAnnPct.toFixed(2)),
    alphaAnnPct: Number(alphaAnnPct.toFixed(2)),
    sharpe: Number(sharpe.toFixed(4)),
  };
}

export default function OverviewTab({ stocks, betaStatus, perf }) {
  const latest = PORTFOLIO_SNAPSHOTS[PORTFOLIO_SNAPSHOTS.length - 1];
  const [sortKey, setSortKey] = useState("roe");
  const [sortDir, setSortDir] = useState(-1);
  const [selectedYear, setSelectedYear] = useState(latest.year);
  const [selectedMonth, setSelectedMonth] = useState(latest.month);
  const [applied, setApplied] = useState(latest);
  const [snapshotState, setSnapshotState] = useState({
    status: "loading",
    portfolioData: null,
    universe: [],
    prices: null,
    error: "",
  });
  const [navSeries, setNavSeries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRequired(URLS.nav)
      .then(d => { if (!cancelled) setNavSeries(d); })
      .catch(() => { if (!cancelled) setNavSeries(null); });
    return () => { cancelled = true; };
  }, []);

  const availableYears = useMemo(
    () => [...new Set(PORTFOLIO_SNAPSHOTS.map(s => s.year))],
    []
  );

  const availableMonths = useMemo(
    () => PORTFOLIO_SNAPSHOTS.filter(s => s.year === selectedYear).map(s => s.month),
    [selectedYear]
  );

  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[availableMonths.length - 1] || "Jun");
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotState({
        status: "loading",
        portfolioData: null,
        universe: [],
        prices: null,
        error: "",
      });
      try {
        const label = applied.file.replace("portfolio_", "").replace(".json", "");
        const [portfolioData, fundamentalsText, betas, prices] = await Promise.all([
          fetchRequired(`${BASE}/historical/${applied.file}`),
          fetchRequired(`${BASE}/historical/fundamentals_${label}.csv`, "text"),
          fetchRequired(`${BASE}/historical/betas_${label}.json`),
          fetchOptional(`${BASE}/historical/daily_prices_${label}.json`),
        ]);

        const universe = parseCSV(fundamentalsText).map(s => ({
          ...s,
          beta: betas[s.ticker] ?? null,
          betaStatus: betas[s.ticker] != null ? "done" : "idle",
        }));

        const portfolioStocks = (portfolioData.stocks || []).map(s => {
          const latest = latestPriceFor(s.ticker, prices);
          return latest ? { ...s, latest_price: latest.price, latest_price_date: latest.date } : s;
        });

        if (!cancelled) {
          setSnapshotState({
            status: "ok",
            portfolioData: { ...portfolioData, stocks: portfolioStocks },
            universe,
            prices,
            error: "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSnapshotState({
            status: "error",
            portfolioData: null,
            universe: [],
            prices: null,
            error: err.message || "Could not load this snapshot.",
          });
        }
      }
    }

    loadSnapshot();
    return () => { cancelled = true; };
  }, [applied]);

  const applySnapshot = () => {
    const next = snapshotFrom(selectedYear, selectedMonth);
    if (next) setApplied(next);
    else {
      setSnapshotState({
        status: "error",
        portfolioData: null,
        universe: [],
        prices: null,
        error: `No portfolio_${selectedYear}${MONTH_TO_QUARTER[selectedMonth] || ""}.json file is configured.`,
      });
    }
  };

  const universe = snapshotState.universe.length ? snapshotState.universe : stocks;
  const portfolio = snapshotState.portfolioData?.stocks || [];
  const { fp, sp, bp } = useMemo(() => {
    if (universe.length === 0) return { fp: 0, sp: 0, bp: 0 };
    return buildPortfolio(universe);
  }, [universe]);

  const allSectors = useMemo(
    () => [...new Set(universe.map(s => s.sector).filter(Boolean))].sort(),
    [universe]
  );

  const appliedIndex = PORTFOLIO_SNAPSHOTS.findIndex(s => s.file === applied.file);
  const nextApplied = PORTFOLIO_SNAPSHOTS[appliedIndex + 1];
  const rebalanceDate = parseDate(snapshotState.portfolioData?.rebalance_date);
  const nextRebalanceDate = nextApplied
    ? parseDate(nextApplied.year + "-" + ({ Mar: "03", Jun: "06", Sep: "09", Dec: "12" }[nextApplied.month]) + "-25")
    : NEXT_REBALANCE;
  const nextRebalanceSub = nextApplied
    ? "Next historical quarter"
    : daysUntil(nextRebalanceDate) > 0
      ? `${daysUntil(nextRebalanceDate)} days away`
      : "Due now";

  const currentSnapshotLabel = applied.label;
  const hasPendingSelection = selectedYear !== applied.year || selectedMonth !== applied.month;
  const snapshotIsLoading = snapshotState.status === "loading";
  const snapshotIsError = snapshotState.status === "error";

  const asOfMetrics = useMemo(() => {
    const cutoffDate = snapshotState.portfolioData?.rebalance_date || applied.year + "-" +
      ({ Mar: "03", Jun: "06", Sep: "09", Dec: "12" }[applied.month]) + "-25";
    return computeAsOfMetrics(navSeries, cutoffDate);
  }, [navSeries, snapshotState.portfolioData, applied]);

  const sectorAlloc = useMemo(() => {
    const map = {};
    portfolio.forEach(s => {
      if (!map[s.sector]) {
        map[s.sector] = { sector: s.sector, count: 0, color: SECTOR_COLORS[s.sector] || C.accent };
      }
      map[s.sector].count++;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [portfolio]);

  const displayed = useMemo(() => {
    const key = sortKey === "beta"
      ? (s => s.beta ?? 999)
      : sortKey === "gp"
        ? (s => growthScore(s))
        : sortKey === "rebal_price"
          ? (s => s.rebal_price ?? s.entry_price ?? 0)
          : sortKey === "entry_price"
            ? (s => s.entry_price ?? 0)
            : sortKey === "live_return"
              ? (s => liveReturnPct(s))
              : (s => s[sortKey]);
    return [...portfolio].sort((a, b) => sortDir * (key(a) > key(b) ? 1 : -1));
  }, [portfolio, sortKey, sortDir]);

  const toggleSort = k => {
    if (sortKey === k) setSortDir(d => -d);
    else { setSortKey(k); setSortDir(-1); }
  };

  const Th = ({ label, k, right }) => (
    <th onClick={() => toggleSort(k)} style={{ padding: "9px 12px", cursor: "pointer", fontWeight: 500, fontSize: 11, color: C.secondary, textAlign: right ? "right" : "left", whiteSpace: "nowrap", userSelect: "none", background: C.hover, letterSpacing: "0.05em", textTransform: "uppercase" }}>
      {label}{sortKey === k ? (sortDir === -1 ? " down" : " up") : ""}
    </th>
  );

  // Live return = unrealized P&L from ORIGINAL entry_price (first time the
  // stock entered the portfolio) to latest_price (most recent available
  // close in the snapshot's price file). Per Rishu: always from entry_price,
  // never from rebal_price, so this reflects true since-purchase P&L.
  function liveReturnPct(s) {
    const entry = Number(s.entry_price);
    const latestP = Number(s.latest_price ?? s.rebal_price ?? s.entry_price);
    if (!Number.isFinite(entry) || !entry || !Number.isFinite(latestP)) return null;
    return ((latestP - entry) / entry) * 100;
  }

  const fallbackUsingFullPeriod = !asOfMetrics && perf;
  const sharpe = asOfMetrics ? asOfMetrics.sharpe : (perf?.risk?.sharpe ?? "1.53");
  const totalRet = asOfMetrics
    ? `${asOfMetrics.totalPct > 0 ? "+" : ""}${asOfMetrics.totalPct}%`
    : perf?.returns?.total_pct != null ? `${perf.returns.total_pct > 0 ? "+" : ""}${perf.returns.total_pct}%` : "+76.0%";
  const alpha = asOfMetrics
    ? `${asOfMetrics.alphaAnnPct > 0 ? "+" : ""}${asOfMetrics.alphaAnnPct}%`
    : perf?.returns?.alpha_ann != null ? `${perf.returns.alpha_ann > 0 ? "+" : ""}${perf.returns.alpha_ann}%` : "+33.3%";
  const sensexTotalForSub = asOfMetrics ? asOfMetrics.sensexTotalPct : perf?.returns?.sensex_total;
  const returnSinceLabel = asOfMetrics ? `Since 25 Jun 2024 - to ${asOfMetrics.asOfDate}` : "Since 25 Jun 2024";

  const fmtMetric = v => Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "-";
  const fmtPrice = v => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-";
  const fmtPct = v => Number.isFinite(Number(v)) ? `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%` : "-";
  const tableColSpan = 12;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.secondary }}>
          Viewing Portfolio Snapshot As Of: <span style={{ color: C.accent, fontWeight: 600 }}>{currentSnapshotLabel}</span>
          {rebalanceDate && <span style={{ color: C.muted, fontWeight: 400 }}> - Rebalance {fmtDate(rebalanceDate)}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            style={{ background: C.bg, color: C.primary, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontSize: 12, outline: "none" }}
          >
            {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ background: C.bg, color: C.primary, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontSize: 12, outline: "none" }}
          >
            {availableMonths.map(month => <option key={month} value={month}>{month}</option>)}
          </select>
          <button
            type="button"
            onClick={applySnapshot}
            disabled={snapshotIsLoading || !hasPendingSelection}
            style={{ border: "none", borderRadius: 4, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: snapshotIsLoading || !hasPendingSelection ? "default" : "pointer", background: hasPendingSelection ? C.accent : C.border, color: hasPendingSelection ? "#fff" : C.secondary, fontFamily: "Inter,sans-serif" }}
          >
            Apply
          </button>
        </div>
      </div>

      {snapshotIsError && (
        <div style={{ background: C.redDim, border: `0.5px solid ${C.red}`, color: C.red, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12 }}>
          {snapshotState.error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10, marginBottom: 24 }}>
        <StatCard label="Universe" value={universe.length.toLocaleString()} sub="Nifty 500 stocks" />
        <StatCard label="Pass fundamental" value={fp} sub="RoE, CAGR, P/E filters" color={C.accent} />
        <StatCard label="Sectors selected" value={`${SELECTED_SECTORS.size} of ${allSectors.length}`} sub="Active sector conviction" />
        <StatCard label="Pass beta filter" value={bp} sub="Beta <= 1.2 in target sectors" color="#f97316" />
        <StatCard label="In portfolio" value={portfolio.length} sub="After sector cap" color={C.green} />
        <StatCard
          label="Next rebalance"
          value={nextRebalanceDate ? fmtDate(nextRebalanceDate) : "Latest"}
          sub={nextRebalanceSub}
          color={!nextApplied && nextRebalanceDate && daysUntil(nextRebalanceDate) <= 14 ? C.amber : C.primary}
          warn={!nextApplied && nextRebalanceDate && daysUntil(nextRebalanceDate) <= 14}
        />
      </div>

      {(asOfMetrics || perf) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
          <StatCard label="Live total return" value={totalRet} sub={`${returnSinceLabel} - SENSEX ${sensexTotalForSub > 0 ? "+" : ""}${sensexTotalForSub}%`} color={C.green} small />
          <StatCard label="Alpha (ann)" value={alpha} sub={asOfMetrics ? `vs SENSEX, as of ${asOfMetrics.asOfDate}` : "vs SENSEX annualised"} color={C.green} small />
          <StatCard label="Sharpe ratio" value={sharpe} sub={asOfMetrics ? "Risk-adjusted, as of filter date" : "Risk-adjusted return"} color={C.accent} small />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 16, color: C.secondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Selection funnel</div>
          <FunnelBar label="Nifty 500 universe" count={universe.length} total={universe.length} color={C.accent} />
          <FunnelBar label="Pass fundamental criteria" count={fp} total={universe.length} color="#8b5cf6" />
          <FunnelBar label="In target sectors" count={sp} total={universe.length} color={C.amber} />
          <FunnelBar label="Pass beta filter (Beta <= 1.2)" count={bp} total={universe.length} color="#f97316" />
          <FunnelBar label="Final portfolio (sector cap)" count={portfolio.length} total={universe.length} color={C.green} />
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${C.subtle}`, fontSize: 11, color: C.muted }}>
            {"RoE >= 13% - Rev CAGR >= 7% - EPS CAGR >= 10% - P/E <= 20x - Beta <= 1.2 - Sector cap: min(3, max(1, floor(20% x sector size)))"}
          </div>
        </div>
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 16, color: C.secondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Sector allocation - Equal weight</div>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <DonutChart data={sectorAlloc} size={110} />
            <div style={{ flex: 1 }}>
              {sectorAlloc.map(s => {
                const alloc = portfolio.length > 0 ? ((s.count / portfolio.length) * 100).toFixed(1) : "0.0";
                return (
                  <div key={s.sector} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", marginBottom: 2 }}>
                    <div style={{ width: 7, height: 7, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, color: C.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sector}</div>
                    <div style={{ fontSize: 11, color: C.muted, minWidth: 28 }}>{s.count}</div>
                    <div style={{ width: 48, height: 3, borderRadius: 2, background: C.border }}><div style={{ width: `${alloc}%`, height: "100%", borderRadius: 2, background: s.color }} /></div>
                    <div style={{ fontSize: 11, color: C.secondary, minWidth: 32, textAlign: "right" }}>{alloc}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, color: C.secondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Portfolio - {portfolio.length} stocks
        {snapshotIsLoading && <span style={{ marginLeft: 10, color: C.amber, fontWeight: 400, textTransform: "none", fontSize: 11 }}>Loading snapshot</span>}
        {betaStatus !== "ok" && snapshotState.status !== "ok" && <span style={{ marginLeft: 10, color: C.amber, fontWeight: 400, textTransform: "none", fontSize: 11 }}>Betas loading</span>}
      </div>
      <div style={{ overflowX: "auto", border: `0.5px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            <Th label="Ticker" k="ticker" /><Th label="Company" k="name" /><Th label="Sector" k="sector" />
            <Th label="RoE %" k="roe" right /><Th label="Rev CAGR" k="revCAGR" right />
            <Th label="EPS CAGR" k="epsCAGR" right /><Th label="Beta" k="beta" right />
            <Th label="P/E" k="pe" right /><Th label="G/P Score" k="gp" right /><Th label="Rebal price" k="rebal_price" right />
            <Th label="Entry price" k="entry_price" right /><Th label="Live return" k="live_return" right />
          </tr></thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={tableColSpan} style={{ padding: "40px", textAlign: "center", color: C.muted, fontSize: 13 }}>
                {snapshotIsLoading ? "Loading portfolio snapshot..." : "No stocks pass all filters."}
              </td></tr>
            ) : displayed.map((s, i) => {
              const liveRet = liveReturnPct(s);
              const livePositive = liveRet == null ? null : liveRet >= 0;
              return (
                <tr key={s.ticker} style={{ borderTop: `0.5px solid ${C.subtle}`, background: i % 2 === 0 ? "transparent" : C.card + "44" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: 12, color: C.primary }}>{s.ticker}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: C.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{s.name}</td>
                  <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, fontWeight: 500, background: (SECTOR_COLORS[s.sector] || C.accent) + "18", color: SECTOR_COLORS[s.sector] || C.accent, whiteSpace: "nowrap" }}>{s.sector}</span></td>
                  {[
                    { v: `${fmtMetric(s.roe)}%` },
                    { v: `${fmtMetric(s.revCAGR)}%` },
                    { v: `${fmtMetric(s.epsCAGR)}%` },
                    { v: Number.isFinite(Number(s.beta)) ? Number(s.beta).toFixed(2) : "-" },
                    { v: `${fmtMetric(s.pe)}x` },
                    { v: growthScore(s).toFixed(2) },
                    { v: fmtPrice(s.rebal_price ?? s.entry_price) },
                    { v: fmtPrice(s.entry_price) },
                  ].map((cell, ci) => (
                    <td key={ci} style={{ padding: "10px 12px", textAlign: "right", color: C.primary, fontFamily: "var(--font-mono)", fontSize: 12 }}>{cell.v}</td>
                  ))}
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: livePositive == null ? C.muted : livePositive ? C.green : C.red }}>
                    {fmtPct(liveRet)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>{"All stocks pass RoE >= 13% - Rev CAGR >= 7% - EPS CAGR >= 10% - P/E <= 20x - Beta <= 1.2 - in target sectors - Live return = unrealized return from original entry price to latest available close"}</div>
    </div>
  );
}
