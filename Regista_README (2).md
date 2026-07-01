# Fundamental Screener — Project Context & Build Guide

**Live app:** https://strategy-screener.vercel.app
**Repo:** https://github.com/Rishu18Raj/strategy-screener (branch: `main`)
**Owner:** Rishu — non-coder, building entirely through AI coding platforms (Claude, Cursor, v0, Replit, etc.), switching between them due to rate limits. This document exists so any platform can onboard cold, without Rishu having to re-explain the project.

> **Instructions for the AI platform reading this file:** This is the single source of truth for the project. It describes a fully working, deployed application — do not propose rebuilding or restructuring the architecture unless explicitly asked. Read this entire file before making any change.

---

## 1. What this project is

A rules-based, quantitative equity screening and portfolio-tracking web app for Indian (NSE) stocks. It applies five fundamental/risk filters to the Nifty 500 universe, constructs an equal-weight portfolio concentrated in 12 high-conviction sectors, rebalances quarterly, and tracks live performance against the SENSEX — Sharpe, Sortino, Treynor, Jensen Alpha, Information Ratio, drawdown, win rate, full trade log.

Originally an IIM Bangalore Financial Markets course project, productised into a public-facing tool. NAV as of Jun 2026: ~174 (started at 100 in Jun 2024), vs SENSEX NAV of ~99 over the same period.

**Audience:** retail/hobby investors who want a transparent, institutionally-styled screening process they can replicate manually. The app is not a brokerage — users self-execute trades.

---

## 2. Architecture — read this first

This is a **serverless, no-backend** app. No API server, no database.

```
┌──────────────────────────┐         ┌───────────────────────────┐
│  Python pipeline          │         │  React/Vite frontend       │
│  (run manually/locally)   │  push   │  (deployed on Vercel)      │
│                            │ ──────► │                             │
│  Fetches Yahoo Finance     │  to     │  fetch()s JSON/CSV files    │
│  data, computes portfolio, │  GitHub │  directly from              │
│  NAV, and perf metrics     │  repo   │  raw.githubusercontent.com  │
└──────────────────────────┘         └───────────────────────────┘
```

- **GitHub is the database.** All computed data (`data/*.json`, `data/*.csv`, `data/historical/*`) lives in the repo. The frontend fetches these files live from `raw.githubusercontent.com` — URLs defined in `src/config.js → URLS`. No Express/Flask/FastAPI server exists or should be introduced unless explicitly requested.
- **Python scripts are offline/batch tools.** Run on demand by Rishu locally, then outputs are committed and pushed to GitHub. Once pushed, the live frontend picks them up on next page load — no Vercel rebuild needed for data-only changes.
- **Frontend is a static SPA.** Vite + React, deployed to Vercel. `npm run build` → static bundle. No server-side rendering, no API routes.
- **Data source:** Yahoo Finance unofficial endpoints (`query1.finance.yahoo.com/v8/finance/chart/{symbol}`). Not a paid API — pipeline scripts include retry/backoff logic via `requests.adapters.HTTPAdapter`.

**Adding a feature?** First decide: (a) frontend-only reading existing data, (b) new Python computation needing a new output file + a new `URLS` entry in `config.js`, or (c) something requiring a backend — flag (c) as a major architecture change before building.

---

## 3. Tech stack

| Layer | Tech |
|---|---|
| Frontend framework | React 18 (functional components + hooks only) |
| Build tool | Vite 5 |
| Charts | Recharts 3.9 (`LineChart`, `BarChart`) |
| CSV parsing | PapaParse 5.5 |
| Styling | **Inline styles only.** No CSS framework, no Tailwind, no styled-components. All colors reference CSS custom properties defined in `index.html` (`:root` block) and re-exported as JS constants via `src/config.js → C` object (e.g. `C.bg`, `C.accent`, `C.green`). **Always use `C.*` for colors, never hardcode hex.** |
| Fonts | Inter (UI text), JetBrains Mono (numbers/tickers — `var(--font-mono)`) |
| Data pipeline | Python 3, `requests`, `pandas` (only in `build_portfolios_and_exits.py`), stdlib `json`/`math`/`datetime` — deliberately lightweight, no numpy/scipy |
| Data layer | Static JSON/CSV files in `data/`, served via GitHub raw URLs |
| Hosting | Vercel (frontend), GitHub (data + source) |

No TypeScript. No test suite. All `.jsx`/`.js`.

---

## 4. Repository structure

```
strategy-screener/
├── index.html                            # Vite entry; ALL CSS variables/theme defined here
├── vite.config.js                        # Minimal — just the React plugin
├── package.json
├── src/
│   ├── main.jsx                          # ReactDOM root render
│   ├── App.jsx                           # Top-level layout: header, tab switcher, sidebar, root data fetching
│   ├── config.js                         # ALL constants — see Section 5 below
│   ├── components/
│   │   ├── Sidebar.jsx                   # Collapsible left sidebar: rebalance countdown, perf snapshot
│   │   └── primitives.jsx                # Shared small components: StatCard, DonutChart, FunnelBar, ComingSoon, pill()
│   ├── tabs/
│   │   ├── OverviewTab.jsx               # Tab 1: time-travel snapshot viewer, stat strip, funnel, donut, stock table
│   │   ├── PerformanceTab.jsx            # Tab 2: NAV chart, quarterly returns, risk metrics, trade log
│   │   ├── BuildTestTab.jsx              # Tab 3: custom backtest engine with filter sliders and sector toggles (FULLY BUILT)
│   │   └── ResourcesTab.jsx              # Tab 4: static educational content — metric explainers, sector thesis, FAQ
│   └── utils/
│       ├── strategy.js                   # CSV parsing, filter logic, buildPortfolio() algorithm, formatting helpers
│       └── backtest.js                   # Historical re-simulation engine for Build & Test tab (new — see Section 8)
├── data/
│   ├── fundamentals.csv                  # Current quarter: ticker, name, sector, roe, revCAGR, epsCAGR, pe
│   ├── betas.json                        # Current quarter: {ticker: beta_value}
│   ├── nav.json                          # Daily series: [{date, portfolio_nav, sensex_nav}], base 100, 500 entries (Jun 2024→Jun 2026)
│   ├── trade_log.json                    # All trades: entry/exit/return/alpha/exit_type per position
│   ├── performance_summary.json          # Full risk metrics: returns, Sharpe, Sortino, Treynor, Jensen Alpha, IR, drawdown, quarterly_returns
│   ├── portfolio_current.json            # Latest portfolio snapshot (convenience denormalised file)
│   ├── prices_history.json               # Historical daily prices for portfolio stocks + SENSEX (used by Python pipeline)
│   └── historical/
│       ├── betas_{label}.json            # Per-quarter beta snapshots (2024Q2 → 2026Q2)
│       ├── fundamentals_{label}.csv      # Per-quarter fundamentals (2024Q2 → 2026Q2)
│       ├── portfolio_{label}.json        # Per-quarter portfolio snapshots (2024Q2 → 2026Q2)
│       ├── daily_prices_{label}.json     # Per-quarter daily prices for portfolio stocks only (2024Q2 → 2026Q1; used by OverviewTab)
│       ├── universe_rebalance_prices.json # Full Nifty 500 universe prices at each of the 9 rebalance dates (used by backtest engine)
│       └── universe_daily_prices.json    # Full Nifty 500 daily prices across all quarters (large file; used by backtest engine)
├── fetch_betas.py
├── fetch_historical_betas.py
├── fetch_historical_fundamentals.py
├── fetch_historical_prices.py
├── build_portfolios_and_exits.py         # Core pipeline: screen → portfolio → trade log
├── build_historical_portfolios.py        # Batch backfill (one-time use, not part of regular cycle)
├── monitor_exits.py                      # Intra-quarter exit rule checker
├── compute_nav.py                        # Builds nav.json
└── compute_performance_metrics.py        # Builds performance_summary.json
```

---

## 5. src/config.js — the master constants file

Everything that controls the app's behaviour lives here. Never hardcode a threshold, URL, or sector name directly in a component — always reference `config.js` constants.

Key exports:
- `FILTERS` — the 5 filter thresholds: `{ roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 }`
- `SELECTED_SECTORS` — Set of 12 eligible sector strings
- `BASE` — raw.githubusercontent.com base URL
- `URLS` — all data file URLs the frontend fetches (fundamentals, betas, nav, perfSummary, tradeLog, portfolioCurrent, universeRebalancePrices, universeDailyPrices)
- `historicalFundamentalsUrl(label)` / `historicalBetasUrl(label)` — functions generating per-quarter URLs (used by backtest engine)
- `REBALANCE_LABELS` — array of 9 quarter labels: `["2024Q2","2024Q3",...,"2026Q2"]`
- `PORTFOLIO_SNAPSHOTS` — array of 9 objects `{label, year, month, file}` — drives the OverviewTab time-travel dropdown
- `REBALANCE_DATES` — Set of 9 ISO date strings (the 25th of Mar/Jun/Sep/Dec for each quarter)
- `TABS` — tab definitions for the nav bar
- `SECTOR_COLORS` — per-sector colour map
- `C` — all UI colour constants referencing CSS variables
- `LAST_REBALANCE` / `NEXT_REBALANCE` / `DATA_QUARTER` — current cycle metadata (update these each quarter)

---

## 6. The screening strategy — exact logic

Implemented **identically** in two places that must stay in sync:
- **Frontend (live Overview tab):** `src/utils/strategy.js → buildPortfolio()`
- **Backend (historical snapshots):** `build_portfolios_and_exits.py`

⚠️ **Sync warning:** two independent implementations in two languages. If strategy logic changes, both files need updating or they'll diverge.

### Universe
Nifty 500, fundamentals refreshed quarterly from Yahoo Finance.

### Sector restriction
Only these 12 sectors are eligible (defined in `SELECTED_SECTORS` in `config.js` and `build_portfolios_and_exits.py`):
Banks, Financial Services, Media Entertainment & Publication, Information Technology, Telecommunication, Capital Goods, Construction, Consumer Services, Chemicals, Oil Gas & Consumable Fuels, Power, Textiles.

### The 5 filters
| Filter | Threshold | Notes |
|---|---|---|
| Return on Equity | ≥ 13% | India cost-of-equity approximation |
| Revenue CAGR | ≥ 7% | Nominal GDP growth floor |
| EPS CAGR | ≥ 10% (base) | Relaxes — see cascade below |
| P/E ratio | ≤ 20x (base) | Relaxes — see cascade below |
| Beta vs Nifty 500, 3yr | ≤ 1.2 | Fixed, never relaxed |

### Relaxation cascade
Needs ≥6 stocks. If base filters don't yield enough, progressively relaxes EPS/P/E across 5 rounds:
```
Round 0 (base):        EPS CAGR ≥ 10%, P/E ≤ 20
Round 1 (pe_relaxed):  EPS CAGR ≥ 10%, P/E ≤ 25
Round 2:                EPS CAGR ≥ 9%,  P/E ≤ 25
Round 3:                EPS CAGR ≥ 8%,  P/E ≤ 25
Round 4:                EPS CAGR ≥ 7%,  P/E ≤ 25
```
RoE, Rev CAGR, Beta stay fixed. Stops at first round with ≥6 stocks, or terminates at round 4. Defined in `ROUNDS` (JS) / `RELAXATION_ROUNDS` (Python) — same five tuples, must stay identical.

### Sector cap
```
cap = min(3, max(1, floor(0.20 × count_of_stocks_in_sector_in_full_universe)))
```

### Ranking
Within each sector, ranked by **Growth/P/E Score** = `EPS CAGR / P/E` (higher = better), top `cap` stocks selected.

### Construction
Equal-weight. Quarterly rebalance on the 25th of Mar/Jun/Sep/Dec.

---

## 7. Data pipeline — execution order

Run manually by Rishu in this dependency order, then commit + push `data/` to GitHub:

```
1. fetch_betas.py                        → data/betas.json
2. build_portfolios_and_exits.py         → data/historical/portfolio_YYYYQN.json
                                          → data/trade_log.json
                                          → data/portfolio_current.json
3. monitor_exits.py                      → updates data/trade_log.json
   Exit rule: return > 20% from last rebalance entry AND live P/E > 20x (TTM EPS fixed
   at rebalance). Resets every rebalance — NOT measured from original entry. Already-logged
   exits are deduplicated on rerun. exit_type: "intra_quarter".
4. fetch_historical_prices.py            → data/prices_history.json
5. compute_nav.py                        → data/nav.json
   Daily NAV from ₹100 on 25 Jun 2024. Equal-weight at each rebalance.
   Intra-quarter exit proceeds earn 6% p.a. (CASH_RATE_ANNUAL) until next rebalance.
   SENSEX NAV computed in parallel.
6. compute_performance_metrics.py        → data/performance_summary.json
   Risk-free rate: 6% p.a. (RISK_FREE_RATE). Trading days: 252.
   Metrics: total/annualised return, alpha, Sharpe, Sortino, Treynor, beta, correlation,
   max drawdown, Jensen Alpha, Information Ratio, tracking error, win rate, quarterly returns.
7. git add data/ && git commit && git push
   → Vercel does NOT need a redeploy for data-only changes. Only code changes trigger a rebuild.
```

The **two large universe files** (`universe_rebalance_prices.json`, `universe_daily_prices.json`) are used only by the Build & Test tab's backtest engine. These need to be regenerated whenever a new historical quarter is added:
- `universe_rebalance_prices.json`: price of every Nifty 500 ticker at each of the 9 rebalance dates
- `universe_daily_prices.json`: daily prices for all Nifty 500 tickers across the full backtest window

---

## 8. Build & Test tab — the backtest engine (fully built)

**This tab is now fully functional** — it is no longer a stub. The architecture is:

### What it does
When a user adjusts a filter slider (e.g. P/E ≤ 20 → 25) or toggles a sector or adjusts the exit rule, the engine:
1. Rebuilds the portfolio at **each of the 9 historical rebalance dates** using that quarter's actual fundamentals + beta snapshot (the same files OverviewTab's time-travel uses) — point-in-time correct, not just refiltering today's universe.
2. Walks each position **day by day** using `universe_daily_prices.json`, checking the intra-quarter exit rule (exactly matching `monitor_exits.py` logic).
3. Produces a daily NAV series, quarterly portfolio snapshots, and a full trade log.
4. Computes the full set of risk metrics (matching `computeCustomMetrics` which mirrors `compute_performance_metrics.py`'s formulas).
5. Runs the same simulation on the **base strategy** in parallel to provide a direct comparison.

### Key implementation details in `src/utils/backtest.js`
- `loadBacktestData()` — fetches all 9 quarters of fundamentals/betas + the two universe price files. Call once; reuse the result across user slider changes.
- `runCustomBacktest(backtestData, filters, sectors, exitRule)` — the simulation engine. Returns `{ navSeries, quarterlyNavSeries, tradeLog, quarterlyPortfolios, dataGaps }`.
- `computeCustomMetrics(navSeries, quarterlyNavSeries)` — full risk metrics from the NAV series.
- `DEFAULT_EXIT_RULE = { returnPct: 20, peThreshold: 20 }` — mirrors `monitor_exits.py`'s `EXIT_RETURN_THRESHOLD` / `EXIT_PE_THRESHOLD`.
- Idle cash from intra-quarter exits earns 0% (not the risk-free rate) — matches live strategy. **This differs from `compute_nav.py`'s 6% cash rate** — the Python live pipeline does model idle cash yield; the JS backtest engine currently does not. This is a known inconsistency. Flag to Rishu before changing either side.
- Data gaps: if a ticker has no daily price series, it falls back to hold-to-rebalance using `universe_rebalance_prices.json` only. Gaps are tracked in `dataGaps`.
- TTM EPS is derived once at rebalance entry: `rebal_price / rebal_PE`, held fixed for the quarter. Live P/E = `daily_price / that fixed TTM EPS`.

### Filter bypass (checkbox pattern)
Each filter can be disabled via a checkbox. When disabled, the threshold is bypassed:
- Min thresholds (RoE, RevCAGR, EpsCAGR): threshold → -999
- Max thresholds (P/E, Beta): threshold → 9999

This is controlled by `enabledFilters` state; `effectiveFilters` is computed from `filters + enabledFilters` and passed to both the live funnel preview and the backtest engine.

### UI features
- Sliders with range/step for each of the 5 filters + 2 exit rule parameters, each with a disable checkbox
- Sector toggles (activate/deactivate any sector)
- Live funnel preview (updates as sliders move, before running)
- Run backtest button → NAV chart (custom vs base vs SENSEX) + metric comparison table + quarterly portfolio size grid (click any quarter to expand the full snapshot table) + full trade log table with sortable columns and open/closed/intra filter

---

## 9. Overview tab — time-travel and as-of-date metrics (recent changes)

### Time-travel snapshot viewer (now fully wired up)
The Year/Month dropdown + Apply button in the Overview tab is **fully functional**. Applying a historical quarter:
1. Fetches `data/historical/portfolio_{label}.json` — contains the pre-computed portfolio with `entry_price`, `rebal_price`, `latest_price` (last available close in the per-quarter price file), and all fundamentals.
2. Fetches `data/historical/fundamentals_{label}.csv` + `betas_{label}.json` for the selection funnel counts.
3. Fetches `data/historical/daily_prices_{label}.json` to compute `latest_price` per stock.

### As-of-date performance metrics (recent change)
The three stat cards (Live Total Return, Alpha, Sharpe) previously used full-period `performance_summary.json` values regardless of which snapshot was being viewed. They now compute **inception-to-filter-date** metrics from `nav.json` sliced up to the selected snapshot's rebalance date.

Logic lives in `computeAsOfMetrics(navSeries, asOfDate)` in `OverviewTab.jsx`:
- Slices `nav.json` up to and including `asOfDate`
- Computes total return, annualised return, SENSEX return, alpha, and Sharpe over that window
- Uses the **same formulas** as `compute_performance_metrics.py`: 6% risk-free rate, 252 trading days, `sqrt(252)` annualisation
- Falls back to full-period `perf` values if `nav.json` hasn't loaded yet

The stat card subtitle now shows the actual as-of date: e.g. "Since 25 Jun 2024 - to 2025-06-25".

### Entry Price and Live Return columns (recent change)
The stock table now includes two new columns:
- **Entry Price**: the `entry_price` field from the snapshot JSON — the price when the stock originally entered the portfolio (which could be quarters before the snapshot being viewed). Not the rebalance price.
- **Live Return**: `(latest_price - entry_price) / entry_price` — unrealized P&L from original purchase to the most recent available close. Color-coded green/red. Sortable.
- For historical snapshots, `latest_price` = last price in that quarter's `daily_prices_{label}.json` file — not today's live price. For today's true live price on a historical snapshot, a separate fetch of current prices would be needed (not currently implemented).

---

## 10. Known issues and incomplete items

**Potentially resolved:**
- ~~OverviewTab time-travel dropdowns were non-functional~~ — Fixed. Fully wired up.
- ~~BuildTestTab was a "Coming Soon" stub~~ — Fixed. Fully built.

**Remaining known issues:**

- **`data/historical/daily_prices_2026Q2.json` may be missing** — the `data/historical/` listing only shows up to `daily_prices_2026Q1.json`. The current (Jun 2026) quarter's per-portfolio daily prices file may not exist yet. OverviewTab's snapshot for Jun 2026 will show `latest_price` as undefined for those stocks, making Live Return show "-".

- **Idle cash rate inconsistency:** `compute_nav.py` models intra-quarter exit proceeds earning 6% p.a. until the next rebalance. `backtest.js` currently models 0% idle cash rate. This means the custom backtest NAV will be slightly lower than the Python-computed NAV even for the exact base strategy parameters. Flag to Rishu before changing either side.

- **`root utils.js` (if present):** There may be a legacy `utils.js` at the repo root (separate from `src/utils/strategy.js`). Verify before editing or relying on it.

- **No tests, no TypeScript, no linting config.**

---

## 11. Conventions to preserve

- **Inline styles only.** Always use `C.*` color constants from `config.js`, never raw hex.
- **No new dependencies** without good reason. Runtime deps are `papaparse`, `react`, `react-dom`, `recharts` only.
- **All thresholds, URLs, sector lists, and color mappings in `src/config.js`** — never hardcode in components.
- **Python scripts are offline batch tools** — do not wrap in Flask/FastAPI or deploy as APIs unless explicitly asked.
- **Dense, terse code style.** Match existing pattern (ternaries, arrow functions, minimal verbosity). Don't reformat existing files.
- **Dark theme only.** All CSS variables in `index.html → <style>`. No light mode.
- **JetBrains Mono for numbers/tickers** (`var(--font-mono)`), Inter for everything else. Consistent throughout.
- **JS/Python strategy logic must stay in sync.** If a filter threshold or relaxation cascade changes, update both `src/utils/strategy.js` and `build_portfolios_and_exits.py`.

---

## 12. Context for AI platforms

Rishu builds entirely through AI coding assistants and switches between platforms due to rate limits — which is why this document exists. When making changes:
- Provide **complete, runnable files** not partial diffs — Rishu can't debug a half-finished change.
- When a change affects both Python pipeline and frontend, call out **both files** that need updating.
- If a request needs a backend, real-time data API, or auth, **flag it explicitly** as an architecture change before building.
- Output file: hand back the edited file(s) via download/present, not just inline code blocks, so Rishu can directly paste into GitHub.

Background: Rishu has an MBA from IIM Bangalore (finance focus), prior Deutsche Bank investment banking and Navi Finserv debt capital markets experience, and uses this project as a portfolio piece in an active job search (alongside planned SSRN/Substack quant writing). Polish, correctness of the live numbers, and credibility of the Build & Test tab are high-priority.

---

## 13. Quick start for a fresh AI platform session

```bash
# Frontend
npm install
npm run dev          # fetches live data from GitHub raw URLs
npm run build        # production build (what Vercel runs)

# Python pipeline (run in order per Section 7)
pip install requests pandas
python fetch_betas.py
python build_portfolios_and_exits.py
python monitor_exits.py
python fetch_historical_prices.py
python compute_nav.py
python compute_performance_metrics.py
```

No `.env` or secrets required. Yahoo Finance endpoints are unauthenticated. Frontend reads public GitHub raw URLs.
