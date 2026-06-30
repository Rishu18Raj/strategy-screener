// backtest.js
// ─────────────────────────────────────────────────────────────────────────
// Historical re-simulation engine for the Build & Test tab.
//
// WHAT THIS DOES
//   When a user adjusts a filter threshold (e.g. P/E 20 -> 25), this module
//   does NOT just refilter today's stock table. It rebuilds the portfolio
//   AT EACH of the 9 historical rebalance dates using that quarter's ACTUAL
//   fundamentals/beta snapshot (the same files OverviewTab's "time machine"
//   uses), under the custom filter — i.e. "if this strategy had been running
//   for the last 2 years with these thresholds, using only the data that
//   would have been available at each point in time, what would have
//   happened" — not "what would today's filtered list have returned if
//   bought 2 years ago."
//
//   Each quarter's resulting portfolio is then walked DAY BY DAY using
//   data/historical/universe_daily_prices.json, checking the intra-quarter
//   early-exit rule on every trading day — exactly the mechanics in
//   monitor_exits.py:
//     1. TTM EPS is derived ONCE at rebalance entry: rebal_price / rebal_PE,
//        and held fixed for the whole quarter (fundamentals don't update
//        intra-quarter in this strategy, live or custom).
//     2. On each trading day: live_PE = daily_close / that fixed TTM EPS.
//     3. If (return_since_rebal_entry > returnPct threshold) AND
//        (live_PE > peThreshold) on the SAME day, the position exits that
//        day. First day both conditions are true, in date order — matches
//        monitor_exits.py's `break` on first trigger.
//     4. Freed capital is NOT reinvested — it sits idle (0% return) until
//        the next rebalance, same as the live strategy (monitor_exits.py
//        has no redeploy-proceeds logic).
//   Both threshold values are user-adjustable sliders, defaulting to the
//   live strategy's 20% / 20x (DEFAULT_EXIT_RULE below).
//
//   If a position never triggers the exit rule, it's simply held to the
//   next rebalance using the rebalance-date close from
//   universe_rebalance_prices.json (cheaper than scanning the daily series
//   again for the terminal price — the rebalance price file is the
//   authoritative quarter-end mark).
//
// DATA GAPS
//   A position whose ticker has no daily price series in
//   universe_daily_prices.json (e.g. fetch came back empty — pre-IPO,
//   delisted, etc.) falls back to hold-to-rebalance using
//   universe_rebalance_prices.json only, with no intra-quarter exit check
//   possible for that one position that quarter. Logged in `dataGaps`.
//
// CASH HANDLING
//   Equal-weight at each rebalance, exactly like buildPortfolio() in
//   strategy.js. Idle cash from an early exit earns 0% (not the risk-free
//   rate) until the next rebalance — matches the live strategy, which does
//   not model an idle-cash yield either.
// ─────────────────────────────────────────────────────────────────────────

import Papa from "papaparse";
import { historicalFundamentalsUrl, historicalBetasUrl, REBALANCE_LABELS, URLS } from "../config";

export const CUSTOM_BACKTEST_REBALANCE_DATES = [
  "2024-06-25", "2024-09-25", "2024-12-25", "2025-03-25",
  "2025-06-25", "2025-09-25", "2025-12-25", "2026-03-25", "2026-06-25",
];

const RISK_FREE_RATE = 0.06; // must match compute_performance_metrics.py
const SENSEX_KEY = "^BSESN";

// Default intra-quarter early-exit thresholds — mirrors monitor_exits.py
// EXIT_RETURN_THRESHOLD / EXIT_PE_THRESHOLD exactly. Exposed as adjustable
// sliders in the Build & Test tab; these are just the defaults.
export const DEFAULT_EXIT_RULE = { returnPct: 20, peThreshold: 20 };

// ── data loading ──────────────────────────────────────────────────────

function parseHistoricalCSV(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  const pct = v => parseFloat((v || "").toString().replace("%", "").replace(",", ""));
  return data
    .map(obj => ({
      ticker: obj.ticker?.trim(),
      name: obj.name?.trim(),
      sector: obj.sector?.trim(),
      roe: pct(obj.roe),
      revCAGR: pct(obj.revCAGR),
      epsCAGR: pct(obj.epsCAGR),
      pe: pct(obj.pe),
      beta: null,
    }))
    .filter(s => s.ticker);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.text();
}

/**
 * Loads everything the backtest needs: per-quarter universes (fundamentals
 * + beta merged), the full universe rebalance-date price table, and the
 * full universe daily price series (for intra-quarter exit checks).
 * Call this once and reuse the result across however many times the user
 * drags a slider — only the filters/exit-rule change, not the underlying data.
 */
export async function loadBacktestData() {
  const [priceTable, dailyPrices, ...quarters] = await Promise.all([
    fetchJSON(URLS.universeRebalancePrices),
    fetchJSON(URLS.universeDailyPrices),
    ...REBALANCE_LABELS.map(async label => {
      const [fundText, betas] = await Promise.all([
        fetchText(historicalFundamentalsUrl(label)),
        fetchJSON(historicalBetasUrl(label)).catch(() => ({})),
      ]);
      const universe = parseHistoricalCSV(fundText).map(s => ({ ...s, beta: betas[s.ticker] ?? null }));
      return { label, universe };
    }),
  ]);

  const universeByDate = {};
  CUSTOM_BACKTEST_REBALANCE_DATES.forEach((date, i) => {
    universeByDate[date] = quarters[i].universe;
  });

  return { priceTable, dailyPrices, universeByDate };
}

// ── portfolio construction at a single quarter, under custom filters ────

export function getSectorCapsCustom(all) {
  const c = {};
  all.forEach(s => { if (s.sector) c[s.sector] = (c[s.sector] || 0) + 1; });
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.min(3, Math.max(1, Math.floor(0.2 * v)))]));
}

function growthScoreCustom(s) { return s.pe > 0 ? (s.epsCAGR || 0) / s.pe : 0; }

/**
 * Builds the portfolio for ONE quarter under custom filter thresholds.
 * Mirrors buildPortfolio() in strategy.js (same relaxation-round logic),
 * but parameterized instead of reading the fixed FILTERS/SELECTED_SECTORS
 * constants, since OverviewTab's live table still needs those untouched.
 *
 * customFilters: { roe, revCAGR, epsCAGR, beta, pe }
 * selectedSectors: Set<string>
 */
export function buildPortfolioCustom(universe, customFilters, selectedSectors) {
  const caps = getSectorCapsCustom(universe);
  // Same 5-round relaxation pattern as the live strategy, but the starting
  // point and ceiling for each round scale off the user's custom EPS/PE
  // rather than the hardcoded 10/20 base — relaxation still exists so a
  // very tight custom filter doesn't return an empty portfolio every quarter.
  const baseEps = customFilters.epsCAGR;
  const basePe = customFilters.pe;
  const ROUNDS = [
    [baseEps, basePe, 0],
    [baseEps, basePe + 5, 1],
    [Math.max(0, baseEps - 1), basePe + 5, 2],
    [Math.max(0, baseEps - 2), basePe + 5, 3],
    [Math.max(0, baseEps - 3), basePe + 5, 4],
  ];

  let fp = 0, sp = 0, bp = 0, portfolio = [], roundUsed = 0;

  for (const [eps, pe, rnd] of ROUNDS) {
    const fund = universe.filter(s =>
      !isNaN(s.roe) && s.roe >= customFilters.roe &&
      !isNaN(s.revCAGR) && s.revCAGR >= customFilters.revCAGR &&
      !isNaN(s.epsCAGR) && s.epsCAGR >= eps &&
      !isNaN(s.pe) && s.pe <= pe
    );
    const sec = fund.filter(s => selectedSectors.has(s.sector));
    const bet = sec.filter(s => s.beta != null && s.beta <= customFilters.beta);
    if (rnd === 0) { fp = fund.length; sp = sec.length; bp = bet.length; }

    const bySec = {};
    bet.forEach(s => bySec[s.sector] ? bySec[s.sector].push(s) : (bySec[s.sector] = [s]));
    const cands = [];
    Object.entries(bySec).forEach(([sector, ss]) => {
      const cap = caps[sector] || 1;
      [...ss].sort((a, b) => growthScoreCustom(b) - growthScoreCustom(a)).slice(0, cap)
        .forEach(s => cands.push({ ...s, filter_round: rnd }));
    });

    if (cands.length >= 6 || rnd === 4) { portfolio = cands; roundUsed = rnd; break; }
  }

  return { portfolio, fp, sp, bp, roundUsed, universeCount: universe.length };
}

// ── full historical re-simulation ────────────────────────────────────

function tradingDaysBetween(dailySeries, afterDateStr, beforeDateStr) {
  return Object.keys(dailySeries || {})
    .filter(d => d > afterDateStr && d < beforeDateStr)
    .sort();
}

/**
 * Runs the complete backtest: builds a portfolio at each historical
 * rebalance date under the custom filter (using ONLY that quarter's actual
 * fundamentals/beta snapshot — no lookahead), then walks each position
 * day-by-day to apply the intra-quarter early-exit rule, exactly mirroring
 * monitor_exits.py's mechanics. Produces a NAV series, a trade log, and
 * a per-quarter portfolio detail list (with entry/exit price + return per
 * stock) for the Build & Test tab's clickable snapshot widget.
 *
 * exitRule: { returnPct, peThreshold } — both user-adjustable, default
 * DEFAULT_EXIT_RULE (20% / 20x), matching the live strategy.
 *
 * Returns:
 *   { navSeries, tradeLog, quarterlyPortfolios, dataGaps }
 */
export function runCustomBacktest({ universeByDate, priceTable, dailyPrices }, customFilters, selectedSectors, exitRule = DEFAULT_EXIT_RULE) {
  const dates = CUSTOM_BACKTEST_REBALANCE_DATES;
  const navSeries = [{ date: dates[0], portfolio_nav: 100, sensex_nav: 100 }];
  const tradeLog = [];
  const quarterlyPortfolios = [];
  const dataGaps = [];

  let portNav = 100;
  let sensexNav = 100;

  for (let i = 0; i < dates.length - 1; i++) {
    const entryDate = dates[i];
    const exitDate = dates[i + 1];
    const universe = universeByDate[entryDate] || [];

    const { portfolio, fp, sp, bp, roundUsed, universeCount } =
      buildPortfolioCustom(universe, customFilters, selectedSectors);

    const entryPrices = priceTable[entryDate] || {};
    const exitPrices = priceTable[exitDate] || {};
    const sensexEntry = entryPrices[SENSEX_KEY];
    const sensexExit = exitPrices[SENSEX_KEY];

    // per-position returns for this quarter, skipping any with unresolvable prices
    const positionReturns = [];
    const quarterStocks = []; // enriched detail for the snapshot widget

    portfolio.forEach(s => {
      const pIn = entryPrices[s.ticker];
      if (pIn == null || pIn <= 0) {
        dataGaps.push({ date: entryDate, ticker: s.ticker, reason: "no entry price" });
        return;
      }

      // TTM EPS fixed at rebalance entry — held for the whole quarter,
      // exactly like monitor_exits.py. pe here is the stock's P/E AT
      // REBALANCE (from the fundamentals snapshot), not a live figure.
      const ttmEps = s.pe && s.pe > 0 ? pIn / s.pe : null;

      const series = dailyPrices?.[s.ticker];
      let exitRecord = null;

      if (series && ttmEps) {
        const days = tradingDaysBetween(series, entryDate, exitDate);
        for (const day of days) {
          const close = series[day];
          if (close == null) continue;
          const retPct = ((close - pIn) / pIn) * 100;
          const livePe = close / ttmEps;
          if (retPct > exitRule.returnPct && livePe > exitRule.peThreshold) {
            exitRecord = { exitDay: day, exitPrice: close, retPct, livePe };
            break; // first trigger, in date order — matches monitor_exits.py
          }
        }
      }

      let pOut, exitType, exitDay;
      if (exitRecord) {
        pOut = exitRecord.exitPrice;
        exitType = "intra_quarter";
        exitDay = exitRecord.exitDay;
      } else {
        pOut = exitPrices[s.ticker];
        exitType = "rebalance";
        exitDay = exitDate;
        if (pOut == null) {
          dataGaps.push({ date: entryDate, ticker: s.ticker, reason: "no exit price" });
        }
      }

      if (pOut == null) return; // can't compute a return without an exit price

      const retPct = (pOut - pIn) / pIn;
      // If exited early, the position's contribution to the QUARTER's
      // return is the realised gain on exit day, then 0% (idle cash) for
      // the remainder of the quarter — net effect on quarter return is
      // just the realised return up to exit, same as holding flat after.
      positionReturns.push(retPct);

      tradeLog.push({
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        entry_date: entryDate,
        exit_date: exitDay,
        entry_price: pIn,
        exit_price: pOut,
        abs_return_pct: Number((retPct * 100).toFixed(2)),
        exit_type: exitType,
        status: "closed",
        pe_at_entry: s.pe,
        live_pe_at_exit: exitRecord ? Number(exitRecord.livePe.toFixed(2)) : null,
      });

      quarterStocks.push({
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        roe: s.roe,
        revCAGR: s.revCAGR,
        epsCAGR: s.epsCAGR,
        beta: s.beta,
        pe: s.pe,
        rebal_price: pIn,
        exit_price: pOut,
        exit_date: exitDay,
        exit_type: exitType,
        return_pct: Number((retPct * 100).toFixed(2)),
      });
    });

    quarterlyPortfolios.push({
      date: entryDate, nextDate: exitDate, portfolio, fp, sp, bp, roundUsed, universeCount,
      stocks: quarterStocks,
    });

    // quarter portfolio return — equal weight across resolvable positions only
    const quarterRet = positionReturns.length
      ? positionReturns.reduce((a, b) => a + b, 0) / positionReturns.length
      : 0;
    portNav = portNav * (1 + quarterRet);

    const sensexRet = sensexEntry != null && sensexExit != null && sensexEntry > 0
      ? (sensexExit - sensexEntry) / sensexEntry
      : 0;
    sensexNav = sensexNav * (1 + sensexRet);

    navSeries.push({ date: exitDate, portfolio_nav: Number(portNav.toFixed(4)), sensex_nav: Number(sensexNav.toFixed(4)) });
  }

  return { navSeries, tradeLog, quarterlyPortfolios, dataGaps };
}

// ── performance metrics from the custom NAV/trade series ───────────────
// IMPORTANT: this is QUARTERLY-return-based (9 NAV points), not daily-return
// based like compute_performance_metrics.py (which has ~500 daily points).
// Sharpe/Sortino/etc. computed from 8 quarterly observations are statistically
// thin — report them, but the UI must label them as quarterly-return-based
// and lower-confidence than the live strategy's daily-return metrics, not
// silently present them as equivalent.

function quarterlyReturns(navSeries) {
  const navs = navSeries.map(d => d.portfolio_nav);
  return navs.slice(1).map((v, i) => (v - navs[i]) / navs[i]);
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr, m) { return arr.length ? Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length) : 0; }

export function computeCustomMetrics(navSeries) {
  if (!navSeries || navSeries.length < 2) return null;

  const dates = navSeries.map(d => d.date);
  const portNavs = navSeries.map(d => d.portfolio_nav);
  const sensexNavs = navSeries.map(d => d.sensex_nav);

  const nDays = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000;
  const totalPct = (portNavs[portNavs.length - 1] / portNavs[0] - 1) * 100;
  const annPct = nDays > 0 ? (Math.pow(portNavs[portNavs.length - 1] / portNavs[0], 365 / nDays) - 1) * 100 : 0;
  const sensexTotalPct = (sensexNavs[sensexNavs.length - 1] / sensexNavs[0] - 1) * 100;
  const sensexAnnPct = nDays > 0 ? (Math.pow(sensexNavs[sensexNavs.length - 1] / sensexNavs[0], 365 / nDays) - 1) * 100 : 0;
  const alphaAnnPct = annPct - sensexAnnPct;

  // quarterly excess returns vs a quarterly-equivalent risk-free rate
  const rfQuarterly = Math.pow(1 + RISK_FREE_RATE, 0.25) - 1;
  const portQRet = quarterlyReturns(navSeries);
  const sensexQRet = quarterlyReturns(navSeries.map(d => ({ portfolio_nav: d.sensex_nav })));

  const excess = portQRet.map(r => r - rfQuarterly);
  const meanExc = mean(excess);
  const stdAll = std(excess, meanExc);
  // annualize a quarterly Sharpe by sqrt(4)
  const sharpe = stdAll ? (meanExc / stdAll) * Math.sqrt(4) : 0;

  const downside = excess.filter(x => x < 0);
  const stdDown = std(downside, 0);
  const sortino = stdDown ? (meanExc / stdDown) * Math.sqrt(4) : 0;

  const n = Math.min(portQRet.length, sensexQRet.length);
  const pr = portQRet.slice(-n), sr = sensexQRet.slice(-n);
  const pm = mean(pr), sm = mean(sr);
  const cov = pr.reduce((a, _, i) => a + (pr[i] - pm) * (sr[i] - sm), 0);
  const varS = sr.reduce((a, x) => a + (x - sm) ** 2, 0);
  const varP = pr.reduce((a, x) => a + (x - pm) ** 2, 0);
  const beta = varS ? cov / varS : 1;
  const correlation = varS && varP ? cov / Math.sqrt(varS * varP) : 0;

  const treynor = beta ? (annPct - RISK_FREE_RATE * 100) / beta : 0;
  const jensenAlpha = annPct - (RISK_FREE_RATE * 100 + beta * (sensexAnnPct - RISK_FREE_RATE * 100));

  const activeQ = pr.map((r, i) => r - sr[i]);
  const activeMean = mean(activeQ);
  const trackingError = std(activeQ, activeMean) * Math.sqrt(4);
  const activeAnnDecimal = (annPct - sensexAnnPct) / 100;
  const infoRatio = trackingError ? activeAnnDecimal / trackingError : 0;

  // max drawdown across the 9 NAV points
  let peak = portNavs[0], maxDd = 0;
  portNavs.forEach(nav => {
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDd) maxDd = dd;
  });

  return {
    totalPct: Number(totalPct.toFixed(2)),
    annPct: Number(annPct.toFixed(2)),
    sensexTotalPct: Number(sensexTotalPct.toFixed(2)),
    sensexAnnPct: Number(sensexAnnPct.toFixed(2)),
    alphaAnnPct: Number(alphaAnnPct.toFixed(2)),
    sharpe: Number(sharpe.toFixed(2)),
    sortino: Number(sortino.toFixed(2)),
    beta: Number(beta.toFixed(2)),
    correlation: Number(correlation.toFixed(2)),
    treynor: Number(treynor.toFixed(2)),
    jensenAlpha: Number(jensenAlpha.toFixed(2)),
    infoRatio: Number(infoRatio.toFixed(2)),
    trackingError: Number((trackingError * 100).toFixed(2)),
    maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
    basis: "quarterly", // flag for UI: 8 observations, not ~500 daily
  };
}