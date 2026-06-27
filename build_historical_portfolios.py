"""
build_historical_portfolios.py
─────────────────────────────────────────────────────────────────────────────
Reads historical fundamentals CSVs + betas JSON files and produces:
  1. data/historical/portfolio_YYYYQN.json  — stocks in portfolio each quarter
  2. data/trade_log.json                    — every entry/exit with returns
  3. data/portfolio_current.json            — latest portfolio (for the UI)

The 5-step selection pipeline (mirrors App.jsx):
  1. Fundamental filters: RoE ≥ 13%, Rev CAGR ≥ 7%, EPS CAGR ≥ 10%, P/E ≤ 20x
  2. Sector filter: only SELECTED_SECTORS
  3. Beta filter: β ≤ 1.2
  4. Sector cap: min(3, max(1, floor(20% × sector_size_in_universe)))
  5. Within-sector rank by Growth/P/E Score (EPS CAGR / P/E)

For each quarter it also fetches:
  - Entry price  (T-1 close on rebalance date, from Yahoo Finance)
  - Exit price   (T-1 close on next rebalance date, or latest if still held)
  - SENSEX return over the same holding period (^BSESN on Yahoo Finance)

Usage:
  python build_historical_portfolios.py

Requirements:
  pip install pandas requests
─────────────────────────────────────────────────────────────────────────────
"""

import json
import math
import os
import time
from datetime import datetime, timedelta

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── strategy config (must mirror App.jsx) ─────────────────────
SELECTED_SECTORS = {
    "Banks", "Financial Services", "Media Entertainment & Publication",
    "Information Technology", "Telecommunication", "Capital Goods",
    "Construction", "Consumer Services", "Chemicals",
    "Oil Gas & Consumable Fuels", "Power", "Textiles",
}

# Base filters — never relaxed
FILTERS_FIXED = dict(roe=13, revCAGR=7, beta=1.2)

# Relaxation rounds — sequential, stop when portfolio ≥ MIN_PORTFOLIO_SIZE
# Each round defines (epsCAGR_threshold, pe_threshold, round_label)
RELAXATION_ROUNDS = [
    (10, 20, 0, "base"),           # Round 0: full filters
    (10, 25, 1, "pe_relaxed"),     # Round 1: PE → 25x
    (9,  25, 2, "eps_9_pe_25"),    # Round 2: EPS → 9%
    (8,  25, 3, "eps_8_pe_25"),    # Round 3: EPS → 8%
    (7,  25, 4, "eps_7_pe_25"),    # Round 4: EPS → 7%
]

MIN_PORTFOLIO_SIZE = 6

# ── rebalance schedule ────────────────────────────────────────
# Add dates as you generate more fundamentals CSVs.
# The script processes them in order. The final date's portfolio
# remains open (no exit price yet).
REBALANCE_DATES = [
    "2024-06-25",
    "2024-09-25",
    "2024-12-25",
    "2025-03-25",
    "2025-06-25",
    "2025-09-25",
    "2025-12-25",
    "2026-03-25",
    "2026-06-25",   # current / latest rebalance
]

HISTORICAL_DIR   = "data/historical"
BETAS_DIR        = "data/historical"   # expects betas_YYYYQN.json in same folder
CURRENT_BETAS    = "data/betas.json"   # used for the latest rebalance
OUT_DIR          = "data/historical"
TRADE_LOG_PATH   = "data/trade_log.json"
CURRENT_PORTFOLIO= "data/portfolio_current.json"

os.makedirs(OUT_DIR, exist_ok=True)

# ── http session ──────────────────────────────────────────────
def make_session():
    s = requests.Session()
    retry = Retry(connect=3, read=3, backoff_factor=2,
                  status_forcelist=[429, 500, 502, 503, 504])
    s.mount("http://",  HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s

SESSION = make_session()
YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# ── Yahoo Finance helpers ─────────────────────────────────────
_price_cache = {}

def fetch_close(symbol, date_str):
    """
    Fetch the most recent close price on or before `date_str` (YYYY-MM-DD).
    Uses a local cache to avoid re-fetching the same symbol+date.
    """
    key = (symbol, date_str)
    if key in _price_cache:
        return _price_cache[key]

    as_of = datetime.strptime(date_str, "%Y-%m-%d")
    frm   = int((as_of - timedelta(days=10)).timestamp())
    to    = int((as_of - timedelta(days=1)).timestamp())
    url   = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={frm}&period2={to}&interval=1d&events=history"
    )
    try:
        r = SESSION.get(url, headers=YAHOO_HEADERS, timeout=12)
        if r.status_code != 200:
            _price_cache[key] = None
            return None
        data   = r.json()
        closes = data["chart"]["result"][0]["indicators"]["quote"][0]["close"]
        closes = [c for c in closes if c is not None]
        price  = round(closes[-1], 2) if closes else None
        _price_cache[key] = price
        return price
    except Exception:
        _price_cache[key] = None
        return None

def fetch_stock_price(ticker, date_str):
    return fetch_close(f"{ticker}.NS", date_str)

def fetch_sensex_price(date_str):
    return fetch_close("^BSESN", date_str)

# ── helpers ───────────────────────────────────────────────────
def quarter_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[d.month]
    return f"{d.year}{q}"

def growth_score(row):
    pe = row.get("pe") or 0
    return (row.get("epsCAGR") or 0) / pe if pe > 0 else 0

def passes_fundamentals(row):
    try:
        return (
            float(row["roe"])     >= FILTERS["roe"]     and
            float(row["revCAGR"]) >= FILTERS["revCAGR"] and
            float(row["epsCAGR"]) >= FILTERS["epsCAGR"] and
            float(row["pe"])      <= FILTERS["pe"]
        )
    except (TypeError, ValueError):
        return False

def get_sector_caps(all_stocks):
    """Sector cap = min(3, max(1, floor(0.20 × sector_count_in_universe)))"""
    counts = {}
    for s in all_stocks:
        sec = s.get("sector","")
        if sec:
            counts[sec] = counts.get(sec, 0) + 1
    return {sec: min(3, max(1, math.floor(0.2 * n))) for sec, n in counts.items()}

def build_portfolio(fundamentals, betas):
    """
    Run the 5-step pipeline and return list of selected stock dicts.
    """
    # merge betas into fundamentals
    stocks = []
    for row in fundamentals:
        t = row.get("ticker","").strip()
        row = dict(row)
        row["beta"] = betas.get(t)
        stocks.append(row)

    caps = get_sector_caps(stocks)

    # step 1 — fundamentals
    fund_pass = [s for s in stocks if passes_fundamentals(s)]

    # step 2 — sector
    sec_pass = [s for s in fund_pass if s.get("sector","") in SELECTED_SECTORS]

    # step 3 — beta
    beta_pass = [s for s in sec_pass
                 if s.get("beta") is not None and float(s["beta"]) <= FILTERS["beta"]]

    # step 4+5 — sector cap + rank by G/P score
    by_sector = {}
    for s in beta_pass:
        sec = s.get("sector","")
        by_sector.setdefault(sec, []).append(s)

    portfolio = []
    for sec, stocks_in_sec in by_sector.items():
        cap     = caps.get(sec, 1)
        ranked  = sorted(stocks_in_sec, key=growth_score, reverse=True)
        portfolio.extend(ranked[:cap])

    return portfolio, len(fund_pass), len(sec_pass), len(beta_pass)

def annualised_return(abs_return_pct, holding_days):
    """Convert absolute return % to annualised % using CAGR formula."""
    if holding_days <= 0:
        return None
    years = holding_days / 365.25
    return round(((1 + abs_return_pct / 100) ** (1 / years) - 1) * 100, 2)

# ── load betas for a given quarter ───────────────────────────
def load_betas(date_str):
    """
    Try to load quarter-specific betas first (betas_2024Q2.json),
    fall back to current betas.json.
    """
    label = quarter_label(date_str)
    specific = os.path.join(BETAS_DIR, f"betas_{label}.json")
    if os.path.exists(specific):
        with open(specific) as f:
            return json.load(f)
    # fall back to current betas
    if os.path.exists(CURRENT_BETAS):
        with open(CURRENT_BETAS) as f:
            print(f"  ⚠  No period-specific betas for {label}, using current betas.json")
            return json.load(f)
    return {}

# ── main ──────────────────────────────────────────────────────
print(f"\n{'─'*62}")
print(f"  Building historical portfolios")
print(f"  Rebalance dates: {len(REBALANCE_DATES)}")
print(f"{'─'*62}\n")

all_portfolios  = {}   # date_str → list of stock dicts with entry price
trade_log       = []

prev_portfolio  = {}   # ticker → {entry_date, entry_price, sensex_entry, ...}

for i, date_str in enumerate(REBALANCE_DATES):
    label = quarter_label(date_str)
    print(f"\n{'─'*50}")
    print(f"  {date_str}  ({label})")
    print(f"{'─'*50}")

    # ── load fundamentals CSV ──
    csv_path = os.path.join(HISTORICAL_DIR, f"fundamentals_{label}.csv")
    if not os.path.exists(csv_path):
        print(f"  ✗  {csv_path} not found — skipping")
        continue

    df   = pd.read_csv(csv_path)
    df.columns = [c.strip().lower() for c in df.columns]
    fundamentals = df.to_dict("records")

    # ── load betas ──
    betas = load_betas(date_str)

    # ── build portfolio ──
    portfolio, n_fund, n_sec, n_beta, round_used, round_label = build_portfolio(fundamentals, betas)
    print(f"  Funnel: {len(fundamentals)} → {n_fund} (fund) → {n_sec} (sector) → {n_beta} (beta) → {len(portfolio)} (final, round {round_used})")

    # ── fetch entry prices + sensex ──
    sensex_entry = fetch_sensex_price(date_str)
    print(f"  SENSEX on {date_str}: {sensex_entry}")

    portfolio_with_prices = []
    for s in portfolio:
        ticker = s.get("ticker","").strip()
        price  = fetch_stock_price(ticker, date_str)
        if price is None:
            print(f"    ⚠  {ticker}: no entry price found")
        else:
            print(f"    ✓  {ticker}: ₹{price}")
        portfolio_with_prices.append({
            **{k: s.get(k) for k in ("ticker","name","sector","roe","revCAGR","epsCAGR","pe","beta")},
            "growth_score":   round(growth_score(s), 4),
            "entry_date":     date_str,
            "entry_price":    price,
            "sensex_entry":   sensex_entry,
        })
        time.sleep(0.1)   # polite to Yahoo

    # ── process exits from previous portfolio ──
    current_tickers = {s["ticker"] for s in portfolio_with_prices}
    prev_tickers    = set(prev_portfolio.keys())
    exiting         = prev_tickers - current_tickers   # dropped this quarter

    sensex_exit = sensex_entry   # use this quarter's open as the exit benchmark

    for ticker in exiting:
        prev = prev_portfolio[ticker]
        exit_price   = fetch_stock_price(ticker, date_str)
        entry_price  = prev.get("entry_price")
        entry_date   = prev.get("entry_date")
        s_entry      = prev.get("sensex_entry")

        holding_days = (
            datetime.strptime(date_str, "%Y-%m-%d") -
            datetime.strptime(entry_date, "%Y-%m-%d")
        ).days if entry_date else None

        abs_ret = (
            round((exit_price - entry_price) / entry_price * 100, 2)
            if exit_price and entry_price else None
        )
        ann_ret = annualised_return(abs_ret, holding_days) if abs_ret is not None else None

        sensex_abs = (
            round((sensex_exit - s_entry) / s_entry * 100, 2)
            if sensex_exit and s_entry else None
        )
        sensex_ann = annualised_return(sensex_abs, holding_days) if sensex_abs is not None else None

        trade_log.append({
            "ticker":           ticker,
            "name":             prev.get("name"),
            "sector":           prev.get("sector"),
            "entry_date":       entry_date,
            "exit_date":        date_str,
            "entry_price":      entry_price,
            "exit_price":       exit_price,
            "holding_days":     holding_days,
            "abs_return_pct":   abs_ret,
            "ann_return_pct":   ann_ret,
            "sensex_abs_pct":   sensex_abs,
            "sensex_ann_pct":   sensex_ann,
            "alpha_abs":        round(abs_ret - sensex_abs, 2) if abs_ret is not None and sensex_abs is not None else None,
            "alpha_ann":        round(ann_ret - sensex_ann, 2) if ann_ret is not None and sensex_ann is not None else None,
            "status":           "closed",
        })
        print(f"  EXIT  {ticker}: {abs_ret}% abs  ({ann_ret}% ann)  vs SENSEX {sensex_abs}%")
        time.sleep(0.3)

    # ── mark still-held positions (open trades) ──
    # These will get updated each run as new quarters are added
    for s in portfolio_with_prices:
        ticker = s["ticker"]
        if ticker in prev_portfolio:
            # carried over — keep original entry
            s["entry_date"]  = prev_portfolio[ticker]["entry_date"]
            s["entry_price"] = prev_portfolio[ticker]["entry_price"]
            s["sensex_entry"]= prev_portfolio[ticker]["sensex_entry"]

    # ── save quarter portfolio JSON ──
    out_path = os.path.join(OUT_DIR, f"portfolio_{label}.json")
    with open(out_path, "w") as f:
        json.dump({
            "rebalance_date":  date_str,
            "label":           label,
            "filter_round":    round_used,
            "filter_label":    round_label,
            "universe_count":  len(fundamentals),
            "fund_pass":       n_fund,
            "sector_pass":     n_sec,
            "beta_pass":       n_beta,
            "portfolio_count": len(portfolio_with_prices),
            "sensex_level":    sensex_entry,
            "stocks":          portfolio_with_prices,
        }, f, indent=2)
    print(f"\n  ✓  Saved {out_path}")

    # ── update prev_portfolio for next iteration ──
    prev_portfolio = {s["ticker"]: s for s in portfolio_with_prices}
    all_portfolios[date_str] = portfolio_with_prices

# ── add open trades to trade log ─────────────────────────────
latest_date = REBALANCE_DATES[-1]
# find which date we actually processed last
processed = sorted([d for d in all_portfolios.keys()])
if processed:
    latest_processed = processed[-1]
    today_str = datetime.today().strftime("%Y-%m-%d")
    sensex_today = fetch_sensex_price(today_str)

    for s in all_portfolios.get(latest_processed, []):
        ticker      = s["ticker"]
        entry_price = s.get("entry_price")
        entry_date  = s.get("entry_date")
        s_entry     = s.get("sensex_entry")

        price_today  = fetch_stock_price(ticker, today_str)
        holding_days = (
            datetime.strptime(today_str, "%Y-%m-%d") -
            datetime.strptime(entry_date, "%Y-%m-%d")
        ).days if entry_date else None

        abs_ret = (
            round((price_today - entry_price) / entry_price * 100, 2)
            if price_today and entry_price else None
        )
        ann_ret = annualised_return(abs_ret, holding_days) if abs_ret is not None else None
        sensex_abs = (
            round((sensex_today - s_entry) / s_entry * 100, 2)
            if sensex_today and s_entry else None
        )
        sensex_ann = annualised_return(sensex_abs, holding_days) if sensex_abs is not None else None

        trade_log.append({
            "ticker":         ticker,
            "name":           s.get("name"),
            "sector":         s.get("sector"),
            "entry_date":     entry_date,
            "exit_date":      None,
            "entry_price":    entry_price,
            "exit_price":     price_today,
            "holding_days":   holding_days,
            "abs_return_pct": abs_ret,
            "ann_return_pct": ann_ret,
            "sensex_abs_pct": sensex_abs,
            "sensex_ann_pct": sensex_ann,
            "alpha_abs":      round(abs_ret - sensex_abs, 2) if abs_ret is not None and sensex_abs is not None else None,
            "alpha_ann":      round(ann_ret - sensex_ann, 2) if ann_ret is not None and sensex_ann is not None else None,
            "status":         "open",
        })
        time.sleep(0.3)

# ── write trade log ───────────────────────────────────────────
with open(TRADE_LOG_PATH, "w") as f:
    json.dump(trade_log, f, indent=2)
print(f"\n  ✓  Trade log saved → {TRADE_LOG_PATH}  ({len(trade_log)} trades)")

# ── write current portfolio ───────────────────────────────────
if processed:
    with open(CURRENT_PORTFOLIO, "w") as f:
        json.dump({
            "generated":  datetime.today().strftime("%Y-%m-%d"),
            "stocks":     all_portfolios.get(latest_processed, []),
        }, f, indent=2)
    print(f"  ✓  Current portfolio saved → {CURRENT_PORTFOLIO}")

# ── summary ───────────────────────────────────────────────────
closed = [t for t in trade_log if t["status"] == "closed"]
open_  = [t for t in trade_log if t["status"] == "open"]

if closed:
    returns = [t["abs_return_pct"] for t in closed if t["abs_return_pct"] is not None]
    alphas  = [t["alpha_abs"]      for t in closed if t["alpha_abs"]      is not None]
    winners = [r for r in returns if r > 0]
    print(f"\n{'─'*50}")
    print(f"  TRADE LOG SUMMARY")
    print(f"  Closed trades  : {len(closed)}")
    print(f"  Open trades    : {len(open_)}")
    if returns:
        print(f"  Avg return     : {sum(returns)/len(returns):.1f}%")
        print(f"  Win rate       : {len(winners)/len(returns)*100:.0f}%  ({len(winners)}/{len(returns)})")
    if alphas:
        print(f"  Avg alpha      : {sum(alphas)/len(alphas):.1f}%")
    print(f"{'─'*50}\n")