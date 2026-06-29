"""
build_portfolios_and_exits.py
─────────────────────────────────────────────────────────────────────────────
Single script that iterates through all rebalance dates sequentially:

  For each quarter:
    1. Build portfolio snapshot (5-filter screen + sector cap + G/P rank)
    2. Match against previous portfolio:
       - Carry forward entry_price / entry_date for held stocks
       - Log rebalance exits for stocks leaving the portfolio
       - Skip stocks already intra-exited in the previous quarter
    3. Run intra-quarter exit monitor on daily prices
       - Trigger: return > 20% from rebal_price AND P/E > 20x
       - P&L: calculated from original entry_price
    4. Save snapshot JSON and update trade log

Outputs:
  data/historical/portfolio_YYYYQN.json   ← one per rebalance date
  data/trade_log.json                     ← all trades (rebal + intra)
  data/portfolio_current.json             ← latest portfolio for UI
─────────────────────────────────────────────────────────────────────────────
"""

import json
import math
import os
import time
from datetime import datetime, timedelta

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── config ────────────────────────────────────────────────────
SELECTED_SECTORS = {
    "Banks","Financial Services","Media Entertainment & Publication",
    "Information Technology","Telecommunication","Capital Goods",
    "Construction","Consumer Services","Chemicals",
    "Oil Gas & Consumable Fuels","Power","Textiles",
}

FILTERS_FIXED = dict(roe=13, revCAGR=7, beta=1.2)

RELAXATION_ROUNDS = [
    (10, 20, 0, "base"),
    (10, 25, 1, "pe_relaxed"),
    (9,  25, 2, "eps_9_pe_25"),
    (8,  25, 3, "eps_8_pe_25"),
    (7,  25, 4, "eps_7_pe_25"),
]

MIN_PORTFOLIO_SIZE  = 6
EXIT_RETURN_THRESH  = 20.0   # % from rebal_price
EXIT_PE_THRESH      = 20.0   # x
CASH_RATE_DAILY     = (1.06) ** (1/365) - 1  # 6% p.a.

HISTORICAL_DIR = "data/historical"
TRADE_LOG_PATH = "data/trade_log.json"
CURRENT_PORT   = "data/portfolio_current.json"
SENSEX_SYMBOL  = "^BSESN"

REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

os.makedirs(HISTORICAL_DIR, exist_ok=True)

# ── http session ──────────────────────────────────────────────
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

def make_session():
    s = requests.Session()
    retry = Retry(connect=3, read=3, backoff_factor=2,
                  status_forcelist=[429,500,502,503,504])
    s.mount("http://",  HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s

SESSION = make_session()

# ── Yahoo Finance ─────────────────────────────────────────────
_price_cache = {}

def fetch_prices(symbol, date_from, date_to):
    """Returns {date_str: close} for all trading days in range."""
    key = (symbol, str(date_from.date()), str(date_to.date()))
    if key in _price_cache:
        return _price_cache[key]
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
                _price_cache[key] = {}
                return {}
            data   = r.json()
            result = data["chart"]["result"][0]
            ts     = result["timestamp"]
            closes = result["indicators"]["quote"][0]["close"]
            prices = {}
            for t, c in zip(ts, closes):
                if c is not None:
                    prices[datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")] = round(c, 2)
            _price_cache[key] = prices
            return prices
        except (KeyError, IndexError):
            _price_cache[key] = {}
            return {}
        except Exception:
            if attempt < 2:
                time.sleep(5)
    _price_cache[key] = {}
    return {}

def get_close(symbol, date_str, lookback=5):
    """Get close on or before date_str (walk back for weekends/holidays)."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    frm = d - timedelta(days=lookback + 2)
    prices = fetch_prices(symbol, frm, d + timedelta(days=1))
    for i in range(lookback):
        ds = (d - timedelta(days=i)).strftime("%Y-%m-%d")
        if ds in prices:
            return prices[ds]
    return None

def get_stock_close(ticker, date_str):
    return get_close(f"{ticker}.NS", date_str)

def get_sensex_close(date_str):
    return get_close(SENSEX_SYMBOL, date_str)

def fetch_daily_range(symbol, after_date_str, before_date_str):
    """Daily closes strictly between two dates."""
    frm = datetime.strptime(after_date_str, "%Y-%m-%d") + timedelta(days=1)
    to  = datetime.strptime(before_date_str, "%Y-%m-%d")
    all_prices = fetch_prices(symbol, frm, to)
    return {d: v for d, v in all_prices.items()
            if after_date_str < d < before_date_str}

# ── portfolio construction ────────────────────────────────────
def quarter_label(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    q = {1:"Q1",2:"Q1",3:"Q1",4:"Q2",5:"Q2",6:"Q2",
         7:"Q3",8:"Q3",9:"Q3",10:"Q4",11:"Q4",12:"Q4"}[d.month]
    return f"{d.year}{q}"

def load_fundamentals(date_str):
    label = quarter_label(date_str)
    path  = os.path.join(HISTORICAL_DIR, f"fundamentals_{label}.csv")
    if not os.path.exists(path):
        return []
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    return df.to_dict("records")

def load_betas(date_str):
    label    = quarter_label(date_str)
    specific = os.path.join(HISTORICAL_DIR, f"betas_{label}.json")
    fallback = "data/betas.json"
    path = specific if os.path.exists(specific) else fallback
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)

def passes_fundamentals(row, eps_thresh, pe_thresh):
    try:
        return (
            float(row["roe"])     >= FILTERS_FIXED["roe"]     and
            float(row["revCAGR"]) >= FILTERS_FIXED["revCAGR"] and
            float(row["epsCAGR"]) >= eps_thresh                and
            float(row["pe"])      <= pe_thresh
        )
    except (TypeError, ValueError):
        return False

def passes_beta(row):
    try:
        b = row.get("beta")
        return b is not None and float(b) <= FILTERS_FIXED["beta"]
    except (TypeError, ValueError):
        return False

def growth_score(row):
    pe = row.get("pe") or 0
    return (row.get("epsCAGR") or 0) / pe if pe > 0 else 0

def get_sector_caps(all_stocks):
    counts = {}
    for s in all_stocks:
        if s.get("sector"):
            counts[s["sector"]] = counts.get(s["sector"], 0) + 1
    return {sec: min(3, max(1, math.floor(0.2*n))) for sec, n in counts.items()}

def build_screen(fundamentals, betas):
    """Run the 5-step screen with relaxation. Returns (stocks, funnel_stats, round_used)."""
    stocks = []
    for row in fundamentals:
        r = dict(row)
        r["beta"] = betas.get(str(r.get("ticker","")).strip())
        stocks.append(r)

    caps = get_sector_caps(stocks)
    fp = sp = bp = 0
    portfolio = []
    round_used = 0
    round_label = "base"

    for eps_thresh, pe_thresh, rnd, r_label in RELAXATION_ROUNDS:
        fund  = [s for s in stocks if passes_fundamentals(s, eps_thresh, pe_thresh)]
        sec   = [s for s in fund   if s.get("sector","") in SELECTED_SECTORS]
        beta  = [s for s in sec    if passes_beta(s)]
        if rnd == 0:
            fp, sp, bp = len(fund), len(sec), len(beta)
        by_sec = {}
        for s in beta:
            by_sec.setdefault(s["sector"], []).append(s)
        cands = []
        for sec_name, sec_stocks in by_sec.items():
            cap    = caps.get(sec_name, 1)
            ranked = sorted(sec_stocks, key=growth_score, reverse=True)
            cands.extend(ranked[:cap])
        if len(cands) >= MIN_PORTFOLIO_SIZE or rnd == RELAXATION_ROUNDS[-1][2]:
            portfolio   = cands
            round_used  = rnd
            round_label = r_label
            if rnd > 0:
                print(f"  ⚡ Filter relaxation round {rnd} ({r_label}) → {len(portfolio)} stocks")
            break
        else:
            print(f"  ↩  Round {rnd}: {len(cands)} stocks — relaxing...")

    return portfolio, fp, sp, bp, round_used, round_label

# ── helpers ───────────────────────────────────────────────────
def annualised(abs_pct, days):
    if abs_pct is None or not days or days <= 0:
        return None
    return round(((1 + abs_pct/100) ** (365.25/days) - 1) * 100, 2)

# ── main loop ─────────────────────────────────────────────────
print(f"\n{'─'*62}")
print(f"  Building portfolios + exits (sequential)")
print(f"  {len(REBALANCE_DATES)} rebalance dates")
print(f"{'─'*62}\n")

trade_log    = []          # accumulates all trades
prev_port    = {}          # {ticker: stock_dict} from previous quarter
intra_exited = set()       # {ticker} exited intra-quarter in prev quarter

for q_idx, rebal_date in enumerate(REBALANCE_DATES):
    label    = quarter_label(rebal_date)
    is_last  = (q_idx == len(REBALANCE_DATES) - 1)
    next_date = REBALANCE_DATES[q_idx + 1] if not is_last else None

    print(f"\n{'═'*54}")
    print(f"  [{q_idx+1}/{len(REBALANCE_DATES)}]  {rebal_date}  ({label})")
    print(f"{'═'*54}")

    # ── 1. load data & run screen ──────────────────────────────
    fundamentals = load_fundamentals(rebal_date)
    betas        = load_betas(rebal_date)
    if not fundamentals:
        print(f"  ✗ No fundamentals CSV found for {label} — skipping")
        continue

    screened, fp, sp, bp, round_used, round_label = build_screen(fundamentals, betas)
    print(f"  Funnel: {len(fundamentals)} → {fp} (fund) → {sp} (sec) → {bp} (beta) → {len(screened)} (final)")

    # ── 2. fetch rebalance prices for all screened stocks ─────
    print(f"  Fetching rebalance prices ({rebal_date})...")
    sensex_rebal = get_sensex_close(rebal_date)

    current_port = {}   # {ticker: full stock dict with both price columns}

    for s in screened:
        ticker = str(s.get("ticker","")).strip()
        if ticker in intra_exited:
            # was sold intra-quarter last time — treat as new entry
            intra_exited.discard(ticker)

        rebal_price = get_stock_close(ticker, rebal_date)
        if rebal_price is None:
            print(f"    ⚠  {ticker}: no price on {rebal_date} — skipping")
            continue

        pe = float(s.get("pe") or 0)

        if ticker in prev_port and ticker not in intra_exited:
            # ── carried over from previous quarter ──
            prev = prev_port[ticker]
            current_port[ticker] = {
                **{k: s.get(k) for k in ("ticker","name","sector","roe","revCAGR","epsCAGR","pe","beta")},
                "growth_score":  round(growth_score(s), 4),
                "filter_round":  round_used,
                "filter_label":  round_label,
                "entry_date":    prev["entry_date"],    # ← original, never changes
                "entry_price":   prev["entry_price"],   # ← original, never changes
                "rebal_date":    rebal_date,
                "rebal_price":   rebal_price,           # ← resets each quarter
                "sensex_rebal":  sensex_rebal,
            }
        else:
            # ── new entry this quarter ──
            current_port[ticker] = {
                **{k: s.get(k) for k in ("ticker","name","sector","roe","revCAGR","epsCAGR","pe","beta")},
                "growth_score":  round(growth_score(s), 4),
                "filter_round":  round_used,
                "filter_label":  round_label,
                "entry_date":    rebal_date,
                "entry_price":   rebal_price,
                "rebal_date":    rebal_date,
                "rebal_price":   rebal_price,
                "sensex_rebal":  sensex_rebal,
            }

        time.sleep(0.3)

    # ── 3. log rebalance exits (in prev but not in current) ───
    for ticker, prev_s in prev_port.items():
        if ticker in intra_exited:
            continue   # already logged as intra-quarter exit
        if ticker not in current_port:
            # stock left the portfolio at this rebalance
            exit_price = get_stock_close(ticker, rebal_date)
            entry_price = prev_s["entry_price"]
            entry_date  = prev_s["entry_date"]
            s_entry     = prev_s.get("sensex_rebal")
            s_exit      = sensex_rebal

            days = (datetime.strptime(rebal_date, "%Y-%m-%d") -
                    datetime.strptime(entry_date,  "%Y-%m-%d")).days

            abs_ret = round((exit_price - entry_price) / entry_price * 100, 2) \
                      if exit_price and entry_price else None
            ann_ret = annualised(abs_ret, days)

            sensex_abs = round((s_exit - s_entry) / s_entry * 100, 2) \
                         if s_exit and s_entry else None
            sensex_ann = annualised(sensex_abs, days)

            trade_log.append({
                "ticker":         ticker,
                "name":           prev_s.get("name"),
                "sector":         prev_s.get("sector"),
                "entry_date":     entry_date,
                "exit_date":      rebal_date,
                "entry_price":    entry_price,
                "exit_price":     exit_price,
                "holding_days":   days,
                "abs_return_pct": abs_ret,
                "ann_return_pct": ann_ret,
                "sensex_abs_pct": sensex_abs,
                "sensex_ann_pct": sensex_ann,
                "alpha_abs":      round(abs_ret - sensex_abs, 2)
                                  if abs_ret is not None and sensex_abs is not None else None,
                "alpha_ann":      round(ann_ret - sensex_ann, 2)
                                  if ann_ret is not None and sensex_ann is not None else None,
                "exit_type":      "rebalance",
                "status":         "closed",
            })
            print(f"  EXIT (rebal) {ticker}: {abs_ret}%  ({days}d)")
            time.sleep(0.3)

    # ── 4. save snapshot ──────────────────────────────────────
    snap_path = os.path.join(HISTORICAL_DIR, f"portfolio_{label}.json")
    with open(snap_path, "w") as f:
        json.dump({
            "rebalance_date": rebal_date,
            "label":          label,
            "filter_round":   round_used,
            "filter_label":   round_label,
            "universe_count": len(fundamentals),
            "fund_pass":      fp,
            "sector_pass":    sp,
            "beta_pass":      bp,
            "sensex_level":   sensex_rebal,
            "stocks":         list(current_port.values()),
        }, f, indent=2)
    print(f"  ✓ Saved {snap_path}")

    # ── 5. intra-quarter exit monitor ─────────────────────────
    if not is_last:
        print(f"\n  Monitoring intra-quarter exits ({rebal_date} → {next_date})...")

        # load/build daily price cache for this quarter
        cache_path = os.path.join(HISTORICAL_DIR, f"daily_prices_{label}.json")
        daily_cache = {}
        if os.path.exists(cache_path):
            with open(cache_path) as f:
                daily_cache = json.load(f)

        sensex_daily = fetch_daily_range(SENSEX_SYMBOL, rebal_date, next_date)
        cache_updated = False
        intra_exited  = set()   # reset for this quarter

        for ticker, stock in list(current_port.items()):
            rebal_price  = stock["rebal_price"]
            entry_price  = stock["entry_price"]
            entry_date   = stock["entry_date"]
            pe_at_rebal  = float(stock.get("pe") or 0)
            ttm_eps      = (rebal_price / pe_at_rebal) if pe_at_rebal > 0 else None
            s_entry      = sensex_daily.get(rebal_date) or next(
                (sensex_daily[d] for d in sorted(sensex_daily) if d > rebal_date), None)

            # fetch daily prices for this ticker
            if ticker not in daily_cache:
                prices = fetch_daily_range(f"{ticker}.NS", rebal_date, next_date)
                if prices:
                    daily_cache[ticker] = prices
                    cache_updated = True
                time.sleep(0.4)
            else:
                prices = daily_cache[ticker]

            if not prices:
                continue

            triggered = False
            for day in sorted(prices):
                close = prices[day]
                if close is None:
                    continue

                # trigger: measured from rebal_price (resets each quarter)
                ret_from_rebal = (close - rebal_price) / rebal_price * 100
                live_pe = (close / ttm_eps) if ttm_eps else None
                pe_breach  = live_pe is not None and live_pe > EXIT_PE_THRESH
                ret_breach = ret_from_rebal > EXIT_RETURN_THRESH

                if ret_breach and pe_breach:
                    # P&L: from original entry_price
                    days_total = (datetime.strptime(day, "%Y-%m-%d") -
                                  datetime.strptime(entry_date, "%Y-%m-%d")).days

                    abs_ret = round((close - entry_price) / entry_price * 100, 2) \
                              if entry_price else None
                    ann_ret = annualised(abs_ret, days_total)

                    s_exit = sensex_daily.get(day) or next(
                        (sensex_daily[d] for d in sorted(sensex_daily, reverse=True) if d <= day), None)

                    sensex_abs = round((s_exit - s_entry) / s_entry * 100, 2) \
                                 if s_exit and s_entry else None
                    sensex_ann = annualised(sensex_abs, days_total)

                    trade_log.append({
                        "ticker":          ticker,
                        "name":            stock.get("name"),
                        "sector":          stock.get("sector"),
                        "entry_date":      entry_date,
                        "exit_date":       day,
                        "entry_price":     entry_price,
                        "rebal_price":     rebal_price,
                        "exit_price":      close,
                        "holding_days":    days_total,
                        "abs_return_pct":  abs_ret,
                        "ann_return_pct":  ann_ret,
                        "ret_from_rebal":  round(ret_from_rebal, 2),
                        "pe_at_exit":      round(live_pe, 2) if live_pe else None,
                        "sensex_abs_pct":  sensex_abs,
                        "sensex_ann_pct":  sensex_ann,
                        "alpha_abs":       round(abs_ret - sensex_abs, 2)
                                           if abs_ret is not None and sensex_abs is not None else None,
                        "alpha_ann":       round(ann_ret - sensex_ann, 2)
                                           if ann_ret is not None and sensex_ann is not None else None,
                        "exit_type":       "intra_quarter",
                        "status":          "closed",
                        "trigger":         f"ret={round(ret_from_rebal,1)}% from {rebal_date}, P/E={round(live_pe,1)}x",
                    })

                    intra_exited.add(ticker)
                    print(f"  🔴 INTRA EXIT {ticker} on {day}: "
                          f"ret={round(ret_from_rebal,1)}% from {rebal_date}, "
                          f"full P&L={abs_ret}% ({days_total}d)")
                    triggered = True
                    break

            if not triggered:
                last_day = max(prices) if prices else "—"
                last_px  = prices.get(last_day, "—")
                print(f"  ✓ held {ticker:<15} "
                      f"(rebal ₹{rebal_price}  last ₹{last_px})")

        if cache_updated:
            with open(cache_path, "w") as f:
                json.dump(daily_cache, f)
            print(f"  ✓ Daily price cache saved → {cache_path}")

    # ── 6. update prev_port for next iteration ────────────────
    # Remove intra-exited stocks from current_port before passing to next quarter
    prev_port = {t: s for t, s in current_port.items() if t not in intra_exited}

# ── 7. log open positions (latest portfolio) ──────────────────
today_str    = datetime.today().strftime("%Y-%m-%d")
sensex_today = get_sensex_close(today_str)

for ticker, stock in prev_port.items():
    price_today = get_stock_close(ticker, today_str)
    entry_price = stock["entry_price"]
    entry_date  = stock["entry_date"]
    s_entry     = stock.get("sensex_rebal")

    days = (datetime.strptime(today_str,  "%Y-%m-%d") -
            datetime.strptime(entry_date, "%Y-%m-%d")).days

    abs_ret    = round((price_today - entry_price) / entry_price * 100, 2) \
                 if price_today and entry_price else None
    ann_ret    = annualised(abs_ret, days)
    sensex_abs = round((sensex_today - s_entry) / s_entry * 100, 2) \
                 if sensex_today and s_entry else None
    sensex_ann = annualised(sensex_abs, days)

    trade_log.append({
        "ticker":         ticker,
        "name":           stock.get("name"),
        "sector":         stock.get("sector"),
        "entry_date":     entry_date,
        "exit_date":      None,
        "entry_price":    entry_price,
        "exit_price":     price_today,
        "holding_days":   days,
        "abs_return_pct": abs_ret,
        "ann_return_pct": ann_ret,
        "sensex_abs_pct": sensex_abs,
        "sensex_ann_pct": sensex_ann,
        "alpha_abs":      round(abs_ret - sensex_abs, 2)
                          if abs_ret is not None and sensex_abs is not None else None,
        "alpha_ann":      round(ann_ret - sensex_ann, 2)
                          if ann_ret is not None and sensex_ann is not None else None,
        "exit_type":      None,
        "status":         "open",
    })
    time.sleep(0.3)

# ── 8. save outputs ───────────────────────────────────────────
with open(TRADE_LOG_PATH, "w") as f:
    json.dump(trade_log, f, indent=2)

with open(CURRENT_PORT, "w") as f:
    json.dump({
        "generated": today_str,
        "stocks":    list(prev_port.values()),
    }, f, indent=2)

# ── 9. summary ────────────────────────────────────────────────
closed  = [t for t in trade_log if t["status"] == "closed"]
open_   = [t for t in trade_log if t["status"] == "open"]
intra   = [t for t in closed if t.get("exit_type") == "intra_quarter"]
rebal   = [t for t in closed if t.get("exit_type") == "rebalance"]
rets    = [t["abs_return_pct"] for t in closed if t.get("abs_return_pct") is not None]
alphas  = [t["alpha_abs"]      for t in closed if t.get("alpha_abs")      is not None]
winners = [r for r in rets if r > 0]

print(f"\n{'═'*54}")
print(f"  FINAL SUMMARY")
print(f"  Rebalance exits     : {len(rebal)}")
print(f"  Intra-quarter exits : {len(intra)}")
print(f"  Open positions      : {len(open_)}")
print(f"  Total closed        : {len(closed)}")
if rets:
    print(f"  Avg closed return   : {sum(rets)/len(rets):.1f}%")
    print(f"  Win rate            : {len(winners)/len(rets)*100:.0f}%  ({len(winners)}/{len(closed)})")
if alphas:
    print(f"  Avg alpha           : {sum(alphas)/len(alphas):.1f}%")
print(f"\n  ✓ Trade log  → {TRADE_LOG_PATH}  ({len(trade_log)} trades)")
print(f"  ✓ Current    → {CURRENT_PORT}")
print(f"{'═'*54}\n")