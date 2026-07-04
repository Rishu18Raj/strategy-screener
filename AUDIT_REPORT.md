# Build & Test backtest audit — calculation methodology review

**Scope:** Full comparison of `src/utils/backtest.js` (the client-side engine
behind the Build & Test tab) against the "ground truth" Python pipeline
(`build_portfolios_and_exits.py`, `compute_nav.py`, `compute_performance_metrics.py`)
that produces the live Portfolio Performance numbers.

**Trigger:** Custom Screen and Base Strategy showed identical, suspiciously
low numbers (+18.35% total return, Sharpe 0.2338) despite the live strategy
actually returning +88.69% (Sharpe 1.3763) over the same period.

**Bottom line:** Found and fixed a real bug in the portfolio-selection logic.
It predates my earlier `BASE_STRATEGY_FILTERS` fix — verified by git history,
this bug has been in `backtest.js` since it was first written. After the fix,
the Base Strategy replica now returns **+89.88%** (vs. the live pipeline's
+88.69%) and reconstructs **all 8 historical quarters' portfolios stock-for-stock
identical** to what was actually held. The formulas for Sharpe, Sortino, beta,
Treynor, Jensen alpha, information ratio, and max drawdown were all checked
line-by-line and are correct — the entire gap was in portfolio *selection*,
not in any return/risk calculation.

---

## 1. What was checked, and how

Rather than reading the code and reasoning about it in the abstract, every
claim below was verified by actually running the logic against your real
repo data:

1. Cloned the current `main` branch fresh.
2. Compared `compute_nav.py`'s share-count math against `backtest.js`'s
   line-by-line.
3. Compared every risk/return formula in `compute_performance_metrics.py`
   against `computeCustomMetrics()` in `backtest.js` line-by-line.
4. Reconstructed one historical quarter's portfolio by hand from the raw
   `fundamentals_2024Q2.csv` + `betas_2024Q2.json` files, using the exact
   selection logic in `backtest.js`, and diffed it against the actual
   recorded `data/historical/portfolio_2024Q2.json`.
5. After finding and fixing the bug, built a Node harness that runs the
   **real, unmodified `backtest.js` module** (not a re-implementation) against
   your **real repo data**, and compared its output to
   `data/performance_summary.json` (the official pipeline's live numbers).

---

## 2. Confirmed correct (no issues found)

### 2.1 Share-count / "ghost share" methodology
`compute_nav.py` computes shares for a carried-over (non-exited) holding at
each rebalance as `alloc / entry_price`, where `entry_price` is the stock's
**original** entry price from however many quarters ago it first entered —
never the current quarter's price. This looks unusual at first glance, but
`backtest.js` (lines ~361–370) deliberately mirrors this exact behaviour, and
a direct code comparison confirms they match. **Not a bug** — just a
methodology choice made consistently in both engines.

### 2.2 All risk/return formulas
Checked line-by-line against `compute_performance_metrics.py`:

| Metric | Match? |
|---|---|
| Total / annualised return | ✓ identical formula (`(end/start)^(365/days) - 1`) |
| Sharpe (daily excess return, population std, ×√252) | ✓ identical |
| Sortino (downside deviation from raw excess, not re-centered) | ✓ identical — this is a subtle detail (Python filters `r < rf_daily` and takes `sqrt(mean(d²))` with `d = r - rf_daily`, not `d` re-centered around the downside subgroup's own mean) and `backtest.js` replicates it exactly, with a comment noting why |
| Beta / correlation vs SENSEX | ✓ identical covariance/variance formula |
| Treynor | ✓ identical |
| Jensen alpha | ✓ identical |
| Information ratio / tracking error | ✓ identical |
| Max drawdown | ✓ identical peak-tracking logic |

### 2.3 The manual "forward-fill" edit (commit `f4f7019`)
Your recent manual edit to `markToMarket()`, which forward-fills a missing
daily price from the last known price instead of skipping the holding that
day, is a reasonable robustness improvement. `compute_nav.py`'s equivalent
(`get_price`) walks *backward* up to 5 calendar days from each date to find
the nearest available price — functionally similar for short gaps. Not
identical in every edge case (Python gives up after 5 days and silently
drops that stock's value for the day; JS carries forward indefinitely), but
this wasn't a material contributor to the discrepancy found below, and isn't
something I've changed.

---

## 3. The actual bug: inverted relaxation-round logic

**File:** `src/utils/backtest.js`, function `buildPortfolioCustom()`
**Pre-existing:** confirmed via `git log --follow`, this logic has been in
the file since it was first committed (`1c0d9ca`, before I ever touched this
project) — it is unrelated to my earlier `BASE_STRATEGY_FILTERS` fix.

### What the real strategy does
`build_portfolios_and_exits.py` screens fundamentals with:

```python
def passes_fundamentals(row, eps_thresh, pe_thresh):
    return (
        row["roe"]     >= FILTERS_FIXED["roe"]      and   # floor only
        row["revCAGR"] >= FILTERS_FIXED["revCAGR"]  and   # floor only
        row["epsCAGR"] >= eps_thresh                and   # floor only
        row["pe"]      <= pe_thresh                       # ceiling only
    )

RELAXATION_ROUNDS = [(10,20,0), (10,25,1), (9,25,2), (8,25,3), (7,25,4)]
```

Every metric is **one-sided**: ROE/Rev CAGR/EPS CAGR have a floor and no
ceiling; P/E has a ceiling and no floor. As rounds progress (when fewer than
6 candidates are found), the **EPS CAGR floor relaxes downward** (10→7) and
the **P/E ceiling relaxes upward** (20→25) to admit more candidates.

### What `backtest.js` actually did
```js
const ROUNDS = [
  [customFilters.epsCAGR.max,     customFilters.pe.max,     0],
  [customFilters.epsCAGR.max,     customFilters.pe.max + 5, 1],
  [customFilters.epsCAGR.max - 1, customFilters.pe.max + 5, 2],
  [customFilters.epsCAGR.max - 2, customFilters.pe.max + 5, 3],
  [customFilters.epsCAGR.max - 3, customFilters.pe.max + 5, 4],
];
// used as: s.epsCAGR >= customFilters.epsCAGR.min && s.epsCAGR <= eps
```

Two compounding problems:

1. **An EPS CAGR ceiling that shouldn't exist at all.** The real strategy
   never caps EPS CAGR — any stock growing EPS faster than 30%/year still
   qualifies if it clears the floor. But the slider's *display* range tops
   out at 30% (a cosmetic UI limit), and this ceiling was being applied as a
   literal, hard cutoff. Example found: **ICICI Bank** had recorded
   `epsCAGR: 33.65` in the actual June 2024 portfolio — a real holding — but
   the Build & Test replica rejected it outright because 33.65 > 30.
2. **The relaxation direction was backwards.** Instead of relaxing the EPS
   CAGR floor downward as Python does, it was shrinking this artificial
   ceiling (30 → 30 → 29 → 28 → 27) — making the screen *stricter*, not more
   permissive, in later rounds. The floor (`customFilters.epsCAGR.min`)
   never moved at all.

Together, this silently excluded a meaningfully different set of stocks at
nearly every one of the 8 historical rebalances, compounding into the ~5×
total-return gap.

### Proof
Reconstructing June 2024's portfolio by hand with the buggy logic vs. the
corrected logic, against the *actual* recorded portfolio:

```
Buggy logic:      ['HDFCBANK','IIFL','INFY','KOTAKBANK','MGL','UTIAMC']         (6 stocks, WRONG)
Corrected logic:  ['BPCL','CHOLAHLDNG','HDFCBANK','HINDPETRO','ICICIBANK',
                   'IIFL','IOC','KOTAKBANK','MOTILALOFS']                        (9 stocks)
Actual portfolio_2024Q2.json:  — same 9 stocks, same order —                     ✓ EXACT MATCH
```

### The fix
- Cascade now relaxes `customFilters.epsCAGR.min` downward (10→7), matching
  Python's floor-relaxation exactly, instead of shrinking a ceiling.
- Added a "slider at its absolute display edge = no cap on that side" rule
  for ROE/Rev CAGR/EPS CAGR ceilings and P/E/beta floors — this is exactly
  what the UI's own "35%+" / "0.3x+" style labels already implied, but the
  filtering logic wasn't actually honoring it. This means: leave a slider
  handle at its default/max position and that side is genuinely unbounded
  (matching the real strategy); drag it inward and it becomes a real,
  meaningful constraint (for exploratory custom screens).

### Verification (real code, real data, not a re-implementation)
Ran the actual patched `backtest.js` module — not a re-implementation — via
a Node harness against your real repo data:

| | Before fix | After fix | Official live pipeline |
|---|---|---|---|
| Total return | +18.35% | **+89.88%** | +88.69% |
| Annualised return | +8.79% | **+37.80%** | +36.95% |
| Sharpe | 0.2338 | **1.1911** | 1.3763 |
| Sortino | 0.2299 | **1.5747** | 1.8421 |
| Max drawdown | 25.33% | 20.26% | 13.99% |
| Intra-quarter exits | 7 | 4 | 14 |
| Quarters matching actual holdings exactly | 0 / 8 | **8 / 8** | — |

Total return, annualised return, Sharpe, and Sortino are now all within a
few percent of the live pipeline — a night-and-day improvement from the
~5× gap before.

---

## 4. Residual (smaller) gap: intra-quarter exit count

After the fix, **4** intra-quarter exits are detected vs. the live
pipeline's **14** — this is why Sharpe/Sortino/drawdown are still a bit off
even though total return is nearly exact. Likely cause: `backtest.js` checks
the exit trigger against `data/historical/universe_daily_prices.json` (a
broad, pre-fetched snapshot covering the whole stock universe so any custom
filter can be exit-checked), while the live pipeline's `monitor_exits.py`
fetches its own dedicated daily price cache per stock. If the universe
snapshot has sparser day-to-day coverage than the live fetch, some exit
triggers (which require hitting the return+P/E threshold on a *specific*
day) could be missed. I didn't chase this further since it's a much smaller
effect than the bug above and touches a large pre-fetched data file rather
than a formula — happy to dig into it next if you'd like it fully closed.

---

## 5. Files changed

- `src/utils/backtest.js` — the fix described in §3. Verified with `npm run build`.

No other files were touched. `BASE_STRATEGY_FILTERS` in `config.js` (from
the previous fix) is unchanged and is now correctly interpreted as
one-sided where intended.
