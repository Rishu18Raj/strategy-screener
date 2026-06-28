"""
monitor_exits.py
─────────────────────────────────────────────────────────────────────────────
For each quarterly portfolio, fetches daily EOD prices between rebalance dates
and applies the intra-quarter exit rule:

  EXIT if: price_return > 20% AND live_PE > 20x
  (live_PE = current_price / TTM_EPS_at_entry, TTM EPS fixed at entry date)

Outputs:
  data/trade_log.json   — updated with intra-quarter exits
  data/historical/daily_prices_YYYYQN.json  — cached daily prices per quarter

Usage:
  python monitor_exits.py

Run AFTER build_historical_portfolios.py has produced all portfolio_YYYYQN.json
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import time
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── config ────────────────────────────────────────────────────
EXIT_RETURN_THRESHOLD = 20.0   # %
EXIT_PE_THRESHOLD     = 20.0   # x
HISTORICAL_DIR        = "data/historical"
TRADE_LOG_PATH        = "data/trade_log.json"
SENSEX_SYMBOL         = "^BSESN"

REBALANCE_DATES = [
    "2024-06-25",
    "2024-09-25",
    "2024-12-25",
    "2025-03-25",
    "2025-06-25",
    "2025-09-25",
    "2025-12-25",
    "2026-03-25",
    "2026-06-25",
]

# ── http session ──────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

def make_session():
    s = requests.Session()
    retry = Retry(connect=3, read=3, backoff_factor=2,
                  status_forcelist=[429, 500, 502, 503, 504])
    s.mount("http://",  HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s

SESSION = make_session()

# ── Yahoo Finance ─────────────────────────────────────────────
def fetch_daily_prices(symbol, date_from, date_to):
    """Returns {date_str: close} for all trading days in range."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={int(date_from.timestamp())}"
        f"&period2={int(date_to.timestamp())}"
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
            prices     = {}
            for ts, c in zip(timestamps, closes):
                if c is not None:
                    d = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                    prices[d] = round(c, 2)
            return prices
        except (KeyError, IndexError):
            return {}
        except Exception:
            if attempt < 2:
                time.sleep(5)
    return {}

# ── helpers ───────────────────────────────────────────────────
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

def load_trade_log():
    if os.path.exists(TRADE_LOG_PATH):
        with open(TRADE_LOG_PATH) as f:
            return json.load(f)
    return []

def save_trade_log(log):
    with open(TRADE_LOG_PATH, "w") as f:
        json.dump(log, f, indent=2)

def annualised(abs_pct, holding_days):
    if abs_pct is None or holding_days is None or holding_days <= 0:
        return None
    years = holding_days / 365.25
    return round(((1 + abs_pct / 100) ** (1 / years) - 1) * 100, 2)

def trading_days_between(prices_dict, date_from_str, date_to_str):
    """Return sorted list of trading day strings strictly between two dates."""
    return sorted(
        d for d in prices_dict
        if date_from_str < d < date_to_str
    )

# ── main ──────────────────────────────────────────────────────
print(f"\n{'─'*62}")
print(f"  Intra-quarter exit monitor")
print(f"  Exit rule: return > {EXIT_RETURN_THRESHOLD}% AND P/E > {EXIT_PE_THRESHOLD}x")
print(f"{'─'*62}\n")

trade_log = load_trade_log()

# Build a set of (ticker, entry_date) already in the trade log
# so we don't double-log exits
existing_exits = {
    (t["ticker"], t["entry_date"])
    for t in trade_log
    if t.get("exit_type") == "intra_quarter"
}

new_exits = []

for i, entry_date_str in enumerate(REBALANCE_DATES[:-1]):
    exit_date_str = REBALANCE_DATES[i + 1]   # next rebalance = end of window

    label = quarter_label(entry_date_str)
    print(f"\n{'─'*50}")
    print(f"  Quarter {label}:  {entry_date_str} → {exit_date_str}")
    print(f"{'─'*50}")

    portfolio_data = load_portfolio(entry_date_str)
    if portfolio_data is None:
        print(f"  ✗ portfolio_{label}.json not found — skipping")
        continue

    stocks = portfolio_data.get("stocks", [])
    if not stocks:
        print(f"  ✗ No stocks in portfolio — skipping")
        continue

    date_from = datetime.strptime(entry_date_str, "%Y-%m-%d") + timedelta(days=1)
    date_to   = datetime.strptime(exit_date_str,  "%Y-%m-%d")

    # ── fetch SENSEX daily prices for this window ──
    print(f"  Fetching SENSEX daily prices...")
    sensex_prices = fetch_daily_prices(SENSEX_SYMBOL, date_from, date_to)
    time.sleep(0.5)

    # ── cache file for daily prices this quarter ──
    cache_path = os.path.join(HISTORICAL_DIR, f"daily_prices_{label}.json")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            daily_cache = json.load(f)
        print(f"  ✓ Loaded cached daily prices ({cache_path})")
    else:
        daily_cache = {}

    cache_updated = False

    for stock in stocks:
        ticker      = stock.get("ticker", "").strip()
        entry_price = stock.get("entry_price")
        entry_date  = stock.get("entry_date", entry_date_str)
        ttm_eps     = stock.get("ttm_eps")    # stored in portfolio JSON if available
        pe_at_entry = stock.get("pe")          # fallback: use entry P/E to derive EPS

        # skip if already logged as intra-quarter exit
        if (ticker, entry_date) in existing_exits:
            print(f"  {ticker:<15} already logged — skip")
            continue

        if not entry_price:
            print(f"  {ticker:<15} ✗ no entry price — skip")
            continue

        # derive TTM EPS from entry P/E and entry price if not stored explicitly
        # TTM EPS = entry_price / pe_at_entry
        if ttm_eps is None and pe_at_entry and pe_at_entry > 0:
            ttm_eps = entry_price / pe_at_entry

        if ttm_eps is None or ttm_eps <= 0:
            print(f"  {ticker:<15} ✗ cannot compute TTM EPS — skip PE check, using return-only")
            ttm_eps = None   # will skip PE check below

        # ── fetch daily prices for this ticker ──
        if ticker not in daily_cache:
            yahoo_sym = f"{ticker}.NS"
            prices    = fetch_daily_prices(yahoo_sym, date_from, date_to)
            if prices:
                daily_cache[ticker] = prices
                cache_updated = True
            time.sleep(0.4)
        else:
            prices = daily_cache[ticker]

        if not prices:
            print(f"  {ticker:<15} ✗ no daily prices — skip")
            continue

        # ── scan each trading day for exit trigger ──
        trading_days = trading_days_between(prices, entry_date_str, exit_date_str)
        triggered    = False

        for day in trading_days:
            close = prices.get(day)
            if close is None:
                continue

            ret_pct   = (close - entry_price) / entry_price * 100
            live_pe   = (close / ttm_eps) if ttm_eps else None

            # exit rule: return > 20% AND P/E > 20x
            pe_breached  = (live_pe is not None and live_pe > EXIT_PE_THRESHOLD)
            ret_breached = (ret_pct > EXIT_RETURN_THRESHOLD)

            if ret_breached and pe_breached:
                # compute SENSEX return over same window
                sensex_entry_price = sensex_prices.get(entry_date_str) or \
                                     next((sensex_prices[d] for d in sorted(sensex_prices) if d >= entry_date_str), None)
                sensex_exit_price  = sensex_prices.get(day) or \
                                     next((sensex_prices[d] for d in sorted(sensex_prices) if d <= day), None)

                holding_days = (
                    datetime.strptime(day, "%Y-%m-%d") -
                    datetime.strptime(entry_date, "%Y-%m-%d")
                ).days

                abs_ret = round(ret_pct, 2)
                ann_ret = annualised(abs_ret, holding_days)

                sensex_abs = (
                    round((sensex_exit_price - sensex_entry_price) / sensex_entry_price * 100, 2)
                    if sensex_entry_price and sensex_exit_price else None
                )
                sensex_ann = annualised(sensex_abs, holding_days)

                exit_record = {
                    "ticker":         ticker,
                    "name":           stock.get("name"),
                    "sector":         stock.get("sector"),
                    "entry_date":     entry_date,
                    "exit_date":      day,
                    "entry_price":    entry_price,
                    "exit_price":     close,
                    "holding_days":   holding_days,
                    "abs_return_pct": abs_ret,
                    "ann_return_pct": ann_ret,
                    "pe_at_exit":     round(live_pe, 2) if live_pe else None,
                    "sensex_abs_pct": sensex_abs,
                    "sensex_ann_pct": sensex_ann,
                    "alpha_abs":      round(abs_ret - sensex_abs, 2) if sensex_abs is not None else None,
                    "alpha_ann":      round(ann_ret - sensex_ann, 2) if ann_ret is not None and sensex_ann is not None else None,
                    "exit_type":      "intra_quarter",
                    "status":         "closed",
                    "trigger":        f"ret={abs_ret:.1f}% > {EXIT_RETURN_THRESHOLD}%,  P/E={live_pe:.1f}x > {EXIT_PE_THRESHOLD}x",
                }

                new_exits.append(exit_record)
                existing_exits.add((ticker, entry_date))

                print(f"  {ticker:<15} 🔴 EXIT on {day}:  "
                      f"ret={abs_ret:.1f}%  P/E={live_pe:.1f}x  "
                      f"price=₹{close}  alpha={exit_record['alpha_abs']}%")
                triggered = True
                break   # no re-entry within this quarter

        if not triggered:
            print(f"  {ticker:<15} ✓ held through quarter  "
                  f"(entry ₹{entry_price}  "
                  f"last ₹{prices.get(trading_days[-1]) if trading_days else '—'})")

    # ── save updated daily price cache ──
    if cache_updated:
        with open(cache_path, "w") as f:
            json.dump(daily_cache, f)
        print(f"\n  ✓ Daily price cache saved → {cache_path}")

# ── merge new exits into trade log ───────────────────────────
if new_exits:
    # remove any open trades that were actually exited intra-quarter
    exited_keys = {(e["ticker"], e["entry_date"]) for e in new_exits}
    trade_log = [
        t for t in trade_log
        if not (t["status"] == "open" and
                (t["ticker"], t["entry_date"]) in exited_keys)
    ]
    trade_log.extend(new_exits)
    save_trade_log(trade_log)
    print(f"\n  ✓ {len(new_exits)} intra-quarter exits added to trade log")
else:
    print(f"\n  ✓ No intra-quarter exits triggered across all quarters")
    save_trade_log(trade_log)   # re-save to ensure consistent format

# ── summary ───────────────────────────────────────────────────
intra = [t for t in trade_log if t.get("exit_type") == "intra_quarter"]
rebal = [t for t in trade_log if t.get("exit_type") != "intra_quarter" and t.get("status") == "closed"]
open_ = [t for t in trade_log if t.get("status") == "open"]

print(f"\n{'─'*62}")
print(f"  TRADE LOG SUMMARY")
print(f"  Intra-quarter exits : {len(intra)}")
print(f"  Rebalance exits     : {len(rebal)}")
print(f"  Open positions      : {len(open_)}")

all_closed = intra + rebal
if all_closed:
    rets    = [t["abs_return_pct"] for t in all_closed if t.get("abs_return_pct") is not None]
    alphas  = [t["alpha_abs"]      for t in all_closed if t.get("alpha_abs")      is not None]
    winners = [r for r in rets if r > 0]
    if rets:
        print(f"  Avg closed return   : {sum(rets)/len(rets):.1f}%")
        print(f"  Win rate            : {len(winners)/len(rets)*100:.0f}%  ({len(winners)}/{len(rets)})")
    if alphas:
        print(f"  Avg alpha (abs)     : {sum(alphas)/len(alphas):.1f}%")
print(f"{'─'*62}\n")