# Fundamental Screener — Project Context & Build Guide

**Live app:** https://strategy-screener.vercel.app
**Repo:** https://github.com/Rishu18Raj/strategy-screener (branch: `main`)
**Owner:** Rishu — non-coder, building entirely through AI coding platforms (Claude, Cursor, v0, Replit, etc.), switching between them due to rate limits.

> **Instructions for the AI platform reading this file:** This document is the single source of truth for the project. It describes a fully working, deployed application — do not propose rebuilding it from scratch or restructuring the architecture unless explicitly asked. Read this entire file before making any change. Treat it as onboarding documentation for a codebase you've just inherited.

---

## 1. What this project is

A rules-based, quantitative equity screening and portfolio-tracking web app for Indian (NSE) stocks. It applies five fundamental/risk filters to the Nifty 500 universe, constructs an equal-weight portfolio concentrated in 12 sectors with structural tailwinds, rebalances quarterly, and tracks live performance against the SENSEX — Sharpe, Sortino, Treynor, Jensen Alpha, Information Ratio, drawdown, win rate, full trade log.

Originally built as a group assignment at IIM Bangalore for a Financial Markets course, then productised into a public-facing tool. Backtest: 393% total return vs. 93% SENSEX over 5 years, Sharpe 1.53 (these numbers live in the UI copy and should stay consistent with whatever `performance_summary.json` actually outputs).

**Audience:** retail/hobby investors who want an institutional-grade, transparent screening process they can replicate manually (the app is not a brokerage — users self-execute trades based on what the table shows).

---

## 2. Architecture (the most important section — read this first)

This is a **serverless, no-backend** app. There is no API server and no database. Instead:

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   Python pipeline        │         │   React/Vite frontend     │
│   (run manually/locally  │  push   │   (deployed on Vercel)    │
│   or via scheduled job)  │ ──────► │                            │
│                           │  to     │   fetch()s JSON/CSV files  │
│   Fetches Yahoo Finance   │  GitHub │   directly from            │
│   data, computes the      │  repo   │   raw.githubusercontent.com│
│   portfolio, NAV, and     │         │   at runtime               │
│   performance metrics     │         │                            │
└─────────────────────────┘         └──────────────────────────┘
```

- **GitHub is the database.** All computed data (`data/*.json`, `data/*.csv`) lives in the repo. The frontend fetches these files live from `raw.githubusercontent.com` — see `src/config.js` → `BASE` and `URLS`. There is no Express/Flask/FastAPI server anywhere in this project, and **none should be introduced** unless explicitly requested.
- **The Python scripts are offline/batch tools.** They are not deployed; they're run on demand (by Rishu, locally) to refresh data, then the output JSON/CSV files are committed and pushed to GitHub. Once pushed, the live frontend picks them up automatically on next page load (no rebuild needed for data changes — only for code changes).
- **The frontend is a static SPA.** Vite + React, deployed to Vercel. `npm run build` produces a static bundle; Vercel serves it. No server-side rendering, no API routes.
- **Data source for the pipeline:** Yahoo Finance, queried directly via unofficial endpoints (`query1.finance.yahoo.com/v8/finance/chart/{symbol}`), not an official paid API. This means the pipeline scripts are somewhat fragile to Yahoo's rate limits/format changes — they already include retry logic with exponential backoff (see `requests.adapters.HTTPAdapter` + `urllib3.util.retry.Retry` usage in `fetch_historical_prices.py` and `monitor_exits.py`).

**Implication for any future work:** if you're asked to "add a feature," first figure out whether it's (a) a frontend-only change reading existing data, (b) a new Python computation whose output needs to be added to `data/` and `src/config.js → URLS`, or (c) something that would require an actual backend (e.g., real-time intraday data, user accounts, live order execution) — option (c) is a major architecture change and should be flagged explicitly before building, not built silently.

---

## 3. Tech stack

| Layer | Tech |
|---|---|
| Frontend framework | React 18 (functional components, hooks only — no class components) |
| Build tool | Vite 5 |
| Charts | Recharts 3.9 (`LineChart`, `BarChart`) |
| CSV parsing | PapaParse 5.5 |
| Styling | **Inline styles only** — no CSS framework, no Tailwind, no styled-components. All colors reference CSS custom properties defined in `index.html` (`:root` block) and re-exported as JS constants via `src/config.js` → `C` object (e.g. `C.bg`, `C.accent`, `C.green`). **Always use the `C` object for colors, never hardcode hex values in components**, to keep the dark theme consistent. |
| Fonts | Inter (UI text), JetBrains Mono (numbers/tickers — see `var(--font-mono)`) |
| Data pipeline | Python 3, `requests`, `pandas` (only in `build_portfolios_and_exits.py`), stdlib `json`/`math`/`datetime` elsewhere — deliberately lightweight, no numpy/scipy dependency |
| Data layer | Static JSON/CSV files in `data/`, served via GitHub raw URLs |
| Hosting | Vercel (frontend), GitHub (data + source) |

No TypeScript — the whole frontend is `.jsx`/`.js`. No test suite currently exists.

---

## 4. Repository structure

```
strategy-screener/
├── index.html                       # Vite entry point; ALL CSS variables/theme defined here in <style>
├── vite.config.js                   # Minimal — just the React plugin
├── package.json
├── src/
│   ├── main.jsx                     # ReactDOM root render
│   ├── App.jsx                      # Top-level layout: header, tab switcher, sidebar, data fetching (useEffect hooks)
│   ├── config.js                    # ALL constants: filter thresholds, sector lists, URLs, colors, tab definitions, rebalance dates
│   ├── components/
│   │   ├── Sidebar.jsx              # Collapsible left sidebar — rebalance countdown, perf snapshot
│   │   └── primitives.jsx           # Shared small components: StatCard, DonutChart, FunnelBar, ComingSoon, pill()
│   ├── tabs/
│   │   ├── OverviewTab.jsx          # Tab 1: current portfolio, selection funnel, sector allocation donut, sortable stock table
│   │   ├── PerformanceTab.jsx       # Tab 2: NAV chart vs SENSEX, quarterly returns bar chart, risk metrics, trade log
│   │   ├── BuildTestTab.jsx         # Tab 3: STUB ONLY — "Coming Soon" placeholder (see Section 7)
│   │   └── ResourcesTab.jsx         # Tab 4: educational content — metric explainers, sector thesis cards, FAQ (static copy, no data fetching)
│   └── utils/
│       └── strategy.js              # CSV parsing, filter logic, portfolio construction algorithm (buildPortfolio), formatting helpers
├── data/                             # ← THE "DATABASE". Frontend fetches these via raw.githubusercontent.com
│   ├── fundamentals.csv              # Current quarter: ticker, name, sector, roe, revCAGR, epsCAGR, pe
│   ├── betas.json                    # Current quarter: {ticker: beta_value}
│   ├── nav.json                      # Daily series: [{date, portfolio_nav, sensex_nav}], base ₹100
│   ├── trade_log.json                # All trades ever (rebalance + intra-quarter exits), with entry/exit/return/alpha
│   ├── performance_summary.json      # Computed metrics: returns, risk, trade stats, quarterly_returns array
│   ├── portfolio_current.json        # Latest portfolio snapshot (denormalized convenience file)
│   └── historical/                   # One snapshot per quarter since 2024 Q2:
│       ├── betas_YYYYQN.json
│       ├── fundamentals_YYYYQN.csv
│       ├── daily_prices_YYYYQN.json
│       └── portfolio_YYYYQN.json
├── fetch_betas.py                    # Pulls current beta for each ticker vs Nifty 500 (^CRSLDX), 3yr lookback
├── fetch_historical_betas.py         # Same, but per historical quarter
├── fetch_historical_fundamentals.py  # Pulls fundamentals.csv equivalents for past quarters
├── fetch_historical_prices.py        # Pulls daily EOD prices for every stock that's EVER been in the portfolio, + SENSEX
├── build_portfolios_and_exits.py     # THE CORE PIPELINE SCRIPT — see Section 6
├── build_historical_portfolios.py    # Batch-builds all historical quarterly snapshots (used once to backfill 2024Q2→present)
├── monitor_exits.py                  # Intra-quarter exit rule checker (20% gain + P/E > 20x trigger)
├── compute_nav.py                    # Builds the daily NAV series (data/nav.json) from trade log + price history
├── compute_performance_metrics.py    # Computes Sharpe/Sortino/Treynor/alpha/etc. from nav.json + trade_log.json
└── utils.js                          # (root-level — check before using; may be a leftover/duplicate of src/utils/strategy.js, verify before editing)
```

---

## 5. The screening strategy — exact logic

This is the core IP of the project. Get this right; it's implemented **identically** in two places that must stay in sync:
- Frontend (client-side, for the live "Overview" tab): `src/utils/strategy.js` → `buildPortfolio()`
- Backend (for historical/backtested snapshots): `build_portfolios_and_exits.py`

**⚠️ Sync warning:** these are two independent implementations of the same algorithm in two languages. If the strategy logic ever changes, both files need to be updated together, or the live "Overview" tab (JS) will disagree with the historical backtest (Python).

### Universe
Nifty 500 stocks, fundamentals refreshed quarterly from Yahoo Finance.

### Sector restriction
Only these 12 sectors are eligible (defined in `SELECTED_SECTORS` in both `src/config.js` and `build_portfolios_and_exits.py`):
Banks, Financial Services, Media Entertainment & Publication, Information Technology, Telecommunication, Capital Goods, Construction, Consumer Services, Chemicals, Oil Gas & Consumable Fuels, Power, Textiles.

Excluded sectors and the rationale (documented in the Resources tab, useful context for any future sector-thesis edits): Healthcare/Pharma (too expensive — P/E routinely above 20x), FMCG (mature/low-growth/structurally high P/E), Automobiles (cyclical, EV disruption risk), Metals & Mining (commodity-driven, unreliable fundamentals), Realty (lumpy revenue recognition), Consumer Durables (elevated valuations), Diversified/Others (no consistent thesis).

### The 5 filters
| Filter | Threshold | Rationale (for context, also shown in-app) |
|---|---|---|
| Return on Equity | ≥ 13% | Approximates India's cost of equity / hurdle rate |
| Revenue CAGR | ≥ 7% | Approximates India's nominal GDP growth — floor for "keeping pace with the economy" |
| EPS CAGR | ≥ 10% (base case — relaxes, see below) | Ensures profit growth, not just revenue growth |
| P/E ratio | ≤ 20x (base case — relaxes, see below) | Valuation discipline — avoid overpaying even for quality |
| Beta (vs Nifty 500, 3yr) | ≤ 1.2 | Keeps overall portfolio risk close to market-level |

### Relaxation cascade (critical implementation detail)
The portfolio needs at least 6 stocks to be valid. If the base filters (EPS CAGR ≥10%, P/E ≤20x) don't yield ≥6 stocks after sector capping, the screen progressively relaxes EPS/P/E thresholds in 5 rounds:

```
Round 0 (base):        EPS CAGR ≥ 10%, P/E ≤ 20
Round 1 (pe_relaxed):  EPS CAGR ≥ 10%, P/E ≤ 25
Round 2:                EPS CAGR ≥ 9%,  P/E ≤ 25
Round 3:                EPS CAGR ≥ 8%,  P/E ≤ 25
Round 4:                EPS CAGR ≥ 7%,  P/E ≤ 25
```
RoE, Rev CAGR, and Beta thresholds stay fixed across all rounds. The cascade stops at the first round producing ≥6 stocks, or terminates at round 4 regardless. This logic is in `ROUNDS` (JS) / `RELAXATION_ROUNDS` (Python) — same five tuples, same order, must stay identical.

### Sector cap
Within the sector-restricted, beta-filtered pool, each sector is capped at:
```
cap = min(3, max(1, floor(0.20 × count_of_stocks_in_that_sector_in_the_full_universe)))
```
i.e., never more than 3 stocks per sector, never zero if the sector has any qualifying stock, otherwise ~20% of the sector's universe size.

### Ranking within sector
Stocks within each sector are ranked by **Growth/P/E Score** = `EPS CAGR / P/E` (higher is better — most earnings growth per rupee of valuation paid), and the top `cap` stocks per sector are selected.

### Construction
**Equal-weight** across all selected stocks. Rebalanced quarterly on fixed dates: 25 Mar, 25 Jun, 25 Sep, 25 Dec (see `REBALANCE_DATES` / `LAST_REBALANCE` / `NEXT_REBALANCE` in `src/config.js`).

---

## 6. Data pipeline — execution order

The Python scripts are **not** automated (no CI/cron currently wired up) — Rishu runs them manually, in this dependency order, then commits/pushes the updated `data/` files:

```
1. fetch_betas.py                      → data/betas.json
   (and/or fetch_historical_fundamentals.py + fetch_historical_betas.py
    for backfilling historical quarters)

2. build_portfolios_and_exits.py       → data/historical/portfolio_YYYYQN.json (new quarter)
                                        → data/trade_log.json (updated)
                                        → data/portfolio_current.json
   - Builds the new quarter's portfolio using the screening logic above
   - Diffs against the previous quarter's portfolio: carries forward entry
     price/date for held stocks, logs rebalance exits for dropped stocks
   - Also runs the intra-quarter exit monitor (see below) for the period
     since the last rebalance

3. monitor_exits.py                    → updates data/trade_log.json
   - Exit rule: triggers when price return > 20% from the LAST rebalance
     entry price AND live P/E > 20x (TTM EPS fixed at last rebalance)
   - This baseline resets every rebalance — NOT measured from original
     entry price, only from most recent rebalance price (this was a fixed
     bug per the script's own header comments — preserve this behavior)
   - Deduplicates on rerun — already-logged intra-quarter exits are skipped
   - Marks exits as exit_type: "intra_quarter" so the rebalance script
     doesn't double-count them

4. fetch_historical_prices.py          → data/prices_history.json
   - Pulls daily EOD prices for every stock that has EVER appeared in any
     portfolio, plus SENSEX (^BSESN), from first rebalance date to today

5. compute_nav.py                      → data/nav.json
   - Daily NAV series starting at ₹100 on first rebalance date (25 Jun 2024)
   - Equal weight at each rebalance; intra-quarter exit proceeds earn
     6% p.a. (CASH_RATE_ANNUAL) until next rebalance: this is the
     "idle cash" assumption — flag to Rishu before changing this rate
   - SENSEX NAV computed in parallel as the benchmark

6. compute_performance_metrics.py      → data/performance_summary.json
   - Reads nav.json + trade_log.json
   - Computes: total/annualised return, alpha vs SENSEX, Sharpe, Sortino,
     Treynor, beta, correlation, max drawdown, Jensen Alpha, Information
     Ratio, tracking error, win rate, avg return/winner/loser, best/worst
     trade, quarterly returns breakdown
   - Risk-free rate hardcoded at 6% p.a. (RISK_FREE_RATE), 252 trading days

7. (manual) git add data/ && git commit && git push
   → Vercel does NOT need a redeploy for data-only changes — frontend
     fetches data/ files live from raw.githubusercontent.com at runtime.
     Only push code changes (src/, index.html, etc.) trigger a Vercel
     rebuild via its GitHub integration.
```

`build_historical_portfolios.py` is a separate batch script that was used once to backfill all 9 historical quarterly snapshots (2024 Q2 → 2026 Q2) — not part of the regular quarterly cycle, but useful as a reference for the algorithm and for any future "rebuild full history from scratch" need.

---

## 7. Current state — what works, what's incomplete, known issues

**Fully functional:**
- Overview tab: live portfolio table, selection funnel, sector allocation donut — all driven by real-time fetches of `fundamentals.csv` + `betas.json` and the in-browser `buildPortfolio()` algorithm.
- Performance tab: NAV chart vs SENSEX, quarterly returns bar chart, full risk metrics panel, sortable/filterable trade log — all driven by `performance_summary.json`, `nav.json`, `trade_log.json`.
- Resources tab: fully static educational content (metric explainers as flip cards, sector thesis cards, FAQ accordion). No data dependency — safe to edit copy here without touching the pipeline.
- Sidebar: rebalance countdown, condensed perf snapshot.

**Known incomplete / stub:**
- **`BuildTestTab.jsx` ("Build & Test" tab) is entirely a placeholder** (`ComingSoon` component, no logic). The intended feature per its own description text: interactive sliders to adjust the 5 filter thresholds live, sector inclusion/exclusion toggles, real-time funnel recalculation, and a "your custom screen vs. base strategy" comparison. This is the most likely "what should I build next" answer if Rishu doesn't specify otherwise — the screening logic to reuse already exists in `src/utils/strategy.js`.

**Known bug (UI, not yet wired up):**
- **`OverviewTab.jsx` has a non-functional "time machine"**: there are Year/Month `<select>` dropdowns (`selectedYear`, `selectedMonth` state) labeled "Viewing Portfolio Snapshot As Of," but changing them does **not** actually change which portfolio is displayed — the underlying `buildPortfolio(stocks)` call always uses the live current `stocks` data regardless of the dropdown selection. The UI implies historical time-travel through `PORTFOLIO_SNAPSHOTS` (defined in `config.js`, listing the 9 historical snapshot files) but this data is never actually fetched or used to filter the displayed table. **Fix would involve:** when `selectedYear`/`selectedMonth` ≠ current quarter, fetch the corresponding `data/historical/portfolio_YYYYQN.json` (via `PORTFOLIO_SNAPSHOTS` lookup) instead of recomputing from live `stocks`.

**Root-level `utils.js`:** there's a file at the repo root (`utils.js`, separate from `src/utils/strategy.js`) — verify its contents and whether it's still used or a leftover before relying on or editing it.

**No tests, no TypeScript, no linting config currently set up.** No CI/CD beyond Vercel's default GitHub-push-triggers-build behavior.

---

## 8. Conventions to preserve when extending this codebase

- **Inline styles, not CSS classes/Tailwind/styled-components.** Match the existing pattern (style objects inline on JSX elements), and always reference `C.*` color constants from `config.js`, never raw hex.
- **Dense, compact code style.** The existing code favors terse one-liners (ternaries, arrow functions, minimal whitespace) over verbose multi-line formatting. Match this style for consistency rather than reformatting existing files.
- **Dark theme only** — all CSS variables are defined once in `index.html`'s `<style>` block. No light mode currently exists.
- **Fonts:** Inter for UI text, JetBrains Mono (`var(--font-mono)`) for any numeric/ticker/date value — this distinction is used consistently throughout and should be preserved.
- **No new dependencies without good reason** — the dependency list is deliberately minimal (`papaparse`, `react`, `react-dom`, `recharts` are the only runtime deps). Don't add a UI kit, state management library, or CSS framework unless explicitly asked.
- **All thresholds, URLs, sector lists, and color mappings live in `src/config.js`** — never hardcode a filter threshold or sector name directly inside a component; reference the config constants so the screening logic stays in one place.
- **Python scripts are batch/offline tools, not deployed services** — don't suggest wrapping them in Flask/FastAPI or deploying them as APIs unless Rishu explicitly asks for that (it would be a real architecture change, not an incremental one).

---

## 9. Useful context for non-technical collaboration

Rishu does not have a coding background and builds this entirely through AI coding assistants, switching between platforms due to rate limits — which is exactly why this document exists. When making changes:
- Prefer **complete, runnable code** over partial snippets requiring manual integration — Rishu can't easily debug a half-finished diff.
- When a change affects both the Python pipeline and the frontend (e.g., changing a filter threshold), call out **both** files that need updating, since this project's most common synchronization risk is the JS/Python strategy logic drifting apart (see Section 5).
- If a request would require backend infrastructure, a paid data API, authentication, or anything beyond static-site-plus-GitHub-as-database, **flag this explicitly as a scope/architecture change** before building it, rather than silently introducing a server.
- Background: Rishu has an MBA from IIM Bangalore (finance focus), prior investment banking and debt capital markets experience, and is using this project partly as a portfolio piece / credibility signal in an active job search (alongside SSRN/Substack-style quant writing). Polish, clarity of the live performance numbers, and a working "Build & Test" tab are likely high-value next steps if asked for prioritization.

---

## 10. Quick start for a fresh AI platform session

```bash
# Frontend
npm install
npm run dev          # local dev server, fetches live data from GitHub raw URLs
npm run build         # production build (what Vercel runs)

# Python pipeline (run individual scripts as needed, in the order in Section 6)
pip install requests pandas
python fetch_betas.py
python build_portfolios_and_exits.py
python monitor_exits.py
python fetch_historical_prices.py
python compute_nav.py
python compute_performance_metrics.py
```

No `.env` or secrets are required — Yahoo Finance endpoints are queried unauthenticated, and the frontend reads public GitHub raw URLs.
