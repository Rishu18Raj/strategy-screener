# Trade Log Generation Mismatches

## Critical Differences Between Python Pipeline and JavaScript Backtest

### 1. **Trade Scope and Timing (FUNDAMENTAL ARCHITECTURE DIFFERENCE)**

**Python (build_portfolios_and_exits.py):**
- Sequential quarter-by-quarter processing with state carryover
- Maintains `prev_port` dict to track holdings across quarters
- Stocks held across multiple quarters are logged as a SINGLE trade
- Entry happens once (when stock first enters portfolio)
- Exit happens once (when stock leaves portfolio or at end)
- Trade spans potentially multiple quarters

**JavaScript (backtest.js):**
- Pre-computes all quarters upfront, then walks day-by-day
- No state carryover between quarters
- Each quarter's portfolio is logged as INDEPENDENT trades
- Every stock in every quarter generates a separate trade entry
- Entry = current quarter's rebalance, Exit = next quarter's rebalance (or intra exit)
- Trade is always exactly one quarter long (or less if intra exit)

**Impact:** This is the root cause. The JS backtest treats each quarter as independent trades, while Python treats multi-quarter holdings as single trades. This completely changes the trade statistics (win rate, average return, holding period, etc.).

---

### 2. **Entry Price Handling**

**Python:**
- Lines 304-330: If stock was held from previous quarter, carries forward ORIGINAL `entry_date` and `entry_price`
- `entry_price` is the price when the stock FIRST entered the portfolio
- `entry_price` NEVER changes once set
- `rebal_price` is a separate field that resets each quarter (used for exit trigger calculation)

**JavaScript:**
- Lines 326-344: At each rebalance, `entry_price` is set to the CURRENT quarter's rebalance price
- No concept of carrying forward original entry price
- Each quarter's trade starts fresh with that quarter's entry price

**Impact:** Python calculates returns from the actual entry point; JS calculates returns from the most recent rebalance, understating true holding period returns.

---

### 3. **Trade Log Fields**

**Python (complete trade log entry):**
```python
{
    "ticker": ticker,
    "name": name,
    "sector": sector,
    "entry_date": original_entry_date,  # when stock first entered
    "exit_date": exit_date,
    "entry_price": original_entry_price,  # never changes
    "exit_price": exit_price,
    "holding_days": days_from_original_entry,
    "abs_return_pct": return_from_original_entry,
    "ann_return_pct": annualized_return,
    "sensex_abs_pct": sensex_return_over_same_period,
    "sensex_ann_pct": sensex_annualized,
    "alpha_abs": abs_return_pct - sensex_abs_pct,
    "alpha_ann": ann_return_pct - sensex_ann_pct,
    "exit_type": "rebalance" or "intra_quarter",
    "status": "closed" or "open",
    # For intra-quarter exits only:
    "rebal_price": current_quarter_rebal_price,
    "ret_from_rebal": return_from_quarter_rebal,
    "pe_at_exit": live_pe_at_exit,
    "trigger": description_string
}
```

**JavaScript (minimal trade log entry):**
```javascript
{
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    entry_date: current_quarter_rebal_date,  # always this quarter
    exit_date: exit_day,
    entry_price: current_quarter_rebal_price,  # always this quarter
    exit_price: exit_price,
    abs_return_pct: return_from_this_quarter_only,
    exit_type: "intra_quarter" or "rebalance",
    status: "closed",  # always closed
    pe_at_entry: s.pe
}
```

**Missing in JS:**
- `holding_days` - critical for understanding trade duration
- `ann_return_pct` - annualized return
- `sensex_abs_pct` - SENSEX benchmark return
- `sensex_ann_pct` - SENSEX annualized return
- `alpha_abs` - alpha vs SENSEX
- `alpha_ann` - annualized alpha
- `ret_from_rebal` - return from quarter rebalance (for intra exits)
- `pe_at_exit` - P/E at exit (for intra exits)
- `trigger` - exit trigger description
- Open positions (no "open" status trades)

**Impact:** The JS trade log cannot be used for the same performance analysis as Python. Missing alpha, SENSEX comparison, and holding period data makes it impossible to compute the same metrics.

---

### 4. **Intra-Quarter Exit Logic**

**Python (lines 412-492):**
- Trigger: return > 20% from `rebal_price` AND live P/E > 20x
- **Critical**: Return is measured from `rebal_price` (resets each quarter), NOT from original `entry_price`
- **But P&L is calculated from original `entry_price`** (line 451-452)
- Adds ticker to `intra_exited` set to prevent double-counting at next rebalance
- Logs additional fields: `ret_from_rebal`, `pe_at_exit`, `trigger`

**JavaScript (lines 262-284, 364-373):**
- Same trigger logic: return > threshold from `rebal_price` AND P/E > threshold
- P&L is calculated from `rebal_price` (line 333), NOT from original entry
- No `intra_exited` tracking needed because each quarter is independent

**Impact:** Python correctly calculates P&L from the actual entry point; JS calculates P&L from the quarter rebalance, which is incorrect for multi-quarter holdings.

---

### 5. **SENSEX Benchmark Comparison**

**Python:**
- Lines 343-355 (rebalance exits): Calculates SENSEX return over the same holding period
- Lines 455-460 (intra exits): Calculates SENSEX return over the same holding period
- Lines 525-527 (open positions): Calculates SENSEX return from entry to today
- Computes alpha as: stock_return - sensex_return

**JavaScript:**
- No SENSEX comparison in trade log at all
- No alpha calculation
- SENSEX is only used for NAV series, not for individual trade benchmarking

**Impact:** Cannot compute alpha for individual trades in JS backtest, which is a key metric in the Performance tab.

---

### 6. **Open Positions**

**Python:**
- Lines 509-549: Logs all currently held positions as "open" trades
- Calculates unrealized returns from original entry to today
- Includes SENSEX comparison and alpha for open positions

**JavaScript:**
- No open position tracking
- All trades are logged as "closed" at each rebalance
- No concept of positions that are still held

**Impact:** The JS backtest cannot show current portfolio performance or unrealized gains/losses.

---

### 7. **Trade Statistics Calculation**

**Python (compute_performance_metrics.py, lines 116-131):**
- Calculates win rate, average return, average winner/loser, average alpha
- Uses the actual trade log with proper holding periods
- Filters by `status == "closed"` for closed trade stats

**JavaScript:**
- Would need to compute stats from the quarterly trade log
- But the trade log structure is completely different
- Cannot compute comparable statistics without major refactoring

**Impact:** Any trade statistics computed from the JS trade log will be fundamentally different and incomparable to the Python pipeline stats.

---

## Root Cause

The JavaScript backtest was designed to simulate the NAV series correctly (which it does), but the trade log generation follows a completely different model:

- **Python**: Realistic trade tracking - stocks enter once, exit once, potentially spanning multiple quarters
- **JavaScript**: Quarterly snapshot model - each quarter is treated as an independent trade

This makes the JS trade log unsuitable for the same performance analysis as the Python pipeline.

## Recommended Fix

To make the JS trade log match the Python trade log, `runCustomBacktest()` needs to:

1. Track holdings across quarters with original entry prices
2. Only log a trade when a stock actually exits the portfolio (not at each rebalance)
3. Calculate returns from original entry price, not quarterly rebalance price
4. Include SENSEX benchmark comparison for each trade
5. Calculate alpha for each trade
6. Track open positions at the end
7. Include all the same fields as the Python trade log

This is a significant refactoring of the trade log generation logic in backtest.js.
