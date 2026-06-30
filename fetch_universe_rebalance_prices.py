"""
fetch_universe_rebalance_prices.py
─────────────────────────────────────────────────────────────────────────────
Fetches the closing price (on or just before each rebalance date) for EVERY
ticker that has appeared in any quarterly fundamentals snapshot — i.e. the
full ~500-stock Nifty 500 universe — at each of the 9 historical rebalance
dates.

WHY THIS EXISTS
  The existing data/historical/daily_prices_YYYYQN.json files only cover the
  6-9 tickers that were ACTUALLY in the real portfolio each quarter. That's
  enough to replay the real strategy's trade log, but not enough to backtest
  a CUSTOM filter (e.g. user drags P/E from 20 -> 25 in the Build & Test
  tab) — a looser filter pulls in tickers that were filtered out of the real
  portfolio and therefore have no price history anywhere in this repo.

  This script closes that gap by fetching ONE price per (ticker, rebalance
  date) pair for the full universe — not full daily series, just the
  rebalance-date marks needed to compute quarter-over-quarter returns for
  ANY custom filter combination. This intentionally does NOT enable
  intra-quarter early-exit modeling for custom backtests (that still
  requires full daily series, which remains out of scope here) — custom
  backtests will assume hold-to-next-rebalance. This is a known, documented
  limitation, not an oversight — see Regista_README.md Section 2 if you're
  an AI platform picking this project back up.

OUTPUT
  data/historical/universe_rebalance_prices.json
  Structure: { "<rebalance_date>": { "<ticker>": <close_price_or_null>, ... }, ... }
  One entry per rebalance date, one price per ticker that existed in that
  quarter's fundamentals.csv (tickers that IPO'd later simply won't appear
  in earlier dates' fundamentals, so we don't try to fetch them then).

RESUMABILITY
  Writes the output file incrementally (after each rebalance date completes)
  so the script can be killed and rerun without losing progress — it skips
  any (date, ticker) pair that's already present in the existing output
  file, including pairs that resolved to null (already attempted, no data
  found), so a rerun doesn't re-hit Yahoo for tickers that simply have no
  data (e.g. delisted, pre-IPO).

USAGE
  pip install requests
  python fetch_universe_rebalance_prices.py

  Expect this to take a while: up to 500 tickers x 9 dates = 4500 fetches
  in the worst case, though in practice far fewer since dates are batched
  per ticker (one fetch per ticker covers all 9 dates if the ticker existed
  for that whole window) and the 32 tickers already in data/prices_history.json
  are reused directly without hitting Yahoo at all.
─────────────────────────────────────────────────────────────────────────────
"""

import csv
import glob
import json
import os
import time
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

HISTORICAL_DIR = "data/historical"
OUT_PATH = os.path.join(HISTORICAL_DIR, "universe_rebalance_prices.json")
EXISTING_DAILY_HISTORY_PATH = "data/prices_history.json"  # 32-ticker cache, reuse if present
SENSEX_SYMBOL = "^BSESN"

REBALANCE_DATES = [
    "2024-06-25", "2024-09-25", "2024-12-25", "2025-03-25",
    "2025-06-25", "2025-09-25", "2025-12-25", "2026-03-25", "2026-06-25",
]

LOOKBACK_DAYS = 5  # walk back up to N days for weekends/holidays, matching
                    # the get_close() convention in build_portfolios_and_exits.py

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
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


SESSION = make_session()


def fetch_prices(symbol, date_from, date_to):
    """Returns {date_str: close} for all trading days in [date_from, date_to]."""
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
                print(f"    \u23f3 Rate limited. Waiting {wait}s...")
                time.sleep(wait)
                continue
            if r.status_code != 200:
                return {}
            data = r.json()
            result = data["chart"]["result"][0]
            ts = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            prices = {}
            for t, c in zip(ts, closes):
                if c is not None:
                    prices[datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")] = round(c, 2)
            return prices
        except (KeyError, IndexError, TypeError):
            return {}
        except Exception:
            if attempt < 2:
                time.sleep(5)
    return {}


def get_close_on_or_before(prices, date_str, lookback=LOOKBACK_DAYS):
    """Walk back from date_str (inclusive) up to `lookback` days to find a close."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    for i in range(lookback):
        ds = (d - timedelta(days=i)).strftime("%Y-%m-%d")
        if ds in prices:
            return prices[ds]
    return None


def load_universe_per_quarter():
    """Returns {rebalance_date: set(tickers)} from each quarter's fundamentals.csv."""
    universe = {}
    for date in REBALANCE_DATES:
        # quarter label matches the existing fundamentals_YYYYQN.csv naming
        d = datetime.strptime(date, "%Y-%m-%d")
        q = {1: "Q1", 2: "Q1", 3: "Q1", 4: "Q2", 5: "Q2", 6: "Q2",
             7: "Q3", 8: "Q3", 9: "Q3", 10: "Q4", 11: "Q4", 12: "Q4"}[d.month]
        label = f"{d.year}{q}"
        path = os.path.join(HISTORICAL_DIR, f"fundamentals_{label}.csv")
        if not os.path.exists(path):
            print(f"  \u2717 {path} not found \u2014 skipping {date}")
            universe[date] = set()
            continue
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        universe[date] = {row["ticker"].strip() for row in rows if row.get("ticker")}
    return universe


def load_existing_daily_history():
    """Reuse the 32-ticker daily price cache (data/prices_history.json) if present,
    to avoid re-fetching tickers we already have full daily series for."""
    if not os.path.exists(EXISTING_DAILY_HISTORY_PATH):
        return {}
    with open(EXISTING_DAILY_HISTORY_PATH) as f:
        raw = json.load(f)
    # keys in that file are like "AADHARHFC.NS" -> strip suffix for matching
    out = {}
    for sym, series in raw.items():
        ticker = sym.replace(".NS", "").replace("^BSESN", SENSEX_SYMBOL)
        out[ticker] = series
    return out


def load_existing_output():
    if not os.path.exists(OUT_PATH):
        return {}
    with open(OUT_PATH) as f:
        return json.load(f)


def save_output(data):
    os.makedirs(HISTORICAL_DIR, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def main():
    print(f"\n{'─'*62}")
    print("  Universe rebalance-date price fetch")
    print(f"  {len(REBALANCE_DATES)} rebalance dates, full Nifty 500 universe")
    print(f"{'─'*62}\n")

    universe_per_quarter = load_universe_per_quarter()
    all_tickers = sorted(set().union(*universe_per_quarter.values())) if universe_per_quarter else []
    print(f"  Total unique tickers across all quarters: {len(all_tickers)}\n")

    daily_cache = load_existing_daily_history()
    print(f"  Reusable full daily-history tickers: {len(daily_cache)}\n")

    output = load_existing_output()
    for date in REBALANCE_DATES:
        output.setdefault(date, {})

    earliest = datetime.strptime(REBALANCE_DATES[0], "%Y-%m-%d") - timedelta(days=LOOKBACK_DAYS + 2)
    latest = datetime.strptime(REBALANCE_DATES[-1], "%Y-%m-%d") + timedelta(days=2)

    for idx, ticker in enumerate(all_tickers, 1):
        # which rebalance dates actually need this ticker
        needed_dates = [d for d in REBALANCE_DATES if ticker in universe_per_quarter.get(d, set())]
        # skip dates already resolved (price or confirmed-null) in existing output
        pending_dates = [d for d in needed_dates if ticker not in output.get(d, {})]
        if not pending_dates:
            continue

        print(f"  [{idx}/{len(all_tickers)}] {ticker:<15} ({len(pending_dates)} dates pending)")

        if ticker in daily_cache:
            prices = daily_cache[ticker]
        else:
            symbol = f"{ticker}.NS"
            prices = fetch_prices(symbol, earliest, latest)
            time.sleep(0.1)  # be polite to the unofficial endpoint

        for date in pending_dates:
            close = get_close_on_or_before(prices, date)
            output[date][ticker] = close  # may be None — that's a valid, cached result

        # incremental save every 25 tickers so progress isn't lost on interruption
        if idx % 25 == 0:
            save_output(output)
            print(f"    \u2192 progress saved ({idx}/{len(all_tickers)} tickers)")

    # also store SENSEX closes at each rebalance date for convenience
    if SENSEX_SYMBOL not in daily_cache:
        sensex_prices = fetch_prices(SENSEX_SYMBOL, earliest, latest)
    else:
        sensex_prices = daily_cache[SENSEX_SYMBOL]
    for date in REBALANCE_DATES:
        output[date][SENSEX_SYMBOL] = get_close_on_or_before(sensex_prices, date)

    save_output(output)

    # summary
    print(f"\n{'─'*62}")
    print("  Done. Coverage summary:")
    for date in REBALANCE_DATES:
        have = sum(1 for v in output[date].values() if v is not None)
        total = len(output[date])
        print(f"    {date}: {have}/{total} tickers resolved")
    print(f"\n  Output: {OUT_PATH}")
    print(f"{'─'*62}\n")


if __name__ == "__main__":
    main()