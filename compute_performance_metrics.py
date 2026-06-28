"""
compute_performance_metrics.py
─────────────────────────────────────────────────────────────────────────────
Reads nav.json + trade_log.json and computes all performance metrics
needed by the Portfolio Performance tab.

Metrics computed:
  Returns  : Total, Annualised, vs SENSEX, Alpha
  Risk     : Sharpe, Sortino, Treynor, Beta, Correlation, Max Drawdown
  Trades   : Win rate, Avg return, Avg winner/loser, Best/worst trade

Outputs:
  data/performance_summary.json   ← all metrics + quarterly returns
  (nav_series lives in data/nav.json — fetched separately by UI)
─────────────────────────────────────────────────────────────────────────────
"""

import json
import math
from datetime import datetime, timedelta

NAV_PATH       = "data/nav.json"
TRADE_LOG_PATH = "data/trade_log.json"
OUT_PATH       = "data/performance_summary.json"

RISK_FREE_RATE = 0.06       # 6% p.a. Indian T-bill proxy
TRADING_DAYS   = 252

REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

# ── load ──────────────────────────────────────────────────────
with open(NAV_PATH) as f:
    nav_series = json.load(f)

with open(TRADE_LOG_PATH) as f:
    trade_log = json.load(f)

# ── basic series ──────────────────────────────────────────────
port_navs   = [d["portfolio_nav"] for d in nav_series]
sensex_navs = [d["sensex_nav"]    for d in nav_series]
dates       = [d["date"]          for d in nav_series]

port_ret   = [(port_navs[i]   - port_navs[i-1]) / port_navs[i-1]   for i in range(1, len(port_navs))]
sensex_ret = [(sensex_navs[i] - sensex_navs[i-1]) / sensex_navs[i-1] for i in range(1, len(sensex_navs))]

# ── total & annualised return ─────────────────────────────────
n_days = (datetime.strptime(dates[-1], "%Y-%m-%d") -
          datetime.strptime(dates[0],  "%Y-%m-%d")).days

total_ret_pct = round((port_navs[-1] / port_navs[0] - 1) * 100, 2)
ann_ret_pct   = round(((port_navs[-1] / port_navs[0]) ** (365/n_days) - 1) * 100, 2) if n_days else 0

sensex_total  = round((sensex_navs[-1] / sensex_navs[0] - 1) * 100, 2)
sensex_ann    = round(((sensex_navs[-1] / sensex_navs[0]) ** (365/n_days) - 1) * 100, 2) if n_days else 0

# ── risk metrics ──────────────────────────────────────────────
rf_daily   = (1 + RISK_FREE_RATE) ** (1/TRADING_DAYS) - 1
excess     = [r - rf_daily for r in port_ret]
mean_exc   = sum(excess) / len(excess) if excess else 0
std_all    = math.sqrt(sum((x - mean_exc)**2 for x in excess) / len(excess)) if excess else 0

# Sharpe — uses all daily returns
sharpe = round((mean_exc / std_all) * math.sqrt(TRADING_DAYS), 4) if std_all else 0

# Sortino — uses only downside deviation (returns below risk-free)
downside   = [r - rf_daily for r in port_ret if r < rf_daily]
std_down   = math.sqrt(sum(d**2 for d in downside) / len(downside)) if downside else 0
sortino    = round((mean_exc / std_down) * math.sqrt(TRADING_DAYS), 4) if std_down else 0

# Beta & correlation vs SENSEX
n = min(len(port_ret), len(sensex_ret))
pr, sr  = port_ret[-n:], sensex_ret[-n:]
pm, sm  = sum(pr)/n, sum(sr)/n
cov     = sum((pr[i]-pm)*(sr[i]-sm) for i in range(n))
var_s   = sum((sr[i]-sm)**2 for i in range(n))
var_p   = sum((pr[i]-pm)**2 for i in range(n))
beta    = round(cov/var_s,  4) if var_s else 1.0
corr    = round(cov / math.sqrt(var_s * var_p), 4) if var_s and var_p else 0

# Treynor — expressed as % (excess return per unit of beta)
treynor = round((ann_ret_pct - RISK_FREE_RATE*100) / beta, 2) if beta else 0

# Jensen Alpha — ann_port - [rf + beta*(ann_sensex - rf)]
jensen_alpha = round(
    ann_ret_pct - (RISK_FREE_RATE*100 + beta * (sensex_ann - RISK_FREE_RATE*100)),
    2
)

# Information Ratio — active return / tracking error (annualised)
active_daily   = [port_ret[i] - sensex_ret[i] for i in range(min(len(port_ret), len(sensex_ret)))]
active_mean    = sum(active_daily) / len(active_daily) if active_daily else 0
tracking_error = math.sqrt(sum((a - active_mean)**2 for a in active_daily) / len(active_daily)) * math.sqrt(TRADING_DAYS) if active_daily else 0
active_ann     = (ann_ret_pct - sensex_ann) / 100   # annualised active return as decimal
info_ratio     = round(active_ann / tracking_error, 4) if tracking_error else 0

# Max drawdown
peak = port_navs[0]
max_dd = 0.0
dd_start = dd_end = temp_start = dates[0]

for i, (nav, date) in enumerate(zip(port_navs, dates)):
    if nav > peak:
        peak       = nav
        temp_start = date
    dd = (peak - nav) / peak
    if dd > max_dd:
        max_dd   = dd
        dd_start = temp_start
        dd_end   = date

max_drawdown_pct = round(max_dd * 100, 2)

# ── trade stats ───────────────────────────────────────────────
closed = [t for t in trade_log if t.get("status") == "closed"]
open_  = [t for t in trade_log if t.get("status") == "open"]

rets          = [t["abs_return_pct"] for t in closed if t.get("abs_return_pct") is not None]
alphas        = [t["alpha_abs"]      for t in closed if t.get("alpha_abs")      is not None]
hold_days     = [t["holding_days"]   for t in closed if t.get("holding_days")   is not None]
winners       = [r for r in rets if r > 0]
losers        = [r for r in rets if r <= 0]

win_rate      = round(len(winners)/len(rets)*100, 1) if rets else 0
avg_ret       = round(sum(rets)/len(rets), 2)         if rets else 0
avg_winner    = round(sum(winners)/len(winners), 2)   if winners else 0
avg_loser     = round(sum(losers)/len(losers), 2)     if losers  else 0
avg_alpha     = round(sum(alphas)/len(alphas), 2)     if alphas  else 0
avg_hold      = round(sum(hold_days)/len(hold_days))  if hold_days else 0

best  = max(closed, key=lambda t: t.get("abs_return_pct") or -999, default=None)
worst = min(closed, key=lambda t: t.get("abs_return_pct") or  999, default=None)

intra_exits = [t for t in closed if t.get("exit_type") == "intra_quarter"]
rebal_exits = [t for t in closed if t.get("exit_type") != "intra_quarter"]

# ── quarterly returns ─────────────────────────────────────────
nav_by_date = {d["date"]: d for d in nav_series}

def nav_on(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    for _ in range(5):
        ds = d.strftime("%Y-%m-%d")
        if ds in nav_by_date:
            return nav_by_date[ds]
        d += timedelta(days=1)
    return None

quarterly_returns = []
for i in range(len(REBALANCE_DATES) - 1):
    d0, d1 = REBALANCE_DATES[i], REBALANCE_DATES[i+1]
    n0, n1 = nav_on(d0), nav_on(d1)
    if n0 and n1:
        p = round((n1["portfolio_nav"] / n0["portfolio_nav"] - 1) * 100, 2)
        s = round((n1["sensex_nav"]    / n0["sensex_nav"]    - 1) * 100, 2)
        quarterly_returns.append({
            "label":         f"Q{i+1}",
            "start_date":    d0,
            "end_date":      d1,
            "portfolio_ret": p,
            "sensex_ret":    s,
            "active_ret":    round(p - s, 2),
        })

# ── assemble output ───────────────────────────────────────────
summary = {
    "generated": datetime.today().strftime("%Y-%m-%d"),
    "period": {
        "start": dates[0],
        "end":   dates[-1],
        "days":  n_days,
    },
    "returns": {
        "total_pct":      total_ret_pct,
        "annualised_pct": ann_ret_pct,
        "sensex_total":   sensex_total,
        "sensex_ann":     sensex_ann,
        "alpha_total":    round(total_ret_pct - sensex_total, 2),
        "alpha_ann":      round(ann_ret_pct   - sensex_ann,   2),
    },
    "risk": {
        "sharpe":          sharpe,
        "sortino":         sortino,
        "treynor":         treynor,          # % excess return per unit of beta
        "jensen_alpha":    jensen_alpha,     # % annualised alpha
        "info_ratio":      info_ratio,       # active return / tracking error
        "tracking_error":  round(tracking_error * 100, 2),  # annualised TE as %
        "beta":            beta,
        "correlation":     corr,
        "max_drawdown_pct":max_drawdown_pct,
        "drawdown_start":  dd_start,
        "drawdown_end":    dd_end,
        "risk_free_rate":  RISK_FREE_RATE,
    },
    "trades": {
        "total_closed":    len(closed),
        "total_open":      len(open_),
        "intra_quarter":   len(intra_exits),
        "rebalance_exits": len(rebal_exits),
        "win_rate_pct":    win_rate,
        "avg_return_pct":  avg_ret,
        "avg_winner_pct":  avg_winner,
        "avg_loser_pct":   avg_loser,
        "avg_alpha_pct":   avg_alpha,
        "avg_hold_days":   avg_hold,
        "best_trade": {
            "ticker":     best["ticker"]         if best else None,
            "return_pct": best["abs_return_pct"] if best else None,
            "entry_date": best["entry_date"]     if best else None,
            "exit_date":  best.get("exit_date")  if best else None,
        },
        "worst_trade": {
            "ticker":     worst["ticker"]         if worst else None,
            "return_pct": worst["abs_return_pct"] if worst else None,
            "entry_date": worst["entry_date"]     if worst else None,
            "exit_date":  worst.get("exit_date")  if worst else None,
        },
    },
    "quarterly_returns": quarterly_returns,
}

with open(OUT_PATH, "w") as f:
    json.dump(summary, f, indent=2)

# ── print ─────────────────────────────────────────────────────
print(f"\n{'─'*60}")
print(f"  PERFORMANCE SUMMARY  ({dates[0]} → {dates[-1]}, {n_days}d)")
print(f"{'─'*60}")
print(f"  Total return   : {total_ret_pct:+.1f}%   SENSEX {sensex_total:+.1f}%")
print(f"  Annualised     : {ann_ret_pct:+.1f}%   SENSEX {sensex_ann:+.1f}%")
print(f"  Alpha (ann)    : {round(ann_ret_pct - sensex_ann, 2):+.1f}%")
print(f"  Jensen Alpha   : {jensen_alpha:+.2f}%")
print(f"  Sharpe         : {sharpe}")
print(f"  Sortino        : {sortino}")
print(f"  Treynor        : {treynor:.2f}%  (excess return per unit of beta)")
print(f"  Info Ratio     : {info_ratio}  (active return / tracking error)")
print(f"  Tracking Error : {round(tracking_error*100,2)}%")
print(f"  Beta           : {beta}")
print(f"  Correlation    : {corr}")
print(f"  Max drawdown   : -{max_drawdown_pct}%  ({dd_start} → {dd_end})")
print(f"  Win rate       : {win_rate}%  ({len(winners)}/{len(closed)})")
print(f"  Avg return     : {avg_ret:+.1f}%")
print(f"  Avg winner     : {avg_winner:+.1f}%")
print(f"  Avg loser      : {avg_loser:+.1f}%")
print(f"  Avg alpha      : {avg_alpha:+.1f}%")
print(f"  Best trade     : {best['ticker'] if best else '—'}  {best['abs_return_pct'] if best else ''}%")
print(f"  Worst trade    : {worst['ticker'] if worst else '—'}  {worst['abs_return_pct'] if worst else ''}%")
print(f"\n  ✓ Saved → {OUT_PATH}")
print(f"{'─'*60}\n")