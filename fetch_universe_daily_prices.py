"""
fetch_universe_daily_prices.py
─────────────────────────────────────────────────────────────────────────────
Fetches FULL DAILY closing prices (not just rebalance-date marks) for every
ticker that has appeared in any quarterly fundamentals snapshot — the full
~500-stock Nifty 500 universe — across the entire backtest window
(2024-06-25 to 2026-06-25).

WHY THIS EXISTS
  fetch_universe_rebalance_prices.py gave the Build & Test tab one price per
  ticker per quarter — enough for hold-to-rebalance NAV, not enough to
  replicate the live strategy's intra-quarter early-exit rule (return > 20%
  from rebalance AND live P/E > 20x triggers an early exit — see
  monitor_exits.py). That rule needs to be checked on EVERY trading day,
  which needs a full daily series for any ticker a custom filter might
  select — not just the 32 tickers that have ever actually been in the real
  portfolio (data/prices_history.json).

  This script closes that gap.

OUTPUT
  data/historical/universe_daily_prices.json
  Structure: { "<TICKER>": { "<YYYY-MM-DD>": <close>, ... }, ... }
  One entry per ticker that appears in ANY historical fundamentals snapshot.
  Reuses data/prices_history.json directly for the 32 tickers already fully
  covered there, so it only needs to fetch the remaining ~470.

  This file will be the largest in the repo (full daily series x ~500
  tickers x ~2 years). Expect tens of MB. If GitHub or repo-size constraints
  become an issue, the natural follow-up is splitting this by ticker-prefix
  shard or by quarter — flag this to whichever AI platform picks this up
  next rather than silently restructuring it.

RESUMABILITY
  Same incremental-save-and-skip-already-fetched pattern as
  fetch_universe_rebalance_prices.py — safe to kill and rerun. A ticker is
  considered "done" if it's already a key in the output file, REGARDLESS of
  whether its series came back empty (e.g. pre-IPO for the whole window) —
  reruns won't re-hit Yahoo for tickers that legitimately have no data.

USAGE
  pip install requests
  python fetch_universe_daily_prices.py

  ~500 tickers, each one fetch covering the full ~2-year window (NOT 500 x
  9 the way the rebalance-price script worked — here it's one fetch per
  ticker covering the whole range, so total request volume is much lower
  than the data volume might suggest). Still expect this to take a while
  given the per-request payload size and politeness delay between calls.
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
OUT_PATH = os.path.join(HISTORICAL_DIR, "universe_daily_prices.json")
EXISTING_DAILY_HISTORY_PATH = "data/prices_history.json"  # 32-ticker cache, reuse directly
SENSEX_SYMBOL = "^BSESN"

# Full backtest window — matches REBALANCE_DATES start/end with a small
# buffer on each side so the last quarter's exit-day checks have coverage.
WINDOW_START = "2024-06-20"
WINDOW_END = "2026-06-30"

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


def fetch_daily_prices(symbol, date_from, date_to):
    """Returns {date_str: close} for all trading days in [date_from, date_to]."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={int(date_from.timestamp())}"
        f"&period2={int(date_to.timestamp())}"
        f"&interval=1d&events=history"
    )
    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=HEADERS, timeout=20)
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


def load_universe_tickers():
    """All unique tickers across every historical fundamentals_*.csv snapshot."""
    files = sorted(glob.glob(os.path.join(HISTORICAL_DIR, "fundamentals_*.csv")))
    tickers = set()
    for f in files:
        with open(f, newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        tickers |= {row["ticker"].strip() for row in rows if row.get("ticker")}
    return sorted(tickers)


def load_existing_daily_history():
    """Reuse the 32-ticker daily price cache (data/prices_history.json) directly —
    these already have full daily series for the whole window, no need to refetch."""
    if not os.path.exists(EXISTING_DAILY_HISTORY_PATH):
        return {}
    with open(EXISTING_DAILY_HISTORY_PATH) as f:
        raw = json.load(f)
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
        json.dump(data, f, separators=(",", ":"), sort_keys=True)  # compact, this file is large


def main():
    print(f"\n{'─'*62}")
    print("  Universe FULL DAILY price fetch")
    print(f"  Window: {WINDOW_START} to {WINDOW_END}")
    print(f"{'─'*62}\n")

    all_tickers = load_universe_tickers()
    print(f"  Total unique tickers across all quarters: {len(all_tickers)}\n")

    daily_cache = load_existing_daily_history()
    print(f"  Reusable full daily-history tickers: {len(daily_cache)}\n")

    output = load_existing_output()
    already_done = sum(1 for t in all_tickers if t in output)
    print(f"  Already fetched in a prior run: {already_done}\n")

    date_from = datetime.strptime(WINDOW_START, "%Y-%m-%d")
    date_to = datetime.strptime(WINDOW_END, "%Y-%m-%d")

    fetched_count = 0
    empty_count = 0

    for idx, ticker in enumerate(all_tickers, 1):
        if ticker in output:
            continue  # already resolved (price series or confirmed-empty) in a prior run

        if ticker in daily_cache:
            prices = daily_cache[ticker]
            print(f"  [{idx}/{len(all_tickers)}] {ticker:<15} \u2192 reused from prices_history.json ({len(prices)} days)")
        else:
            symbol = f"{ticker}.NS"
            prices = fetch_daily_prices(symbol, date_from, date_to)
            status = f"{len(prices)} days" if prices else "no data (likely pre-IPO/delisted)"
            print(f"  [{idx}/{len(all_tickers)}] {ticker:<15} \u2192 {status}")
            time.sleep(0.1)  # be polite to the unofficial endpoint

        output[ticker] = prices  # store even if empty — marks it as attempted
        fetched_count += 1
        if not prices:
            empty_count += 1

        # incremental save every 20 tickers — this file is large, don't lose progress
        if fetched_count % 20 == 0:
            save_output(output)
            print(f"    \u2192 progress saved ({idx}/{len(all_tickers)} tickers, {fetched_count} fetched this run)")

    # SENSEX too, for the daily-NAV benchmark comparison
    if SENSEX_SYMBOL not in output:
        if SENSEX_SYMBOL in daily_cache:
            output[SENSEX_SYMBOL] = daily_cache[SENSEX_SYMBOL]
        else:
            output[SENSEX_SYMBOL] = fetch_daily_prices(SENSEX_SYMBOL, date_from, date_to)

    save_output(output)

    print(f"\n{'─'*62}")
    print("  Done.")
    print(f"  Tickers with data : {sum(1 for v in output.values() if v)}")
    print(f"  Tickers empty      : {sum(1 for v in output.values() if not v)}")
    print(f"  Output: {OUT_PATH}")
    size_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
    print(f"  File size: {size_mb:.1f} MB")
    print(f"{'─'*62}\n")


if __name__ == "__main__":
    main()