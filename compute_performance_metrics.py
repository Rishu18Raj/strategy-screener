"""
compute_performance_metrics.py
─────────────────────────────────────────────────────────────────────────────
Reads nav.json + trade_log.json and computes all performance metrics
needed by the Portfolio Performance tab.

Outputs:
  data/performance_summary.json
─────────────────────────────────────────────────────────────────────────────
"""

import json
import math
from datetime import datetime

NAV_PATH       = "data/nav.json"
TRADE_LOG_PATH = "data/trade_log.json"
OUT_PATH       = "data/performance_summary.json"

RISK_FREE_RATE = 0.06          # 6% p.a. Indian T-bill proxy
TRADING_DAYS   = 252

# ── load ─────────────────────────────────────────────────────
with open(NAV_PATH) as f:
    nav_series = json.load(f)

with open(TRADE_LOG_PATH) as f:
    trade_log = json.load(f)

# ── daily returns ─────────────────────────────────────────────
port_navs   = [d["portfolio_nav"] for d in nav_series]
sensex_navs = [d["sensex_nav"]    for d in nav_series]
dates       = [d["date"]          for d in nav_series]

port_returns   = [(port_navs[i]   - port_navs[i-1])   / port_navs[i-1]   for i in range(1, len(port_navs))]
sensex_returns = [(sensex_navs[i] - sensex_navs[i-1]) / sensex_navs[i-1] for i in range(1, len(sensex_navs))]

# ── total & annualised return ─────────────────────────────────
start_nav = port_navs[0]
end_nav   = port_navs[-1]
n_days    = (datetime.strptime(dates[-1], "%Y-%m-%d") -
             datetime.strptime(dates[0],  "%Y-%m-%d")).days

total_return_pct = round((end_nav / start_nav - 1) * 100, 2)
ann_return_pct   = round(((end_nav / start_nav) ** (365 / n_days) - 1) * 100, 2) if n_days > 0 else 0

sensex_total = round((sensex_navs[-1] / sensex_navs[0] - 1) * 100, 2)
sensex_ann   = round(((sensex_navs[-1] / sensex_navs[0]) ** (365 / n_days) - 1) * 100, 2) if n_days > 0 else 0

# ── sharpe ratio ─────────────────────────────────────────────
rf_daily  = (1 + RISK_FREE_RATE) ** (1 / TRADING_DAYS) - 1
excess    = [r - rf_daily for r in port_returns]
mean_exc  = sum(excess) / len(excess) if excess else 0
std_exc   = math.sqrt(sum((x - mean_exc)**2 for x in excess) / len(excess)) if excess else 0
sharpe    = round((mean_exc / std_exc) * math.sqrt(TRADING_DAYS), 4) if std_exc > 0 else 0

# ── max drawdown ──────────────────────────────────────────────
peak         = port_navs[0]
max_dd       = 0.0
dd_start     = dates[0]
dd_end       = dates[0]
dd_peak_date = dates[0]
temp_peak    = port_navs[0]
temp_start   = dates[0]

for i, (nav, date) in enumerate(zip(port_navs, dates)):
    if nav > peak:
        peak         = nav
        dd_peak_date = date
        temp_peak    = nav
        temp_start   = date
    dd = (peak - nav) / peak
    if dd > max_dd:
        max_dd   = dd
        dd_start = temp_start
        dd_end   = date

max_drawdown_pct = round(max_dd * 100, 2)

# ── beta & correlation vs SENSEX ─────────────────────────────
n = min(len(port_returns), len(sensex_returns))
pr, sr = port_returns[-n:], sensex_returns[-n:]
pm, sm = sum(pr)/n, sum(sr)/n
cov    = sum((pr[i]-pm)*(sr[i]-sm) for i in range(n))
var_s  = sum((sr[i]-sm)**2 for i in range(n))
var_p  = sum((pr[i]-pm)**2 for i in range(n))
beta   = round(cov/var_s, 4) if var_s > 0 else 1.0
corr   = round(cov / math.sqrt(var_s * var_p), 4) if var_s > 0 and var_p > 0 else 0

# ── trade-level stats ─────────────────────────────────────────
closed = [t for t in trade_log if t.get("status") == "closed"]
open_  = [t for t in trade_log if t.get("status") == "open"]

rets     = [t["abs_return_pct"] for t in closed if t.get("abs_return_pct") is not None]
ann_rets = [t["ann_return_pct"] for t in closed if t.get("ann_return_pct") is not None]
alphas   = [t["alpha_abs"]      for t in closed if t.get("alpha_abs")      is not None]
holdings_days = [t["holding_days"] for t in closed if t.get("holding_days") is not None]

winners  = [r for r in rets if r > 0]
losers   = [r for r in rets if r <= 0]

win_rate      = round(len(winners) / len(rets) * 100, 1) if rets else 0
avg_return    = round(sum(rets) / len(rets), 2)           if rets else 0
avg_winner    = round(sum(winners) / len(winners), 2)     if winners else 0
avg_loser     = round(sum(losers)  / len(losers),  2)     if losers  else 0
avg_alpha     = round(sum(alphas)  / len(alphas),  2)     if alphas  else 0
avg_hold_days = round(sum(holdings_days) / len(holdings_days)) if holdings_days else 0

best_trade  = max(closed, key=lambda t: t.get("abs_return_pct") or -999, default=None)
worst_trade = min(closed, key=lambda t: t.get("abs_return_pct") or  999, default=None)

intra_exits  = [t for t in closed if t.get("exit_type") == "intra_quarter"]
rebal_exits  = [t for t in closed if t.get("exit_type") != "intra_quarter"]

# ── quarterly active returns ──────────────────────────────────
# For each rebalance window, compute portfolio return and SENSEX return
REBALANCE_DATES = [
    "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
    "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]

nav_by_date = {d["date"]: d for d in nav_series}

def nav_on(date_str):
    """Get NAV on or after a date (first available trading day)."""
    from datetime import timedelta
    d = datetime.strptime(date_str, "%Y-%m-%d")
    for _ in range(5):
        ds = d.strftime("%Y-%m-%d")
        if ds in nav_by_date:
            return nav_by_date[ds]
        d += timedelta(days=1)
    return None

quarterly_returns = []
for i in range(len(REBALANCE_DATES) - 1):
    d_start = REBALANCE_DATES[i]
    d_end   = REBALANCE_DATES[i+1]
    n_start = nav_on(d_start)
    n_end   = nav_on(d_end)
    if n_start and n_end:
        p_ret = round((n_end["portfolio_nav"] / n_start["portfolio_nav"] - 1) * 100, 2)
        s_ret = round((n_end["sensex_nav"]    / n_start["sensex_nav"]    - 1) * 100, 2)
        quarterly_returns.append({
            "period":        f"{d_start} → {d_end}",
            "label":         f"Q{i+1}",
            "start_date":    d_start,
            "end_date":      d_end,
            "portfolio_ret": p_ret,
            "sensex_ret":    s_ret,
            "active_ret":    round(p_ret - s_ret, 2),
        })

# ── assemble output ───────────────────────────────────────────
summary = {
    "generated":          datetime.today().strftime("%Y-%m-%d"),
    "period": {
        "start":          dates[0],
        "end":            dates[-1],
        "days":           n_days,
    },
    "returns": {
        "total_pct":      total_return_pct,
        "annualised_pct": ann_return_pct,
        "sensex_total":   sensex_total,
        "sensex_ann":     sensex_ann,
        "alpha_total":    round(total_return_pct - sensex_total, 2),
        "alpha_ann":      round(ann_return_pct   - sensex_ann,   2),
    },
    "risk": {
        "sharpe_ratio":    sharpe,
        "max_drawdown_pct":max_drawdown_pct,
        "drawdown_start":  dd_start,
        "drawdown_end":    dd_end,
        "beta":            beta,
        "correlation":     corr,
        "risk_free_rate":  RISK_FREE_RATE,
    },
    "trades": {
        "total_closed":    len(closed),
        "total_open":      len(open_),
        "intra_quarter":   len(intra_exits),
        "rebalance_exits": len(rebal_exits),
        "win_rate_pct":    win_rate,
        "avg_return_pct":  avg_return,
        "avg_winner_pct":  avg_winner,
        "avg_loser_pct":   avg_loser,
        "avg_alpha_pct":   avg_alpha,
        "avg_hold_days":   avg_hold_days,
        "best_trade": {
            "ticker":      best_trade["ticker"]        if best_trade else None,
            "return_pct":  best_trade["abs_return_pct"] if best_trade else None,
            "entry_date":  best_trade["entry_date"]    if best_trade else None,
            "exit_date":   best_trade.get("exit_date") if best_trade else None,
        },
        "worst_trade": {
            "ticker":      worst_trade["ticker"]        if worst_trade else None,
            "return_pct":  worst_trade["abs_return_pct"] if worst_trade else None,
            "entry_date":  worst_trade["entry_date"]    if worst_trade else None,
            "exit_date":   worst_trade.get("exit_date") if worst_trade else None,
        },
    },
    "quarterly_returns": quarterly_returns,
    "nav_series":        nav_series,   # full series for chart
}

with open(OUT_PATH, "w") as f:
    json.dump(summary, f, indent=2)

# ── print summary ─────────────────────────────────────────────
print(f"\n{'─'*58}")
print(f"  PERFORMANCE SUMMARY")
print(f"  Period        : {dates[0]} → {dates[-1]}  ({n_days}d)")
print(f"  Total return  : {total_return_pct:+.1f}%  (SENSEX {sensex_total:+.1f}%)")
print(f"  Annualised    : {ann_return_pct:+.1f}%  (SENSEX {sensex_ann:+.1f}%)")
print(f"  Alpha (ann)   : {round(ann_return_pct - sensex_ann, 2):+.1f}%")
print(f"  Sharpe ratio  : {sharpe}")
print(f"  Max drawdown  : -{max_drawdown_pct}%  ({dd_start} → {dd_end})")
print(f"  Beta          : {beta}")
print(f"  Correlation   : {corr}")
print(f"  Win rate      : {win_rate}%  ({len(winners)}/{len(closed)})")
print(f"  Avg return    : {avg_return:+.1f}%")
print(f"  Avg winner    : {avg_winner:+.1f}%")
print(f"  Avg loser     : {avg_loser:+.1f}%")
print(f"  Avg alpha     : {avg_alpha:+.1f}%")
print(f"  Best trade    : {best_trade['ticker'] if best_trade else '—'}  {best_trade['abs_return_pct'] if best_trade else ''}%")
print(f"  Worst trade   : {worst_trade['ticker'] if worst_trade else '—'}  {worst_trade['abs_return_pct'] if worst_trade else ''}%")
print(f"\n  ✓ Saved → {OUT_PATH}")
print(f"{'─'*58}\n")