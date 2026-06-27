"""
fetch_historical_fundamentals.py
─────────────────────────────────────────────────────────────────────────────
Builds a fundamentals snapshot for any rebalance date by:
  1. Scraping Screener.in P&L + Balance Sheet for annual Revenue, EPS, Net
     Profit, Equity — keyed to the correct 5-FY window for the rebalance date.
  2. Attempting Consolidated first; if core metrics (RoE, RevCAGR, EpsCAGR)
     contain missing values, it auto-falls back to Standalone view.
  3. Scraping quarterly results to compute TTM EPS.
  4. Fetching T-1 close price from Yahoo Finance to compute live P/E.
  5. Computing:
       - 5Y Revenue CAGR
       - 5Y EPS CAGR
       - 5Y Average RoE  (avg Net Profit / avg Equity across 5 FYs)
       - P/E             (T-1 price / TTM EPS)

Usage:
  python fetch_historical_fundamentals.py --date 2024-06-25

Output:
  data/historical/fundamentals_2024Q2.csv
─────────────────────────────────────────────────────────────────────────────
"""

import argparse
import csv
import json
import math
import os
import re
import time
from datetime import datetime, timedelta

import pandas as pd
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── cli ───────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--date", required=True,
                    help="Rebalance date in YYYY-MM-DD format, e.g. 2024-06-25")
parser.add_argument("--input",  default="data/fundamentals.csv",
                    help="Path to Nifty 500 ticker list CSV (needs 'ticker' and 'sector' columns)")
parser.add_argument("--output-dir", default="data/historical",
                    help="Output directory for the snapshot CSV")
args = parser.parse_args()

REBALANCE_DATE = datetime.strptime(args.date, "%Y-%m-%d")

# ── FY window logic ───────────────────────────────────────────
def fy_end_year(date):
    """Most recently completed Indian FY end year as of `date`."""
    if date.month <= 3:
        return date.year - 1
    return date.year

FY_END   = fy_end_year(REBALANCE_DATE)
FY_START = FY_END - 4          
WINDOW   = list(range(FY_START, FY_END + 1))   

def fy_col(year):
    return f"Mar {year}"

print(f"\n{'─'*60}")
print(f"  Rebalance date : {REBALANCE_DATE.strftime('%d %b %Y')}")
print(f"  FY window      : FY{FY_START} – FY{FY_END}  ({fy_col(FY_START)} → {fy_col(FY_END)})")
print(f"{'─'*60}\n")

# ── quarter label for output filename ─────────────────────────
def quarter_label(date):
    m = date.month
    y = date.year
    if   m in (1,2,3):   return f"{y}Q1"
    elif m in (4,5,6):   return f"{y}Q2"
    elif m in (7,8,9):   return f"{y}Q3"
    else:                 return f"{y}Q4"

OUT_LABEL = quarter_label(REBALANCE_DATE)
os.makedirs(args.output_dir, exist_ok=True)
OUT_PATH  = os.path.join(args.output_dir, f"fundamentals_{OUT_LABEL}.csv")

# ── http session ──────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

def make_session():
    s = requests.Session()
    retry = Retry(connect=3, read=3, backoff_factor=3,
                  status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("http://",  adapter)
    s.mount("https://", adapter)
    return s

SESSION = make_session()

# ── screener fetcher ──────────────────────────────────────────
def fetch_soup(ticker, variant="consolidated"):
    url = f"https://www.screener.in/company/{ticker}/{variant}/"
    for attempt in range(3):
        try:
            r = SESSION.get(url, headers=HEADERS, timeout=12)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 30))
                print(f"\n  ⏳ Rate limited by Screener. Waiting {wait}s...")
                time.sleep(wait)
                continue
            if r.status_code != 200:
                return None
            return BeautifulSoup(r.text, "lxml")
        except requests.exceptions.ConnectionError:
            print(f"\n  ⚠  Connection error on {ticker} (attempt {attempt+1}/3). Retrying in 10s...")
            time.sleep(10)
        except requests.exceptions.Timeout:
            print(f"\n  ⚠  Timeout on {ticker} (attempt {attempt+1}/3). Retrying in 5s...")
            time.sleep(5)
        except Exception as e:
            print(f"\n  ⚠  Unexpected error on {ticker}: {e}")
            return None
    return None

# ── table parsing ─────────────────────────────────────────────
def parse_annual_table(soup, section_id):
    section = soup.find("section", id=section_id)
    if not section:
        return {}
    tbl = section.find("table")
    if not tbl:
        return {}

    headers = []
    for th in tbl.find_all("th"):
        headers.append(th.get_text(strip=True))

    data = {}
    for tr in tbl.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        row_label = cells[0].get_text(strip=True).replace("+", "").strip()
        row_data  = {}
        for i, td in enumerate(cells[1:], start=1):
            if i >= len(headers):
                break
            raw = td.get_text(strip=True).replace(",", "").replace("%", "")
            try:
                row_data[headers[i]] = float(raw)
            except ValueError:
                row_data[headers[i]] = None
        data[row_label] = row_data
    return data

def parse_quarterly_table(soup):
    section = soup.find("section", id="quarters")
    if not section:
        return {}
    tbl = section.find("table")
    if not tbl:
        return {}

    headers = []
    for th in tbl.find_all("th"):
        headers.append(th.get_text(strip=True))

    rows_by_label = {}
    for tr in tbl.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        row_label = cells[0].get_text(strip=True).replace("+", "").strip()
        for i, td in enumerate(cells[1:], start=1):
            if i >= len(headers):
                break
            col = headers[i]
            raw = td.get_text(strip=True).replace(",","").replace("%","")
            try:
                val = float(raw)
            except ValueError:
                val = None
            rows_by_label.setdefault(row_label, {})[col] = val
    return rows_by_label

# ── TTM EPS ───────────────────────────────────────────────────
def get_ttm_eps(soup, as_of_date):
    qtable = parse_quarterly_table(soup)
    eps_row = None
    for label, vals in qtable.items():
        if re.search(r"EPS in Rs\b", label, re.IGNORECASE):
            eps_row = vals
            break
    if not eps_row:
        return None

    def col_to_date(col):
        try:
            return datetime.strptime(col, "%b %Y")
        except Exception:
            return None

    dated = []
    for col, val in eps_row.items():
        d = col_to_date(col)
        if d and d < as_of_date and val is not None:
            dated.append((d, val))
    dated.sort(key=lambda x: x[0], reverse=True)

    if len(dated) < 4:
        return None
    ttm = sum(v for _, v in dated[:4])
    return ttm

# ── Yahoo Finance price fetch ─────────────────────────────────
YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

def get_t1_price(ticker, as_of_date):
    yahoo_sym = f"{ticker}.NS"
    t1   = as_of_date - timedelta(days=1)
    frm  = int((t1 - timedelta(days=10)).timestamp())
    to   = int(t1.timestamp())
    url  = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}"
        f"?period1={frm}&period2={to}&interval=1d&events=history"
    )
    try:
        r = SESSION.get(url, headers=YAHOO_HEADERS, timeout=12)
        if r.status_code != 200:
            return None
        data   = r.json()
        result = data["chart"]["result"][0]
        closes = result["indicators"]["quote"][0]["close"]
        closes = [c for c in closes if c is not None]
        return round(closes[-1], 2) if closes else None
    except Exception:
        return None

# ── metric computation ────────────────────────────────────────
def cagr(start, end, years):
    if start is None or end is None or years <= 0:
        return None
    # If the company started with losses OR ended with losses, CAGR is mathematically undefined/invalid
    if start <= 0 or end <= 0:          
        return None
        
    # Now (end / start) is guaranteed to be positive, preventing complex imaginary numbers
    return round(((end / start) ** (1 / years) - 1) * 100, 2)

def avg_roe(pl, bs, window):
    roes = []
    for yr in window:
        col_curr = fy_col(yr)
        col_prev = fy_col(yr - 1)

        net_profit = (pl.get("Net Profit", {}).get(col_curr) or
                      pl.get("Profit after tax", {}).get(col_curr))

        eq_cap_curr  = bs.get("Equity Capital", {}).get(col_curr) or bs.get("Share Capital", {}).get(col_curr)
        res_curr     = bs.get("Reserves", {}).get(col_curr)
        eq_cap_prev  = bs.get("Equity Capital", {}).get(col_prev) or bs.get("Share Capital", {}).get(col_prev)
        res_prev     = bs.get("Reserves", {}).get(col_prev)

        if None in (net_profit, eq_cap_curr, res_curr, eq_cap_prev, res_prev):
            continue

        eq_curr = eq_cap_curr + res_curr
        eq_prev = eq_cap_prev + res_prev
        avg_eq  = (eq_curr + eq_prev) / 2

        if avg_eq <= 0:
            continue
        roes.append((net_profit / avg_eq) * 100)

    return round(sum(roes) / len(roes), 2) if roes else None

# ── main loop ─────────────────────────────────────────────────
tickers_df = pd.read_csv(args.input)
tickers_df.columns = [c.strip().lower() for c in tickers_df.columns]
tickers = list(zip(tickers_df["ticker"], tickers_df["sector"]))

results  = []
failures = []
total    = len(tickers)

COL_START = fy_col(FY_START)
COL_END   = fy_col(FY_END)

print(f"Processing {total} tickers...\n")

for idx, (ticker, sector) in enumerate(tickers, 1):
    ticker = str(ticker).strip()
    sector = str(sector).strip()
    print(f"[{idx:>3}/{total}] {ticker:<15}", end="  ")

    # Data container that will persist our best extraction outcome
    final_row = {
        "ticker": ticker, "name": None, "sector": sector,
        "roe": None, "revCAGR": None, "epsCAGR": None,
        "pe": None, "fy_window": f"FY{FY_START}-FY{FY_END}",
        "rebalance_date": args.date,
    }

    # Sequence variants: check Consolidated first, fallback to Stand-Alone ('') if metric metrics are null
    variants = ["consolidated", ""]
    
    for variant in variants:
        soup = fetch_soup(ticker, variant)
        if soup is None:
            continue

        name_tag = soup.find("h1", class_="shrink-text")
        final_row["name"] = name_tag.get_text(strip=True) if name_tag else ticker

        pl  = parse_annual_table(soup, "profit-loss")
        bs  = parse_annual_table(soup, "balance-sheet")

        rev_row = pl.get("Revenue") or pl.get("Sales") or pl.get("Net Sales") or pl.get("Total Revenue")
        if rev_row:
            rev_start = rev_row.get(COL_START)
            rev_end   = rev_row.get(COL_END)
            final_row["revCAGR"] = cagr(rev_start, rev_end, 5)

        eps_row = pl.get("EPS in Rs") or pl.get("EPS")
        if eps_row:
            eps_start = eps_row.get(COL_START)
            eps_end   = eps_row.get(COL_END)
            final_row["epsCAGR"] = cagr(eps_start, eps_end, 5)

        final_row["roe"] = avg_roe(pl, bs, WINDOW)

        ttm_eps = get_ttm_eps(soup, REBALANCE_DATE)
        if ttm_eps and ttm_eps > 0:
            price = get_t1_price(ticker, REBALANCE_DATE)
            if price:
                final_row["pe"] = round(price / ttm_eps, 2)

        # Output quality control check: are any core historical inputs missing?
        missing_core = [k for k in ("roe", "revCAGR", "epsCAGR") if final_row[k] is None]
        
        # If we successfully populated all core historical data, we stop looking.
        if not missing_core:
            break
        else:
            if variant == "consolidated":
                # Clear standard metrics out before running standalone to ensure fresh evaluation
                final_row["pe"] = None 
                time.sleep(0.5) # Quick pause before requesting the fallback page

    # Post-Loop Logging Metrics
    missing = [k for k in ("roe","revCAGR","epsCAGR","pe") if final_row[k] is None]
    if missing:
        print(f"⚠  missing: {', '.join(missing)}")
        failures.append((ticker, f"missing: {', '.join(missing)}"))
    else:
        print(f"✓  RoE={final_row['roe']:.1f}%  RevCAGR={final_row['revCAGR']:.1f}%  "
              f"EpsCAGR={final_row['epsCAGR']:.1f}%  PE={final_row['pe']:.1f}x")

    results.append(final_row)
    time.sleep(0.5)     

out_df = pd.DataFrame(results)
cols = ["ticker","name","sector","roe","revCAGR","epsCAGR","pe","fy_window","rebalance_date"]
out_df = out_df[[c for c in cols if c in out_df.columns]]
out_df.to_csv(OUT_PATH, index=False)

print(f"\n{'─'*60}")
print(f"  Output : {OUT_PATH}")
print(f"  Total  : {total}")
print(f"  Success: {total - len(failures)}")
print(f"  Partial: {len(failures)}")
if failures:
    print(f"\n  Failed tickers:")
    for t, reason in failures:
        print(f"    {t:<15} {reason}")
print(f"{'─'*60}\n")