"""
fetch_historical_prices.py
─────────────────────────────────────────────────────────────────────────────
Fetches daily EOD prices for:
  - Every stock that has ever appeared in any portfolio
  - SENSEX (^BSESN) as benchmark

Date range: first rebalance date → today

Outputs:
  data/prices_history.json   {symbol: {date: close_price}}

Usage:
  python fetch_historical_prices.py
─────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import time
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

HISTORICAL_DIR  = "data/historical"
OUT_PATH        = "data/prices_history.json"
SENSEX_SYMBOL   = "^BSESN"

REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

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

def quarter_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[d.month]
    return f"{d.year}{q}"

def fetch_prices(symbol, date_from, date_to):
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
                print(f"  ⏳ Rate limited. Waiting {wait}s...")
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
                    prices[datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")] = round(c, 2)
            return prices
        except (KeyError, IndexError):
            return {}
        except Exception:
            if attempt < 2:
                time.sleep(5)
    return {}

# ── collect all tickers ever in any portfolio ─────────────────
all_tickers = set()
for date_str in REBALANCE_DATES:
    label = quarter_label(date_str)
    path  = os.path.join(HISTORICAL_DIR, f"portfolio_{label}.json")
    if not os.path.exists(path):
        continue
    with open(path) as f:
        data = json.load(f)
    for s in data.get("stocks", []):
        t = s.get("ticker","").strip()
        if t:
            all_tickers.add(t)

# also pull from trade log for any exited tickers
trade_log_path = "data/trade_log.json"
if os.path.exists(trade_log_path):
    with open(trade_log_path) as f:
        for t in json.load(f):
            tk = t.get("ticker","").strip()
            if tk:
                all_tickers.add(tk)

date_from = datetime.strptime(REBALANCE_DATES[0],  "%Y-%m-%d") - timedelta(days=1)
date_to   = datetime.today()

print(f"\n{'─'*58}")
print(f"  Fetching prices for {len(all_tickers)} stocks + SENSEX")
print(f"  Range: {REBALANCE_DATES[0]} → {date_to.strftime('%Y-%m-%d')}")
print(f"{'─'*58}\n")

# ── load existing cache if any ────────────────────────────────
if os.path.exists(OUT_PATH):
    with open(OUT_PATH) as f:
        prices_history = json.load(f)
    print(f"  Loaded existing cache ({len(prices_history)} symbols)\n")
else:
    prices_history = {}

# ── fetch SENSEX ──────────────────────────────────────────────
print(f"  Fetching SENSEX ({SENSEX_SYMBOL})...")
prices_history[SENSEX_SYMBOL] = fetch_prices(SENSEX_SYMBOL, date_from, date_to)
print(f"  ✓ SENSEX: {len(prices_history[SENSEX_SYMBOL])} days\n")
time.sleep(0.1)

# ── fetch each stock ──────────────────────────────────────────
tickers_sorted = sorted(all_tickers)
total = len(tickers_sorted)

failed = []
for idx, ticker in enumerate(tickers_sorted, 1):
    yahoo_sym = f"{ticker}.NS"
    print(f"  [{idx:>3}/{total}] {ticker:<15}", end="  ")

    prices = fetch_prices(yahoo_sym, date_from, date_to)
    if prices:
        prices_history[yahoo_sym] = prices
        print(f"✓ {len(prices)} days")
    else:
        print(f"✗ no data")
        failed.append(ticker)
    time.sleep(0.1)

# ── save ──────────────────────────────────────────────────────
with open(OUT_PATH, "w") as f:
    json.dump(prices_history, f)

print(f"\n{'─'*58}")
print(f"  ✓ Saved → {OUT_PATH}")
print(f"  ✓ Symbols: {len(prices_history)}")
if failed:
    print(f"  ✗ Failed: {failed}")
print(f"{'─'*58}\n")