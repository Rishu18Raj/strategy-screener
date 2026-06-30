# Strategy Screener - Architecture Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB REPOSITORY                                    │
│                         (Database + Source Code)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                          data/ (THE DATABASE)                              │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ fundamentals.csv     - Current quarter stock fundamentals           │   │  │
│  │  │ betas.json           - Current quarter beta values                  │   │  │
│  │  │ nav.json             - Daily NAV series (portfolio + SENSEX)        │   │  │
│  │  │ trade_log.json       - Complete trade history                       │   │  │
│  │  │ performance_summary.json - Computed risk/return metrics             │   │  │
│  │  │ portfolio_current.json - Latest portfolio snapshot                   │   │  │
│  │  │ prices_history.json   - Historical price data                      │   │  │
│  │  │ historical/          - Quarterly snapshots (2024Q2 → 2026Q2)        │   │  │
│  │  │   ├── fundamentals_YYYYQN.csv                                       │   │  │
│  │  │   ├── betas_YYYYQN.json                                             │   │  │
│  │  │   ├── daily_prices_YYYYQN.json                                      │   │  │
│  │  │   └── portfolio_YYYYQN.json                                         │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                       src/ (Frontend Code)                                │  │
│  │  App.jsx           - Main app layout, data fetching, tab routing        │  │
│  │  config.js         - ALL constants (filters, sectors, URLs, colors)       │  │
│  │  components/       - Sidebar.jsx, primitives.jsx                         │  │
│  │  tabs/             - OverviewTab, PerformanceTab, BuildTestTab, Resources│  │
│  │  utils/            - strategy.js (screening logic), backtest.js          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                   *.py Scripts (Data Pipeline)                            │  │
│  │  fetch_betas.py                    - Fetch current betas from Yahoo       │  │
│  │  fetch_historical_betas.py         - Fetch historical betas              │  │
│  │  fetch_historical_fundamentals.py  - Fetch historical fundamentals       │  │
│  │  fetch_historical_prices.py        - Fetch daily price history           │  │
│  │  build_portfolios_and_exits.py     - CORE: Build portfolios, log trades  │  │
│  │  build_historical_portfolios.py    - Batch build historical snapshots    │  │
│  │  monitor_exits.py                  - Check intra-quarter exit rules       │  │
│  │  compute_nav.py                    - Compute daily NAV series             │  │
│  │  compute_performance_metrics.py    - Compute Sharpe, alpha, etc.          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ git push
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              VERCEL (Hosting)                                   │
│                         Static React SPA Build                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  https://strategy-screener.vercel.app                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ User visits
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                         React Frontend (SPA)                              │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ App.jsx                                                            │   │  │
│  │  │  ├─ useEffect: fetch fundamentals.csv → parseCSV()                │   │  │
│  │  │  ├─ useEffect: fetch betas.json → merge with stocks               │   │  │
│  │  │  └─ useEffect: fetch perfSummary, nav, tradeLog                   │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ OverviewTab.jsx                                                    │   │  │
│  │  │  ├─ buildPortfolio() - Client-side screening logic                 │   │  │
│  │  │  ├─ Selection funnel visualization (fp → sp → bp → final)          │   │  │
│  │  │  ├─ Sector allocation donut chart                                 │   │  │
│  │  │  └─ Sortable stock table with metrics                             │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ PerformanceTab.jsx                                                 │   │  │
│  │  │  ├─ NAV chart (portfolio vs SENSEX) - Recharts LineChart          │   │  │
│  │  │  ├─ Quarterly returns bar chart                                    │   │  │
│  │  │  ├─ Risk metrics panel (Sharpe, Sortino, Treynor, Alpha, etc.)     │   │  │
│  │  │  └─ Trade log table (sortable, filterable)                         │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ BuildTestTab.jsx (STUB - Coming Soon)                            │   │  │
│  │  │  └─ Placeholder for interactive filter testing                     │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ ResourcesTab.jsx                                                   │   │  │
│  │  │  ├─ Metric explainers (flip cards)                                  │   │  │
│  │  │  ├─ Sector thesis cards                                             │   │  │
│  │  │  └─ FAQ accordion                                                   │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                            │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ Sidebar.jsx                                                        │   │  │
│  │  │  ├─ Rebalance countdown timer                                      │   │  │
│  │  │  └─ Performance snapshot (total return, Sharpe, etc.)              │   │  │
│  │  └────────────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  All data fetched via: raw.githubusercontent.com/Rishu18Raj/strategy-screener  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Data Pipeline Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    LOCAL MACHINE (Rishu runs manually)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. fetch_betas.py                                                              │
│     ├─ Query Yahoo Finance: query1.finance.yahoo.com/v8/finance/chart/{symbol} │
│     ├─ Compute 3-year beta vs Nifty 500 (^CRSLDX)                               │
│     └─ Output: data/betas.json                                                 │
│                                                                                 │
│  2. build_portfolios_and_exits.py (CORE PIPELINE)                               │
│     ├─ Load fundamentals.csv + betas.json                                       │
│     ├─ For each rebalance date (quarterly):                                      │
│     │   ├─ Apply 5-filter screen (RoE ≥13%, Rev CAGR ≥7%, EPS CAGR ≥10%,         │
│     │   │   P/E ≤20x, Beta ≤1.2)                                                │
│     │   ├─ Relaxation cascade (5 rounds if <6 stocks)                           │
│     │   ├─ Sector cap (max 3 per sector, min 1 if eligible)                    │
│     │   ├─ Rank by Growth/P/E Score = EPS CAGR / P/E                            │
│     │   ├─ Build equal-weight portfolio                                         │
│     │   ├─ Diff vs previous portfolio (log rebalance exits)                     │
│     │   └─ Run monitor_exits.py for intra-quarter period                        │
│     ├─ Output: data/historical/portfolio_YYYYQN.json (per quarter)              │
│     ├─ Output: data/trade_log.json (updated)                                    │
│     └─ Output: data/portfolio_current.json                                      │
│                                                                                 │
│  3. monitor_exits.py                                                             │
│     ├─ Exit rule: return >20% from rebal_price AND P/E >20x                      │
│     ├─ Check daily prices since last rebalance                                  │
│     ├─ Deduplicate already-logged exits                                         │
│     └─ Output: data/trade_log.json (updated with intra_quarter exits)            │
│                                                                                 │
│  4. fetch_historical_prices.py                                                  │
│     ├─ Pull EOD prices for all stocks ever in portfolio + SENSEX                │
│     ├─ From first rebalance date to today                                      │
│     └─ Output: data/prices_history.json                                         │
│                                                                                 │
│  5. compute_nav.py                                                               │
│     ├─ Read trade_log.json + prices_history.json                                │
│     ├─ Compute daily portfolio NAV (base ₹100)                                  │
│     ├─ Equal weight at rebalance, 6% p.a. on idle cash                          │
│     ├─ Compute SENSEX NAV in parallel                                           │
│     └─ Output: data/nav.json                                                   │
│                                                                                 │
│  6. compute_performance_metrics.py                                              │
│     ├─ Read nav.json + trade_log.json                                          │
│     ├─ Compute: total/annualized return, alpha, Sharpe, Sortino,                │
│     │   Treynor, beta, correlation, max drawdown, Jensen Alpha,                │
│     │   Information Ratio, tracking error, win rate, quarterly returns         │
│     ├─ Risk-free rate: 6% p.a., 252 trading days                               │
│     └─ Output: data/performance_summary.json                                   │
│                                                                                 │
│  7. git add data/ && git commit && git push                                     │
│     └─ Triggers Vercel rebuild (only if code changed, not data)                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Screening Strategy Logic (Implemented in BOTH JS and Python)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SCREENING ALGORITHM                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  INPUT: Nifty 500 universe (fundamentals.csv + betas.json)                      │
│                                                                                 │
│  STEP 1: SECTOR FILTER                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ SELECTED_SECTORS (12 sectors):                                            │   │
│  │ Banks, Financial Services, Media Entertainment & Publication,            │   │
│  │ Information Technology, Telecommunication, Capital Goods,               │   │
│  │ Construction, Consumer Services, Chemicals,                              │   │
│  │ Oil Gas & Consumable Fuels, Power, Textiles                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  STEP 2: 5-FILTER SCREEN (Base thresholds)                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ • Return on Equity (RoE)        ≥ 13%                                    │   │
│  │ • Revenue CAGR                  ≥ 7%                                     │   │
│  │ • EPS CAGR                      ≥ 10%                                    │   │
│  │ • P/E ratio                     ≤ 20x                                    │   │
│  │ • Beta (vs Nifty 500, 3yr)      ≤ 1.2                                    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  STEP 3: RELAXATION CASCADE (if <6 stocks after sector cap)                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Round 0 (base):        EPS CAGR ≥ 10%, P/E ≤ 20                          │   │
│  │ Round 1 (pe_relaxed):  EPS CAGR ≥ 10%, P/E ≤ 25                          │   │
│  │ Round 2:                EPS CAGR ≥ 9%,  P/E ≤ 25                          │   │
│  │ Round 3:                EPS CAGR ≥ 8%,  P/E ≤ 25                          │   │
│  │ Round 4:                EPS CAGR ≥ 7%,  P/E ≤ 25                          │   │
│  │ (Stops at first round with ≥6 stocks, or round 4 regardless)              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  STEP 4: SECTOR CAP                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ cap = min(3, max(1, floor(0.20 × sector_universe_count)))                 │   │
│  │ • Max 3 stocks per sector                                                │   │
│  │ • Min 1 stock if sector has any qualifying stock                         │   │
│  │ • Otherwise ~20% of sector's universe size                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  STEP 5: RANKING WITHIN SECTOR                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Growth/P/E Score = EPS CAGR / P/E (higher is better)                     │   │
│  │ Select top 'cap' stocks per sector by this score                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  OUTPUT: Equal-weight portfolio (rebalanced quarterly: Mar 25, Jun 25,           │
│          Sep 25, Dec 25)                                                        │
│                                                                                 │
│  ⚠️ CRITICAL: Logic implemented in TWO places (must stay in sync):              │
│     • Frontend:  src/utils/strategy.js → buildPortfolio()                      │
│     • Backend:   build_portfolios_and_exits.py                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Component Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        COMPONENT DATA DEPENDENCIES                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  App.jsx (Root)                                                                 │
│  ├─ Fetches: fundamentals.csv, betas.json, performance_summary.json            │
│  ├─ Fetches: nav.json, trade_log.json                                           │
│  ├─ Parses: CSV → stock objects (via parseCSV)                                  │
│  ├─ Merges: beta data into stock objects                                       │
│  └─ Passes to: OverviewTab (stocks, betaStatus, perf)                           │
│               PerformanceTab (perf, nav, trades)                                │
│               Sidebar (perf)                                                     │
│                                                                                 │
│  OverviewTab.jsx                                                                │
│  ├─ Uses: stocks[] (from App)                                                  │
│  ├─ Calls: buildPortfolio() → {portfolio, fp, sp, bp, roundUsed}               │
│  ├─ Computes: sector allocation, funnel metrics                                │
│  ├─ Renders: FunnelBar, DonutChart, sortable table                              │
│  └─ Optional: Fetches historical portfolio snapshots (time machine - NOT WIRED) │
│                                                                                 │
│  PerformanceTab.jsx                                                             │
│  ├─ Uses: perf (performance_summary.json), nav (nav.json), trades (trade_log)    │
│  ├─ Renders: NAV chart (Recharts), quarterly returns bar chart                  │
│  ├─ Displays: Risk metrics panel, trade log table                              │
│  └─ All data pre-computed by Python pipeline                                    │
│                                                                                 │
│  ResourcesTab.jsx                                                               │
│  ├─ Uses: No external data (static content)                                     │
│  ├─ Renders: Metric explainers, sector thesis cards, FAQ                       │
│  └─ Safe to edit without touching pipeline                                     │
│                                                                                 │
│  BuildTestTab.jsx (STUB)                                                        │
│  ├─ Currently: ComingSoon placeholder                                          │
│  ├─ Planned: Interactive filter sliders, backtest engine                        │
│  └─ Would use: src/utils/backtest.js, historical data snapshots                 │
│                                                                                 │
│  Sidebar.jsx                                                                    │
│  ├─ Uses: perf (performance_summary.json)                                      │
│  ├─ Computes: Days until next rebalance (NEXT_REBALANCE - today)               │
│  └─ Displays: Countdown, performance snapshot                                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Key Technical Details

### Frontend Stack
- **Framework:** React 18 (functional components, hooks only)
- **Build Tool:** Vite 5
- **Charts:** Recharts 3.9
- **CSV Parsing:** PapaParse 5.5
- **Styling:** Inline styles only (no CSS framework/Tailwind)
- **Colors:** CSS custom properties in index.html → exported as C object in config.js
- **Fonts:** Inter (UI text), JetBrains Mono (numbers/tickers)
- **Deployment:** Vercel (static build)

### Backend Pipeline
- **Language:** Python 3
- **Dependencies:** requests, pandas (only in build_portfolios_and_exits.py)
- **Data Source:** Yahoo Finance (unofficial endpoints, no API key)
- **Retry Logic:** Exponential backoff for rate limits
- **Execution:** Manual (no CI/CD automation)

### Data Layer
- **Storage:** GitHub repository (raw.githubusercontent.com)
- **Format:** JSON (structured data), CSV (fundamentals)
- **Update Frequency:** Quarterly (manual pipeline run)
- **No Database:** No SQL/NoSQL, no backend server

### Synchronization Points
- **Strategy Logic:** Must update BOTH src/utils/strategy.js AND build_portfolios_and_exits.py
- **Config Constants:** All thresholds in src/config.js (frontend) and Python scripts (backend)
- **Rebalance Dates:** Defined in config.js and Python scripts

### Known Issues
- **Time Machine:** OverviewTab dropdowns don't actually fetch historical portfolios
- **BuildTestTab:** Entirely stub/placeholder
- **utils.js (root):** May be leftover/duplicate of src/utils/strategy.js
