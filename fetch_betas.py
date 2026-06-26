import csv
import json
import time
import requests
from datetime import datetime, timedelta

# ── config ────────────────────────────────────────────────────
FUNDAMENTALS_CSV = "data/fundamentals.csv"   # path relative to repo root
OUTPUT_JSON      = "data/betas.json"
LOOKBACK_YEARS   = 3
BENCHMARK_SYMBOL = "^CRSLDX"                 # Nifty 500 on Yahoo Finance

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

# ── step 1: read tickers from csv ─────────────────────────────
def load_tickers(path):
    tickers = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            t = row.get("ticker", "").strip()
            if t:
                tickers.append(t)
    print(f"✓ Loaded {len(tickers)} tickers from {path}\n")
    return tickers

# ── step 2: yahoo finance fetch ───────────────────────────────
def fetch_yahoo(symbol, period1, period2):
    """Returns {date_str: close} dict."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={period1}&period2={period2}&interval=1d&events=history"
    )
    r = requests.get(url, headers=HEADERS, timeout=15)
    if r.status_code != 200:
        raise Exception(f"HTTP {r.status_code}")
    data   = r.json()
    result = data["chart"]["result"][0]
    timestamps = result["timestamp"]
    closes     = result["indicators"]["quote"][0]["close"]
    prices = {}
    for ts, c in zip(timestamps, closes):
        if c is not None:
            date = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
            prices[date] = c
    return prices

# ── step 3: aligned returns ───────────────────────────────────
def aligned_returns(prices_a, prices_b):
    common = sorted(set(prices_a) & set(prices_b))
    if len(common) < 60:
        raise Exception(f"Only {len(common)} common dates")
    ca = [prices_a[d] for d in common]
    cb = [prices_b[d] for d in common]
    ra = [(ca[i]-ca[i-1])/ca[i-1] for i in range(1, len(ca))]
    rb = [(cb[i]-cb[i-1])/cb[i-1] for i in range(1, len(cb))]
    return ra, rb, len(common)

# ── step 4: beta ──────────────────────────────────────────────
def compute_beta(rs, rb):
    n = len(rs)
    sm, bm = sum(rs)/n, sum(rb)/n
    cov  = sum((rs[i]-sm)*(rb[i]-bm) for i in range(n))
    varb = sum((rb[i]-bm)**2 for i in range(n))
    return round(cov/varb, 4) if varb else 1.0

# ── main ──────────────────────────────────────────────────────
def main():
    now  = int(datetime.now().timestamp())
    past = int((datetime.now() - timedelta(days=LOOKBACK_YEARS*365+30)).timestamp())

    tickers = load_tickers(FUNDAMENTALS_CSV)

    # fetch benchmark
    print("Fetching Nifty 500 benchmark...")
    try:
        bench = fetch_yahoo(BENCHMARK_SYMBOL, past, now)
        print(f"✓ Benchmark: {len(bench)} days\n")
    except Exception as e:
        print(f"✗ Benchmark fetch failed: {e}")
        return

    results = {}
    failed  = []
    total   = len(tickers)

    for i, ticker in enumerate(tickers, 1):
        yahoo_sym = f"{ticker}.NS"
        try:
            prices       = fetch_yahoo(yahoo_sym, past, now)
            rs, rb, days = aligned_returns(prices, bench)
            beta         = compute_beta(rs, rb)
            results[ticker] = beta
            print(f"[{i:>3}/{total}] ✓ {ticker:<15}  beta = {beta:<8}  ({days} days)")
        except Exception as e:
            results[ticker] = None
            failed.append((ticker, str(e)))
            print(f"[{i:>3}/{total}] ✗ {ticker:<15}  {e}")
        time.sleep(0.4)   # ~2.5 req/s — polite to Yahoo

    # write output
    with open(OUTPUT_JSON, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n── Done ──────────────────────────────────────")
    print(f"✓ {len(results) - len(failed)} betas computed successfully")
    print(f"✗ {len(failed)} failed")
    if failed:
        print("\nFailed tickers (check Yahoo Finance symbol):")
        for t, err in failed:
            print(f"  {t}: {err}")
    print(f"\n✓ Output written to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()