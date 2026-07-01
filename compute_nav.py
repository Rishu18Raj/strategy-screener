"""
compute_nav.py
─────────────────────────────────────────────────────────────────────────────
Computes a daily NAV series starting at ₹100 on the first rebalance date.

Portfolio NAV logic:
  - Equal weight across all stocks at each rebalance
  - Intra-quarter exits: proceeds earn 6% p.a. (overnight rate) until
    next rebalance
  - New entries at each rebalance at that day's close price
  - Stocks carried over: no transaction, weight rebalanced to equal

SENSEX NAV: ₹100 invested in SENSEX on the same start date.

Outputs:
  data/nav.json    [{date, portfolio_nav, sensex_nav}]
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
from datetime import datetime, timedelta

HISTORICAL_DIR    = "data/historical"
PRICES_PATH       = "data/prices_history.json"
TRADE_LOG_PATH    = "data/trade_log.json"
OUT_PATH          = "data/nav.json"
SENSEX_SYMBOL     = "^BSESN"
CASH_RATE_ANNUAL  = 0.06          # 6% p.a. for idle cash
CASH_RATE_DAILY   = (1 + CASH_RATE_ANNUAL) ** (1/365) - 1

REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

def quarter_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[d.month]
    return f"{d.year}{q}"

def load_portfolio(date_str):
    label = quarter_label(date_str)
    path  = os.path.join(HISTORICAL_DIR, f"portfolio_{label}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)

# ── load data ─────────────────────────────────────────────────
with open(PRICES_PATH) as f:
    prices_history = json.load(f)

with open(TRADE_LOG_PATH) as f:
    trade_log = json.load(f)

# index intra-quarter exits: {(ticker, entry_date): exit_date}
intra_exits = {
    (t["ticker"], t["entry_date"]): t["exit_date"]
    for t in trade_log
    if t.get("exit_type") == "intra_quarter" and t.get("exit_date")
}

def get_price(ticker_ns, date_str):
    """Get close price for a ticker on or before date_str."""
    prices = prices_history.get(ticker_ns, {})
    if date_str in prices:
        return prices[date_str]
    # walk back up to 5 days for weekends/holidays
    d = datetime.strptime(date_str, "%Y-%m-%d")
    for _ in range(5):
        d -= timedelta(days=1)
        ds = d.strftime("%Y-%m-%d")
        if ds in prices:
            return prices[ds]
    return None

def get_sensex(date_str):
    return get_price(SENSEX_SYMBOL, date_str)

# ── build sorted list of all trading days ─────────────────────
# union of all dates across all price series
all_dates = set()
for sym, prices in prices_history.items():
    all_dates.update(prices.keys())

start_date = REBALANCE_DATES[0]
end_date   = datetime.today().strftime("%Y-%m-%d")
all_dates  = sorted(d for d in all_dates if start_date <= d <= end_date)

print(f"\n{'─'*58}")
print(f"  Computing NAV: {start_date} → {end_date}")
print(f"  Trading days : {len(all_dates)}")
print(f"{'─'*58}\n")

# ── NAV simulation ────────────────────────────────────────────
START_NAV    = 100.0
portfolio_nav = START_NAV
sensex_nav    = START_NAV

# SENSEX baseline
sensex_start = get_sensex(start_date)

# holdings: {ticker: {shares, cash_value, exited}}
# We simulate ₹100 split equally across N stocks
holdings     = {}    # ticker → shares held
cash         = 0.0   # idle cash (from intra-quarter exits)
cash_from    = {}    # ticker → date when cash position started

nav_series   = []
rebal_set    = set(REBALANCE_DATES)

# initialise at first rebalance
first_portfolio = load_portfolio(start_date)
if not first_portfolio:
    print("✗ Could not load first portfolio. Exiting.")
    exit(1)

first_stocks = first_portfolio.get("stocks", [])
n = len(first_stocks)
alloc_per_stock = START_NAV / n if n > 0 else START_NAV

for s in first_stocks:
    ticker = s["ticker"]
    price  = s.get("entry_price") or get_price(f"{ticker}.NS", start_date)
    if price and price > 0:
        holdings[ticker] = {"shares": alloc_per_stock / price, "entry_date": start_date}

print(f"  {start_date}: Initialised with {n} stocks @ ₹{alloc_per_stock:.2f} each\n")

current_rebal_idx = 0

for date_str in all_dates:

    # ── rebalance if this is a rebalance date (except first, already done) ──
    if date_str in rebal_set and date_str != start_date:
        new_portfolio = load_portfolio(date_str)
        if new_portfolio:
            new_stocks   = new_portfolio.get("stocks", [])
            new_tickers  = {s["ticker"] for s in new_stocks}

            # compute current portfolio value before rebalance
            total_value = cash   # include any idle cash
            for ticker, h in holdings.items():
                price = get_price(f"{ticker}.NS", date_str)
                if price:
                    total_value += h["shares"] * price

            # rebuild holdings at equal weight
            holdings = {}
            cash     = 0.0
            n_new    = len(new_stocks)
            alloc    = total_value / n_new if n_new > 0 else total_value

            for s in new_stocks:
                ticker = s["ticker"]
                price  = s.get("entry_price") or get_price(f"{ticker}.NS", date_str)
                if price and price > 0:
                    # Preserve the stock's ORIGINAL entry_date (from the portfolio JSON)
                    # so carried stocks keep their original date for intra-exit key
                    # lookup. Previously this always used date_str (current rebal date),
                    # which caused intra_exits key misses for carried stocks that
                    # triggered an intra-exit in a later quarter (e.g. UTIAMC).
                    original_entry_date = s.get("entry_date") or date_str
                    holdings[ticker] = {"shares": alloc / price, "entry_date": original_entry_date}

            print(f"  {date_str}: Rebalanced → {n_new} stocks, NAV = ₹{total_value:.2f}")

    # ── process intra-quarter exits ──
    exited_today = []
    for ticker, h in list(holdings.items()):
        exit_key = (ticker, h.get("entry_date",""))
        if exit_key in intra_exits and intra_exits[exit_key] == date_str:
            price = get_price(f"{ticker}.NS", date_str)
            if price:
                cash += h["shares"] * price
                cash_from[ticker] = date_str
                exited_today.append(ticker)

    for ticker in exited_today:
        del holdings[ticker]
        print(f"  {date_str}: Intra-quarter exit — {ticker}, cash pool = ₹{cash:.2f}")

    # ── grow idle cash at overnight rate ──
    if cash > 0:
        cash *= (1 + CASH_RATE_DAILY)

    # ── compute portfolio NAV ──
    total_value = cash
    for ticker, h in holdings.items():
        price = get_price(f"{ticker}.NS", date_str)
        if price:
            total_value += h["shares"] * price

    portfolio_nav = total_value

    # ── compute SENSEX NAV ──
    s_price = get_price(SENSEX_SYMBOL, date_str)
    if s_price and sensex_start:
        sensex_nav = START_NAV * (s_price / sensex_start)

    nav_series.append({
        "date":          date_str,
        "portfolio_nav": round(portfolio_nav, 4),
        "sensex_nav":    round(sensex_nav, 4),
    })

# ── save ──────────────────────────────────────────────────────
with open(OUT_PATH, "w") as f:
    json.dump(nav_series, f, indent=2)

final = nav_series[-1]
total_ret   = round((final["portfolio_nav"] / START_NAV - 1) * 100, 2)
sensex_ret  = round((final["sensex_nav"]    / START_NAV - 1) * 100, 2)

print(f"\n{'─'*58}")
print(f"  ✓ NAV series saved → {OUT_PATH}")
print(f"  ✓ {len(nav_series)} trading days")
print(f"  Portfolio: ₹{START_NAV} → ₹{final['portfolio_nav']:.2f}  ({total_ret:+.1f}%)")
print(f"  SENSEX:    ₹{START_NAV} → ₹{final['sensex_nav']:.2f}  ({sensex_ret:+.1f}%)")
print(f"  Alpha:     {round(total_ret - sensex_ret, 2):+.1f}%")
print(f"{'─'*58}\n")