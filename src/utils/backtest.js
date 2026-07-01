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

  // Cascade rounds: offsets from the user's chosen epsCAGR and pe thresholds.
  // When customFilters === FILTERS (defaults), this produces the SAME rounds
  // as build_portfolios_and_exits.py — preserving Python parity for the base case.
  const ROUNDS = [
    [customFilters.epsCAGR,     customFilters.pe,     0],
    [customFilters.epsCAGR,     customFilters.pe + 5, 1],
    [customFilters.epsCAGR - 1, customFilters.pe + 5, 2],
    [customFilters.epsCAGR - 2, customFilters.pe + 5, 3],
    [customFilters.epsCAGR - 3, customFilters.pe + 5, 4],
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

function allTradingDaysInWindow(dailyPrices, startDate, endDate) {
  // FIX: Initialize the Set with the explicit rebalance dates so market 
  // holidays (like Dec 25) are never skipped by the chronological loop.
  const all = new Set(CUSTOM_BACKTEST_REBALANCE_DATES);
  
  Object.values(dailyPrices || {}).forEach(series => {
    Object.keys(series).forEach(d => { 
      if (d >= startDate && d <= endDate) all.add(d); 
    });
  });
  
  return [...all].sort();
}

const CASH_RATE_ANNUAL = 0.06; // must match compute_nav.py CASH_RATE_ANNUAL
const CASH_RATE_DAILY = Math.pow(1 + CASH_RATE_ANNUAL, 1 / 365) - 1;

/**
 * Runs the complete backtest, mirroring build_portfolios_and_exits.py methodology:
 *
 *   - Holdings are tracked as SHARES with ORIGINAL entry prices carried forward
 *   - At each rebalance, matches current portfolio against previous portfolio:
 *     - Stocks held from previous quarter: carry forward entry_date/entry_price
 *     - New stocks: entry_date = current rebalance, entry_price = current rebalance price
 *   - Trade log is only generated when stocks EXIT (rebalance or intra-quarter)
 *   - Returns calculated from ORIGINAL entry_price, not quarterly rebalance price
 *   - Includes SENSEX benchmark comparison and alpha for each trade
 *   - Logs open positions at the end (last quarter's holdings)
 *   - NAV is walked day-by-day for accurate daily series
 *
 * customFilters, selectedSectors: as before.
 * exitRule: { returnPct, peThreshold } — both user-adjustable, default
 * DEFAULT_EXIT_RULE (20% / 20x), matching the live strategy.
 *
 * Returns:
 *   { navSeries, quarterlyNavSeries, tradeLog, quarterlyPortfolios, dataGaps }
 */
export function runCustomBacktest({ universeByDate, priceTable, dailyPrices }, customFilters, selectedSectors, exitRule = DEFAULT_EXIT_RULE) {
  const dates = CUSTOM_BACKTEST_REBALANCE_DATES;
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const tradeLog = [];
  const quarterlyPortfolios = [];
  const dataGaps = [];

  // Helper: annualised return calculation (matching Python)
  function annualised(absPct, days) {
    if (absPct == null || !days || days <= 0) return null;
    return Number((((1 + absPct / 100) ** (365.25 / days) - 1) * 100).toFixed(2));
  }

  // Helper: get SENSEX price on or before date
  function sensexPriceOn(day) {
    return priceOn(SENSEX_KEY, day);
  }

  // pre-resolve each quarter's screened portfolio once
  const quarterData = dates.slice(0, -1).map((entryDate, i) => {
    const exitDate = dates[i + 1];
    const universe = universeByDate[entryDate] || [];
    const { portfolio, fp, sp, bp, roundUsed, universeCount } =
      buildPortfolioCustom(universe, customFilters, selectedSectors);
    const entryPrices = priceTable[entryDate] || {};

    const stocks = portfolio.map(s => {
      const pIn = entryPrices[s.ticker];
      if (pIn == null || pIn <= 0) {
        dataGaps.push({ date: entryDate, ticker: s.ticker, reason: "no entry price" });
        return null;
      }
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
            exitRecord = { exitDay: day, exitPrice: close };
            break; // first trigger, in date order — matches monitor_exits.py
          }
        }
      }
      return { ...s, rebal_price: pIn, exitRecord };
    }).filter(Boolean);

    return { entryDate, exitDate, stocks, fp, sp, bp, roundUsed, universeCount };
  });

  const allDays = allTradingDaysInWindow(dailyPrices, startDate, endDate);
  const rebalSet = new Set(dates);

  // holdings: ticker -> { shares, entryDate (original), entryPrice (original), 
  //                      rebalPrice (current quarter's rebal price), ttmEps, exitRecord }
  let holdings = {};
  let cash = 0;
  let navSeries = [];
  let quarterIdx = -1;
  let intraExited = new Set(); // track stocks exited intra-quarter this quarter

  function priceOn(ticker, day) {
    const key = ticker === SENSEX_KEY ? ticker : `{ticker}.NS`;
    const series = dailyPrices?.[key];
    
    // Exact match
    if (series?.[day] != null) return series[day];
    
    // Walk back up to 5 days for weekends/holidays (Identical to compute_nav.py)
    const d = new Date(day);
    for (let i = 0; i < 5; i++) {
      d.setUTCDate(d.getUTCDate() - 1);
      const ds = d.toISOString().split('T')[0];
      if (series?.[ds] != null) return series[ds];
    }
    
    // Final fallback to the authoritative rebalance price table
    return priceTable[day]?.[ticker] ?? null;
  }

  function markToMarket(day) {
    let total = cash;
    for (const ticker in holdings) {
      const p = priceOn(ticker, day);
      if (p != null) total += holdings[ticker].shares * p;
    }
    return total;
  }

  for (const day of allDays) {
    // ── rebalance ──
    if (rebalSet.has(day)) {
      const qIdx = dates.indexOf(day);
      if (qIdx >= 0 && qIdx < quarterData.length) {
        const totalValue = markToMarket(day) || 100; // first rebalance: nothing held yet, seed at 100
        const q = quarterData[qIdx];
        const n = q.stocks.length;
        const alloc = n > 0 ? totalValue / n : totalValue;
        const sensexRebal = sensexPriceOn(day);

        // Build new portfolio for this quarter
        const newHoldings = {};
        const currentTickers = new Set(q.stocks.map(s => s.ticker));

        // Process stocks that are in the new portfolio
        q.stocks.forEach(s => {
          const ticker = s.ticker;
          const rebalPrice = s.rebal_price;

          if (ticker in intraExited) {
            // Was sold intra-quarter last time — treat as new entry
            intraExited.delete(ticker);
            const shares = rebalPrice > 0 ? alloc / rebalPrice : 0;
            newHoldings[ticker] = {
              shares,
              entryDate: day,
              entryPrice: rebalPrice,
              rebalPrice: rebalPrice,
              ttmEps: s.pe && s.pe > 0 ? rebalPrice / s.pe : null,
              exitRecord: s.exitRecord,
              name: s.name,
              sector: s.sector,
              pe: s.pe,
            };
          } else if (ticker in holdings) {
            // Carried over from previous quarter — preserve original entry.
            // Share count is computed using the ORIGINAL entry_price, mirroring
            // compute_nav.py which does: shares = alloc / s.get("entry_price").
            // This means a carried position gets alloc/entry_price shares, not
            // alloc/rebalPrice shares — the same "ghost share" accounting that
            // Python uses, so NAV series are directly comparable.
            const h = holdings[ticker];
            const priceForShares = h.entryPrice > 0 ? h.entryPrice : rebalPrice;
            const shares = priceForShares > 0 ? alloc / priceForShares : 0;
            newHoldings[ticker] = {
              shares,
              entryDate: h.entryDate, // Original entry date
              entryPrice: h.entryPrice, // Original entry price
              rebalPrice: rebalPrice, // Current quarter's rebalance price (resets)
              ttmEps: s.pe && s.pe > 0 ? rebalPrice / s.pe : null,
              exitRecord: s.exitRecord,
              name: h.name,
              sector: h.sector,
              pe: s.pe,
            };
          } else {
            // New entry this quarter
            const shares = rebalPrice > 0 ? alloc / rebalPrice : 0;
            newHoldings[ticker] = {
              shares,
              entryDate: day,
              entryPrice: rebalPrice,
              rebalPrice: rebalPrice,
              ttmEps: s.pe && s.pe > 0 ? rebalPrice / s.pe : null,
              exitRecord: s.exitRecord,
              name: s.name,
              sector: s.sector,
              pe: s.pe,
            };
          }
        });

        // Log rebalance exits (stocks in holdings but not in new portfolio)
        for (const ticker in holdings) {
          if (!currentTickers.has(ticker) && !intraExited.has(ticker)) {
            const h = holdings[ticker];
            const exitPrice = priceOn(ticker, day);
            const entryPrice = h.entryPrice;
            const entryDate = h.entryDate;
            const sEntry = sensexPriceOn(entryDate);
            const sExit = sensexRebal;

            if (exitPrice != null && entryPrice != null) {
              const days = (new Date(day) - new Date(entryDate)) / 86400000;
              const absRet = Number(((exitPrice - entryPrice) / entryPrice * 100).toFixed(2));
              const annRet = annualised(absRet, days);
              const sensexAbs = sEntry != null && sExit != null ? Number(((sExit - sEntry) / sEntry * 100).toFixed(2)) : null;
              const sensexAnn = sensexAbs != null ? annualised(sensexAbs, days) : null;
              const alphaAbs = absRet != null && sensexAbs != null ? Number((absRet - sensexAbs).toFixed(2)) : null;
              const alphaAnn = annRet != null && sensexAnn != null ? Number((annRet - sensexAnn).toFixed(2)) : null;

              tradeLog.push({
                ticker,
                name: h.name,
                sector: h.sector,
                entry_date: entryDate,
                exit_date: day,
                entry_price: entryPrice,
                exit_price: exitPrice,
                holding_days: Math.round(days),
                abs_return_pct: absRet,
                ann_return_pct: annRet,
                sensex_abs_pct: sensexAbs,
                sensex_ann_pct: sensexAnn,
                alpha_abs: alphaAbs,
                alpha_ann: alphaAnn,
                exit_type: "rebalance",
                status: "closed",
              });
            } else {
              dataGaps.push({ date: day, ticker, reason: "missing price for exit calculation" });
            }
          }
        }

        holdings = newHoldings;
        cash = 0;
        intraExited = new Set(); // Reset for this quarter

        // Save quarterly portfolio snapshot
        const quarterStocks = q.stocks.map(s => {
          const h = holdings[s.ticker];
          const exitPrice = s.exitRecord ? s.exitRecord.exitPrice : (priceTable[q.exitDate]?.[s.ticker] ?? null);
          const exitDay = s.exitRecord ? s.exitRecord.exitDay : q.exitDate;
          const entryPrice = h?.entryPrice || s.rebal_price;
          const entryDate = h?.entryDate || day;
          const returnPct = exitPrice != null && entryPrice != null ? Number(((exitPrice - entryPrice) / entryPrice * 100).toFixed(2)) : null;

          return {
            ticker: s.ticker,
            name: s.name,
            sector: s.sector,
            roe: s.roe,
            revCAGR: s.revCAGR,
            epsCAGR: s.epsCAGR,
            beta: s.beta,
            pe: s.pe,
            entry_date: entryDate,
            entry_price: entryPrice,
            rebal_price: s.rebal_price,
            exit_price: exitPrice,
            exit_date: exitDay,
            exit_type: s.exitRecord ? "intra_quarter" : "rebalance",
            return_pct: returnPct,
          };
        });

        quarterlyPortfolios.push({
          date: q.entryDate,
          nextDate: q.exitDate,
          portfolio: q.stocks,
          fp: q.fp,
          sp: q.sp,
          bp: q.bp,
          roundUsed: q.roundUsed,
          universeCount: q.universeCount,
          stocks: quarterStocks,
        });
        quarterIdx = qIdx;
      }
    }

    // ── process intra-quarter exits scheduled for today ──
    for (const ticker in holdings) {
      const h = holdings[ticker];
      if (h.exitRecord && h.exitRecord.exitDay === day) {
        const p = priceOn(ticker, day);
        if (p != null) {
          const entryPrice = h.entryPrice;
          const entryDate = h.entryDate;
          const rebalPrice = h.rebalPrice;
          const sEntry = sensexPriceOn(entryDate);
          const sExit = sensexPriceOn(day);

          const days = (new Date(day) - new Date(entryDate)) / 86400000;
          const absRet = Number(((p - entryPrice) / entryPrice * 100).toFixed(2));
          const annRet = annualised(absRet, days);
          const retFromRebal = Number(((p - rebalPrice) / rebalPrice * 100).toFixed(2));
          const livePe = h.ttmEps ? Number((p / h.ttmEps).toFixed(2)) : null;
          const sensexAbs = sEntry != null && sExit != null ? Number(((sExit - sEntry) / sEntry * 100).toFixed(2)) : null;
          const sensexAnn = sensexAbs != null ? annualised(sensexAbs, days) : null;
          const alphaAbs = absRet != null && sensexAbs != null ? Number((absRet - sensexAbs).toFixed(2)) : null;
          const alphaAnn = annRet != null && sensexAnn != null ? Number((annRet - sensexAnn).toFixed(2)) : null;

          tradeLog.push({
            ticker,
            name: h.name,
            sector: h.sector,
            entry_date: entryDate,
            exit_date: day,
            entry_price: entryPrice,
            rebal_price: rebalPrice,
            exit_price: p,
            holding_days: Math.round(days),
            abs_return_pct: absRet,
            ann_return_pct: annRet,
            ret_from_rebal: retFromRebal,
            pe_at_exit: livePe,
            sensex_abs_pct: sensexAbs,
            sensex_ann_pct: sensexAnn,
            alpha_abs: alphaAbs,
            alpha_ann: alphaAnn,
            exit_type: "intra_quarter",
            status: "closed",
            trigger: `ret=${retFromRebal.toFixed(1)}% from ${h.entryDate}, P/E=${livePe?.toFixed(1)}x`,
          });

          cash += h.shares * p;
          delete holdings[ticker];
          intraExited.add(ticker);
        }
      }
    }

    // ── grow idle cash at the overnight rate ──
    if (cash > 0) cash *= (1 + CASH_RATE_DAILY);

    const portfolioValue = markToMarket(day);
    const sensexPrice = priceOn(SENSEX_KEY, day);
    navSeries.push({ date: day, portfolio_nav: portfolioValue, sensex_price: sensexPrice, quarterIdx });
  }

  // ── log open positions (latest portfolio) ──
  const today = dates[dates.length - 1];
  const sensexToday = sensexPriceOn(today);

  for (const ticker in holdings) {
    const h = holdings[ticker];
    const priceToday = priceOn(ticker, today);
    const entryPrice = h.entryPrice;
    const entryDate = h.entryDate;
    const sEntry = sensexPriceOn(entryDate);

    if (priceToday != null && entryPrice != null) {
      const days = (new Date(today) - new Date(entryDate)) / 86400000;
      const absRet = Number(((priceToday - entryPrice) / entryPrice * 100).toFixed(2));
      const annRet = annualised(absRet, days);
      const sensexAbs = sEntry != null && sensexToday != null ? Number(((sensexToday - sEntry) / sEntry * 100).toFixed(2)) : null;
      const sensexAnn = sensexAbs != null ? annualised(sensexAbs, days) : null;
      const alphaAbs = absRet != null && sensexAbs != null ? Number((absRet - sensexAbs).toFixed(2)) : null;
      const alphaAnn = annRet != null && sensexAnn != null ? Number((annRet - sensexAnn).toFixed(2)) : null;

      tradeLog.push({
        ticker,
        name: h.name,
        sector: h.sector,
        entry_date: entryDate,
        exit_date: null,
        entry_price: entryPrice,
        exit_price: priceToday,
        holding_days: Math.round(days),
        abs_return_pct: absRet,
        ann_return_pct: annRet,
        sensex_abs_pct: sensexAbs,
        sensex_ann_pct: sensexAnn,
        alpha_abs: alphaAbs,
        alpha_ann: alphaAnn,
        exit_type: null,
        status: "open",
      });
    }
  }

  // normalise: NAV starts at 100 on day one, SENSEX NAV rebased the same way
  const navStart = navSeries[0]?.portfolio_nav || 100;
  const sensexStart = navSeries.find(d => d.sensex_price != null)?.sensex_price;
  navSeries = navSeries.map(d => ({
    date: d.date,
    portfolio_nav: Number(((d.portfolio_nav / navStart) * 100).toFixed(4)),
    sensex_nav: d.sensex_price != null && sensexStart ? Number(((d.sensex_price / sensexStart) * 100).toFixed(4)) : null,
  }));

  // fill any null sensex_nav by carrying the last known value forward
  let lastSensex = 100;
  navSeries = navSeries.map(d => {
    if (d.sensex_nav != null) lastSensex = d.sensex_nav;
    return { ...d, sensex_nav: lastSensex };
  });

  const navByDate = Object.fromEntries(navSeries.map(d => [d.date, d]));
  const quarterlyNavSeries = dates.map(d => navByDate[d]).filter(Boolean);

  return { navSeries, quarterlyNavSeries, tradeLog, quarterlyPortfolios, dataGaps };
}

// ── performance metrics from the custom NAV/trade series ───────────────
// All metrics now use the FULL DAILY navSeries to match compute_performance_metrics.py
// This ensures custom backtest metrics are directly comparable to live strategy metrics.

function dailyReturns(navSeries) {
  const navs = navSeries.map(d => d.portfolio_nav);
  return navs.slice(1).map((v, i) => (v - navs[i]) / navs[i]);
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr, m) { return arr.length ? Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length) : 0; }

export function computeCustomMetrics(navSeries, quarterlyNavSeries) {
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

  // daily excess returns vs daily risk-free rate (matching compute_performance_metrics.py)
  const TRADING_DAYS = 252;
  const rfDaily = Math.pow(1 + RISK_FREE_RATE, 1 / TRADING_DAYS) - 1;
  const portRet = dailyReturns(navSeries);
  const sensexRet = dailyReturns(navSeries.map(d => ({ portfolio_nav: d.sensex_nav })));

  const excess = portRet.map(r => r - rfDaily);
  const meanExc = mean(excess);
  const stdAll = std(excess, meanExc);
  // annualize daily Sharpe by sqrt(252)
  const sharpe = stdAll ? (meanExc / stdAll) * Math.sqrt(TRADING_DAYS) : 0;

  const downside = excess.filter(x => x < 0); // mirror Python: filter raw excess < 0 (i.e. r < rf_daily), not double-subtract rf
  const stdDown = std(downside, 0);
  const sortino = stdDown ? (meanExc / stdDown) * Math.sqrt(TRADING_DAYS) : 0;

  const n = Math.min(portRet.length, sensexRet.length);
  const pr = portRet.slice(-n), sr = sensexRet.slice(-n);
  const pm = mean(pr), sm = mean(sr);
  const cov = pr.reduce((a, _, i) => a + (pr[i] - pm) * (sr[i] - sm), 0);
  const varS = sr.reduce((a, x) => a + (x - sm) ** 2, 0);
  const varP = pr.reduce((a, x) => a + (x - pm) ** 2, 0);
  const beta = varS ? cov / varS : 1;
  const correlation = varS && varP ? cov / Math.sqrt(varS * varP) : 0;

  const treynor = beta ? (annPct - RISK_FREE_RATE * 100) / beta : 0;
  const jensenAlpha = annPct - (RISK_FREE_RATE * 100 + beta * (sensexAnnPct - RISK_FREE_RATE * 100));

  const activeDaily = pr.map((r, i) => r - sr[i]);
  const activeMean = mean(activeDaily);
  const trackingError = std(activeDaily, activeMean) * Math.sqrt(TRADING_DAYS);
  const activeAnnDecimal = (annPct - sensexAnnPct) / 100;
  const infoRatio = trackingError ? activeAnnDecimal / trackingError : 0;

  // max drawdown across the full daily series (matching compute_performance_metrics.py)
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
    sharpe: Number(sharpe.toFixed(4)),
    sortino: Number(sortino.toFixed(4)),
    beta: Number(beta.toFixed(4)),
    correlation: Number(correlation.toFixed(4)),
    treynor: Number(treynor.toFixed(2)),
    jensenAlpha: Number(jensenAlpha.toFixed(2)),
    infoRatio: Number(infoRatio.toFixed(4)),
    trackingError: Number((trackingError * 100).toFixed(2)),
    maxDrawdownPct: Number((maxDd * 100).toFixed(2)),
  };
}