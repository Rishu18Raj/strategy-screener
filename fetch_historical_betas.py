"""
fetch_historical_betas.py
─────────────────────────────────────────────────────────────────────────────
Computes 3Y trailing beta for all tickers in fundamentals.csv as of a given
rebalance date. Outputs data/historical/betas_YYYYQN.json.

Usage:
  python fetch_historical_betas.py --date 2024-06-25
  python fetch_historical_betas.py --date 2024-09-25
  ... (run once per rebalance date)

Requirements:
  pip install pandas requests
─────────────────────────────────────────────────────────────────────────────
"""

import argparse
import json
import os
import time
from datetime import datetime, timedelta

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── cli ───────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--date",    required=True, help="Rebalance date YYYY-MM-DD")
parser.add_argument("--input",   default="data/fundamentals.csv")
parser.add_argument("--out-dir", default="data/historical")
parser.add_argument("--lookback-years", type=int, default=3)
args = parser.parse_args()

REBALANCE_DATE = datetime.strptime(args.date, "%Y-%m-%d")
LOOKBACK_YEARS = args.lookback_years
BENCHMARK      = "^CRSLDX"   # Nifty 500
os.makedirs(args.out_dir, exist_ok=True)

# ── quarter label ─────────────────────────────────────────────
def quarter_label(date):
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[date.month]
    return f"{date.year}{q}"

LABEL    = quarter_label(REBALANCE_DATE)
OUT_PATH = os.path.join(args.out_dir, f"betas_{LABEL}.json")

print(f"\n{'─'*58}")
print(f"  Rebalance date : {REBALANCE_DATE.strftime('%d %b %Y')}")
print(f"  Beta window    : {LOOKBACK_YEARS}Y trailing")
print(f"  Benchmark      : Nifty 500 ({BENCHMARK})")
print(f"  Output         : {OUT_PATH}")
print(f"{'─'*58}\n")

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

# ── Yahoo Finance fetch ───────────────────────────────────────
def fetch_prices(symbol, date_from, date_to):
    """
    Returns {date_str: close_price} for the given symbol and date range.
    """
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
            data      = r.json()
            result    = data["chart"]["result"][0]
            timestamps = result["timestamp"]
            closes    = result["indicators"]["quote"][0]["close"]
            prices    = {}
            for ts, c in zip(timestamps, closes):
                if c is not None:
                    d = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                    prices[d] = c
            return prices
        except (KeyError, IndexError):
            return {}
        except Exception as e:
            if attempt < 2:
                time.sleep(5)
            else:
                return {}
    return {}

# ── beta computation ──────────────────────────────────────────
def aligned_returns(prices_a, prices_b):
    """Returns (ret_a, ret_b, n_common_days) aligned on common dates."""
    common = sorted(set(prices_a) & set(prices_b))
    if len(common) < 60:
        return None, None, len(common)
    ca = [prices_a[d] for d in common]
    cb = [prices_b[d] for d in common]
    ra = [(ca[i] - ca[i-1]) / ca[i-1] for i in range(1, len(ca))]
    rb = [(cb[i] - cb[i-1]) / cb[i-1] for i in range(1, len(cb))]
    return ra, rb, len(common)

def compute_beta(ra, rb):
    n  = len(ra)
    sm = sum(ra) / n
    bm = sum(rb) / n
    cov  = sum((ra[i] - sm) * (rb[i] - bm) for i in range(n))
    varb = sum((rb[i] - bm) ** 2           for i in range(n))
    return round(cov / varb, 4) if varb else 1.0

# ── date range ────────────────────────────────────────────────
date_to   = REBALANCE_DATE - timedelta(days=1)
date_from = REBALANCE_DATE - timedelta(days=LOOKBACK_YEARS * 365 + 30)

# ── load tickers ──────────────────────────────────────────────
df = pd.read_csv(args.input)
df.columns = [c.strip().lower() for c in df.columns]
tickers = [str(t).strip() for t in df["ticker"].tolist()]
total   = len(tickers)

# ── fetch benchmark once ──────────────────────────────────────
print(f"Fetching benchmark ({BENCHMARK})...")
bench_prices = fetch_prices(BENCHMARK, date_from, date_to)
if not bench_prices:
    print("✗ Could not fetch benchmark. Exiting.")
    exit(1)
print(f"✓ Benchmark: {len(bench_prices)} trading days\n")

# ── main loop ─────────────────────────────────────────────────
results = {}
failed  = []

for idx, ticker in enumerate(tickers, 1):
    yahoo_sym = f"{ticker}.NS"
    print(f"[{idx:>3}/{total}] {ticker:<15}", end="  ")

    prices = fetch_prices(yahoo_sym, date_from, date_to)
    if not prices:
        print("✗ no price data")
        results[ticker] = None
        failed.append((ticker, "no price data"))
        time.sleep(0.4)
        continue

    ra, rb, n_days = aligned_returns(prices, bench_prices)
    if ra is None:
        print(f"✗ insufficient common days ({n_days})")
        results[ticker] = None
        failed.append((ticker, f"only {n_days} common days"))
        time.sleep(0.4)
        continue

    beta = compute_beta(ra, rb)
    results[ticker] = beta
    print(f"β = {beta:<8}  ({n_days} days)")
    time.sleep(0.1)

# ── write output ──────────────────────────────────────────────
with open(OUT_PATH, "w") as f:
    json.dump(results, f, indent=2)

print(f"\n{'─'*58}")
print(f"  ✓  Output : {OUT_PATH}")
print(f"  ✓  Success: {total - len(failed)} / {total}")
if failed:
    print(f"  ✗  Failed ({len(failed)}):")
    for t, reason in failed:
        print(f"     {t:<15} {reason}")
print(f"{'─'*58}\n")