"""
monitor_exits.py — fixed
─────────────────────────────────────────────────────────────────────────────
Fixes applied:
  1. Exit rule baseline resets at each rebalance — 20% measured from the
     MOST RECENT rebalance date's entry price, not the original entry price.
  2. No double counting — intra-quarter exits are marked so build_historical
     portfolios.py won't log them again as rebalance exits.
  3. Deduplication on rerun — already-logged intra-quarter exits are skipped.

Exit rule: price_return > 20% from last rebalance AND live_PE > 20x
           (TTM EPS fixed at the most recent rebalance entry price / PE)
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import time
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

EXIT_RETURN_THRESHOLD = 20.0
EXIT_PE_THRESHOLD     = 20.0
HISTORICAL_DIR        = "data/historical"
TRADE_LOG_PATH        = "data/trade_log.json"
SENSEX_SYMBOL         = "^BSESN"

REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

def make_session():
    s = requests.Session()
    retry = Retry(connect=3, read=3, backoff_factor=2, status_forcelist=[429,500,502,503,504])
    s.mount("http://",  HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s

SESSION = make_session()

def fetch_daily_prices(symbol, date_from, date_to):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={int(date_from.timestamp())}&period2={int(date_to.timestamp())}"
        f"&interval=1d&events=history"
    )
    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 20))
                print(f"    ⏳ Rate limited. Waiting {wait}s...")
                time.sleep(wait)
                continue
            if r.status_code != 200:
                return {}
            data       = r.json()
            result     = data["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes     = result["indicators"]["quote"][0]["close"]
            prices = {}
            for ts, c in zip(timestamps, closes):
                if c is not None:
                    prices[datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")] = round(c, 2)
            return prices
        except (KeyError, IndexError):
            return {}
        except Exception:
            if attempt < 2:
                time.sleep(5)
    return {}

def quarter_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[d.month]
    return f"{d.year}{q}"

def load_portfolio(date_str):
    path = os.path.join(HISTORICAL_DIR, f"portfolio_{quarter_label(date_str)}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)

def load_trade_log():
    if os.path.exists(TRADE_LOG_PATH):
        with open(TRADE_LOG_PATH) as f:
            return json.load(f)
    return []

def save_trade_log(log):
    with open(TRADE_LOG_PATH, "w") as f:
        json.dump(log, f, indent=2)

def annualised(abs_pct, holding_days):
    if abs_pct is None or not holding_days or holding_days <= 0:
        return None
    return round(((1 + abs_pct/100) ** (365.25/holding_days) - 1) * 100, 2)

def trading_days_between(prices_dict, after_date_str, before_date_str):
    return sorted(d for d in prices_dict if after_date_str < d < before_date_str)

# ── rebuild trade log from scratch ───────────────────────────
# We regenerate intra-quarter exits cleanly to avoid double-counting.
# First, load the rebalance-exit trade log produced by build_historical_portfolios.py
# and strip out any previously logged intra-quarter exits (we'll recompute them).

print(f"\n{'─'*62}")
print(f"  Intra-quarter exit monitor (fixed)")
print(f"  Exit rule: return > {EXIT_RETURN_THRESHOLD}% from last rebalance AND P/E > {EXIT_PE_THRESHOLD}x")
print(f"{'─'*62}\n")

full_log = load_trade_log()

# Separate rebalance exits and open positions from intra-quarter exits
# We'll recompute intra-quarter exits from scratch
rebalance_trades = [t for t in full_log if t.get("exit_type") != "intra_quarter"]
new_intra_exits  = []

# Track which (ticker, rebalance_entry_date) have been intra-exited
# so we can remove the corresponding open/rebalance trade
intra_exited_keys = set()

for i, entry_date_str in enumerate(REBALANCE_DATES[:-1]):
    exit_date_str = REBALANCE_DATES[i + 1]
    label = quarter_label(entry_date_str)

    print(f"\n{'─'*50}")
    print(f"  Quarter {label}: {entry_date_str} → {exit_date_str}")
    print(f"{'─'*50}")

    portfolio_data = load_portfolio(entry_date_str)
    if not portfolio_data:
        print(f"  ✗ portfolio_{label}.json not found — skipping")
        continue

    stocks = portfolio_data.get("stocks", [])
    if not stocks:
        print(f"  ✗ No stocks — skipping")
        continue

    # ── date range: strictly AFTER entry, strictly BEFORE exit ──
    date_from = datetime.strptime(entry_date_str, "%Y-%m-%d") + timedelta(days=1)
    date_to   = datetime.strptime(exit_date_str,  "%Y-%m-%d")

    # Fetch SENSEX for this window
    print(f"  Fetching SENSEX...")
    sensex_prices = fetch_daily_prices(SENSEX_SYMBOL, date_from, date_to)
    time.sleep(0.5)

    # Load/build daily price cache
    cache_path = os.path.join(HISTORICAL_DIR, f"daily_prices_{label}.json")
    daily_cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            daily_cache = json.load(f)
        print(f"  ✓ Loaded cached daily prices")

    cache_updated = False

    for stock in stocks:
        ticker      = stock.get("ticker","").strip()
        # ── KEY FIX: use THIS rebalance's entry price as the baseline ──
        # Not the original entry (which may be multiple quarters back)
        rebal_entry_price = stock.get("entry_price")   # price on entry_date_str
        rebal_entry_date  = entry_date_str              # always THIS rebalance
        pe_at_entry       = stock.get("pe")
        original_entry    = stock.get("entry_date", entry_date_str)  # for trade log

        if not rebal_entry_price:
            print(f"  {ticker:<15} ✗ no entry price — skip")
            continue

        # Derive TTM EPS from THIS rebalance's entry price and PE
        ttm_eps = (rebal_entry_price / pe_at_entry) if pe_at_entry and pe_at_entry > 0 else None

        # Fetch daily prices
        if ticker not in daily_cache:
            prices = fetch_daily_prices(f"{ticker}.NS", date_from, date_to)
            if prices:
                daily_cache[ticker] = prices
                cache_updated = True
            time.sleep(0.4)
        else:
            prices = daily_cache[ticker]

        if not prices:
            print(f"  {ticker:<15} ✗ no daily prices — skip")
            continue

        trading_days = trading_days_between(prices, entry_date_str, exit_date_str)
        triggered    = False

        for day in trading_days:
            close = prices.get(day)
            if close is None:
                continue

            # Return measured from THIS REBALANCE entry price
            ret_pct  = (close - rebal_entry_price) / rebal_entry_price * 100
            live_pe  = (close / ttm_eps) if ttm_eps else None
            pe_breach = live_pe is not None and live_pe > EXIT_PE_THRESHOLD
            ret_breach = ret_pct > EXIT_RETURN_THRESHOLD

            if ret_breach and pe_breach:
                # SENSEX return over same window (from rebalance date to exit day)
                s_start = sensex_prices.get(entry_date_str) or next(
                    (sensex_prices[d] for d in sorted(sensex_prices) if d >= entry_date_str), None)
                s_end   = sensex_prices.get(day) or next(
                    (sensex_prices[d] for d in sorted(sensex_prices, reverse=True) if d <= day), None)

                # Holding days from ORIGINAL entry (for full trade P&L)
                hold_from_original = (
                    datetime.strptime(day, "%Y-%m-%d") -
                    datetime.strptime(original_entry, "%Y-%m-%d")
                ).days

                # Return from ORIGINAL entry price (for full trade P&L)
                original_entry_price = stock.get("entry_price")  # same as rebal here if first time held
                # Find original entry price from previous trade log if carried over
                orig_trade = next(
                    (t for t in rebalance_trades
                     if t["ticker"] == ticker and t.get("status") == "open"
                     and t.get("entry_date") == original_entry),
                    None
                )
                if orig_trade and orig_trade.get("entry_price"):
                    original_entry_price = orig_trade["entry_price"]

                abs_ret_from_orig = (
                    round((close - original_entry_price) / original_entry_price * 100, 2)
                    if original_entry_price else None
                )
                ann_ret = annualised(abs_ret_from_orig, hold_from_original)

                sensex_abs = round((s_end - s_start) / s_start * 100, 2) if s_start and s_end else None
                sensex_ann = annualised(sensex_abs, hold_from_original)

                exit_record = {
                    "ticker":           ticker,
                    "name":             stock.get("name"),
                    "sector":           stock.get("sector"),
                    "entry_date":       original_entry,       # original entry date
                    "rebal_baseline":   rebal_entry_date,     # rebalance date used for 20% trigger
                    "exit_date":        day,
                    "entry_price":      original_entry_price,
                    "rebal_price":      rebal_entry_price,    # price at which 20% was measured from
                    "exit_price":       close,
                    "holding_days":     hold_from_original,
                    "abs_return_pct":   abs_ret_from_orig,
                    "ann_return_pct":   ann_ret,
                    "pe_at_exit":       round(live_pe, 2) if live_pe else None,
                    "sensex_abs_pct":   sensex_abs,
                    "sensex_ann_pct":   sensex_ann,
                    "alpha_abs":        round(abs_ret_from_orig - sensex_abs, 2) if abs_ret_from_orig is not None and sensex_abs is not None else None,
                    "alpha_ann":        round(ann_ret - sensex_ann, 2) if ann_ret is not None and sensex_ann is not None else None,
                    "exit_type":        "intra_quarter",
                    "status":           "closed",
                    "trigger":          f"ret={round(ret_pct,1)}% from {rebal_entry_date} > {EXIT_RETURN_THRESHOLD}%,  P/E={round(live_pe,1)}x > {EXIT_PE_THRESHOLD}x",
                }

                new_intra_exits.append(exit_record)
                # Mark this ticker+original_entry as intra-exited so we remove
                # its open/rebalance record
                intra_exited_keys.add((ticker, original_entry))

                print(f"  {ticker:<15} 🔴 EXIT {day}: "
                      f"ret={round(ret_pct,1)}% from {rebal_entry_date}, "
                      f"P/E={round(live_pe,1)}x, "
                      f"full return={abs_ret_from_orig}%")
                triggered = True
                break

        if not triggered:
            print(f"  {ticker:<15} ✓ held  "
                  f"(baseline ₹{rebal_entry_price}  "
                  f"last ₹{prices.get(trading_days[-1]) if trading_days else '—'})")

    if cache_updated:
        with open(cache_path, "w") as f:
            json.dump(daily_cache, f)

# ── remove open/rebalance exits that were actually intra-exited ──
cleaned_rebalance = [
    t for t in rebalance_trades
    if not (
        (t["ticker"], t.get("entry_date")) in intra_exited_keys and
        t.get("status") in ("open", "closed")
    )
]

# ── merge and save ────────────────────────────────────────────
final_log = cleaned_rebalance + new_intra_exits
save_trade_log(final_log)

# ── summary ───────────────────────────────────────────────────
intra  = [t for t in final_log if t.get("exit_type") == "intra_quarter"]
rebal  = [t for t in final_log if t.get("exit_type") != "intra_quarter" and t.get("status") == "closed"]
open_  = [t for t in final_log if t.get("status") == "open"]
closed = intra + rebal

rets    = [t["abs_return_pct"] for t in closed if t.get("abs_return_pct") is not None]
alphas  = [t["alpha_abs"]      for t in closed if t.get("alpha_abs")      is not None]
winners = [r for r in rets if r > 0]

print(f"\n{'─'*62}")
print(f"  TRADE LOG SUMMARY")
print(f"  Intra-quarter exits : {len(intra)}")
print(f"  Rebalance exits     : {len(rebal)}")
print(f"  Open positions      : {len(open_)}")
if rets:
    print(f"  Avg closed return   : {sum(rets)/len(rets):.1f}%")
    print(f"  Win rate            : {len(winners)/len(rets)*100:.0f}%  ({len(winners)}/{len(closed)})")
if alphas:
    print(f"  Avg alpha (abs)     : {sum(alphas)/len(alphas):.1f}%")
print(f"{'─'*62}\n")