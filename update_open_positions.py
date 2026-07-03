"""
update_open_positions.py
─────────────────────────────────────────────────────────────────────────────
Refreshes the live price / return / holding-days fields on OPEN trade_log.json
entries, using data the daily pipeline has already fetched. Does NOT touch
closed or intra_quarter entries.

Why this exists: build_portfolios_and_exits.py (the full historical-quarter
rebuild) is the only script that originally computed these "open position"
fields — but it's far too heavy to run every day, since it re-screens all
historical quarters from scratch. This script is the lightweight daily
counterpart: it only recomputes numbers for positions that are still open,
by reading prices_history.json (already fresh) and portfolio_current.json
(the source of truth for each open position's entry price/date/baseline).

Run order in the daily workflow:
  1. fetch_historical_prices.py   → refreshes data/prices_history.json
  2. monitor_exits.py             → may convert an open position to a closed
                                     intra-quarter exit; must run BEFORE this
                                     script so we don't re-open something that
                                     was just closed
  3. update_open_positions.py     → this script
  4. compute_nav.py / compute_performance_metrics.py
─────────────────────────────────────────────────────────────────────────────
"""

import json
from datetime import datetime

TRADE_LOG_PATH       = "data/trade_log.json"
PORTFOLIO_CURRENT    = "data/portfolio_current.json"
PRICES_HISTORY_PATH  = "data/prices_history.json"
SENSEX_SYMBOL         = "^BSESN"


def annualised(abs_pct, holding_days):
    if abs_pct is None or not holding_days or holding_days <= 0:
        return None
    return round(((1 + abs_pct / 100) ** (365.25 / holding_days) - 1) * 100, 2)


def latest_price(price_series):
    """price_series: {date_str: close}. Returns (date_str, close) for the
    most recent date, or (None, None) if the series is empty."""
    if not price_series:
        return None, None
    d = max(price_series.keys())
    return d, price_series[d]


print(f"\n{'─'*62}")
print("  Refreshing open position prices/returns")
print(f"{'─'*62}\n")

with open(TRADE_LOG_PATH) as f:
    trade_log = json.load(f)

with open(PORTFOLIO_CURRENT) as f:
    portfolio_current = json.load(f)

with open(PRICES_HISTORY_PATH) as f:
    prices_history = json.load(f)

current_by_ticker = {s["ticker"]: s for s in portfolio_current.get("stocks", [])}

sensex_date, sensex_today = latest_price(prices_history.get(SENSEX_SYMBOL, {}))
if sensex_today is None:
    raise SystemExit("✗ No SENSEX price available in prices_history.json — aborting.")

updated, skipped = 0, 0

for trade in trade_log:
    if trade.get("status") != "open":
        continue

    ticker = trade["ticker"]
    ref = current_by_ticker.get(ticker)
    if not ref:
        print(f"  {ticker:<15} ⚠ not found in portfolio_current.json — leaving stale")
        skipped += 1
        continue

    entry_price  = ref.get("entry_price")
    entry_date   = ref.get("entry_date")
    sensex_rebal = ref.get("sensex_rebal")

    price_date, price_today = latest_price(prices_history.get(f"{ticker}.NS", {}))
    if price_today is None or entry_price is None or entry_date is None:
        print(f"  {ticker:<15} ⚠ missing price/entry data — leaving stale")
        skipped += 1
        continue

    # Use whichever of (stock, SENSEX) price series is further behind, so
    # both legs of the return figure line up on the same calendar day.
    as_of = min(price_date, sensex_date)
    days = (datetime.strptime(as_of, "%Y-%m-%d") - datetime.strptime(entry_date, "%Y-%m-%d")).days

    abs_ret    = round((price_today - entry_price) / entry_price * 100, 2)
    ann_ret    = annualised(abs_ret, days)
    sensex_abs = round((sensex_today - sensex_rebal) / sensex_rebal * 100, 2) if sensex_rebal else None
    sensex_ann = annualised(sensex_abs, days) if sensex_abs is not None else None

    trade["entry_date"]     = entry_date
    trade["entry_price"]    = entry_price
    trade["exit_price"]     = price_today
    trade["holding_days"]   = days
    trade["abs_return_pct"] = abs_ret
    trade["ann_return_pct"] = ann_ret
    trade["sensex_abs_pct"] = sensex_abs
    trade["sensex_ann_pct"] = sensex_ann
    trade["alpha_abs"]      = round(abs_ret - sensex_abs, 2) if sensex_abs is not None else None
    trade["alpha_ann"]      = round(ann_ret - sensex_ann, 2) if ann_ret is not None and sensex_ann is not None else None

    print(f"  {ticker:<15} ✓ as of {as_of}: ₹{price_today}  ({abs_ret:+.2f}%, {days}d held)")
    updated += 1

with open(TRADE_LOG_PATH, "w") as f:
    json.dump(trade_log, f, indent=2)

print(f"\n{'─'*62}")
print(f"  Refreshed {updated} open position(s), skipped {skipped}")
print(f"{'─'*62}\n")
