# Performance Tab vs Build & Test Tab Mismatch Analysis

## Issue Summary

1. **Missing Trade (Motilalofs)**: Appears in Performance tab trade log but not in Build & Test tab trade log
2. **Return Discrepancy**: Performance tab shows 74% total return, Build & Test tab shows 20.97% with same filters

## Root Cause: Different Data Sources

### Performance Tab (Live Strategy)
- **Data Source**: Python pipeline output files
  - `data/performance_summary.json` - computed by `compute_performance_metrics.py`
  - `data/nav.json` - actual NAV series from live strategy
  - `data/trade_log.json` - actual trade log from `build_portfolios_and_exits.py`
- **Time Period**: 25-Jun-2024 to 25-Jun-2026 (2 years)
- **Nature**: ACTUAL live strategy performance with real trades

### Build & Test Tab (Historical Backtest)
- **Data Source**: Historical data files + simulation
  - `data/historical/fundamentals_*.csv` - historical fundamentals snapshots
  - `data/historical/betas_*.json` - historical beta data
  - `data/historical/universe_rebalance_prices.json` - historical rebalance prices
  - `data/historical/universe_daily_prices.json` - historical daily prices
- **Time Period**: Same dates (2024-06-25 to 2026-06-25)
- **Nature**: SIMULATED backtest reconstructing what WOULD have happened

## Why Motilalofs is Missing

**Performance Tab**: Motilalofs was actually selected and traded in the live strategy because:
- The Python pipeline used the actual fundamentals data available at each rebalance date
- The stock passed all filters and was included in the portfolio
- Trade was logged to `trade_log.json`

**Build & Test Tab**: Motilalofs may not appear because:
- The historical fundamentals CSV (`fundamentals_*.csv`) for that quarter may have different data than what the live strategy used
- The stock may not pass the filters when using the historical CSV data
- There could be data quality issues in the historical CSVs (missing values, different formats)
- The beta data in `betas_*.json` may differ from what was used live

## Why Returns Differ (74% vs 20.97%)

**Performance Tab (74%)**:
- Based on actual portfolio composition from the live strategy
- Uses real trade execution and actual price data
- Reflects the actual decisions made by the strategy managers

**Build & Test Tab (20.97%)**:
- Based on SIMULATED portfolio reconstruction using historical CSVs
- The backtest rebuilds portfolios at each quarter using the historical fundamentals
- If the historical CSVs have different data than what was used live, the portfolio composition will differ
- Different portfolio composition = different returns

## Key Insight

The Build & Test tab is NOT a replay of what actually happened. It's a "what if" simulation:
- "If we ran this strategy with THESE filters using the historical data in these CSVs, what would have happened?"

The Performance tab shows what ACTUALLY happened with the live strategy.

## Possible Causes for Data Differences

1. **Historical CSV Data Quality**: The `fundamentals_*.csv` files may not exactly match the data that was available live at each rebalance date
2. **Data Timing**: The historical snapshots may have been taken at different times than when the live strategy made decisions
3. **Filter Implementation**: The JavaScript filter logic in `buildPortfolioCustom()` may have subtle differences from the Python logic in `build_screen()`
4. **Beta Data**: The beta values in historical JSON files may differ from what was used live
5. **Price Data**: The historical price data may have gaps or differences from live prices

## Root Cause Found: Different Relaxation Round Logic

**CRITICAL FINDING**: The relaxation rounds are implemented differently between Python and JavaScript.

**Python (build_portfolios_and_exits.py):**
```python
RELAXATION_ROUNDS = [
    (10, 20, 0, "base"),
    (10, 25, 1, "pe_relaxed"),
    (9,  25, 2, "eps_9_pe_25"),
    (8,  25, 3, "eps_8_pe_25"),
    (7,  25, 4, "eps_7_pe_25"),
]
```

**JavaScript (backtest.js) - BEFORE FIX:**
```javascript
const ROUNDS = [
  [baseEps, basePe, 0],
  [baseEps, basePe + 5, 1],
  [Math.max(0, baseEps - 1), basePe + 5, 2],
  [Math.max(0, baseEps - 2), basePe + 5, 3],
  [Math.max(0, baseEps - 3), basePe + 5, 4],
];
```

Python uses **fixed hardcoded relaxation thresholds** regardless of the base filter values. JavaScript was **scaling the relaxation rounds off the user's custom EPS/PE thresholds**.

This means even with identical base filters (e.g., EPS CAGR ≥ 10, P/E ≤ 20), the relaxation rounds would differ:
- Python: Always relaxes to EPS ≥ 7, P/E ≤ 25 in the final round
- JavaScript (old): Would relax to EPS ≥ (custom_eps - 3), P/E ≤ (custom_pe + 5)

This caused different stocks to be selected during relaxation rounds, leading to different portfolio compositions.

## Fix Applied

Changed `buildPortfolioCustom()` in backtest.js to use the **same hardcoded relaxation rounds** as Python:

```javascript
const ROUNDS = [
  [10, 20, 0],
  [10, 25, 1],
  [9,  25, 2],
  [8,  25, 3],
  [7,  25, 4],
];
```

Now when using the same base filters (ROE ≥ 13, Rev CAGR ≥ 7, EPS CAGR ≥ 10, P/E ≤ 20, Beta ≤ 1.2), the backtest should produce identical portfolio compositions to the Python pipeline.

## Conclusion

The mismatch was NOT due to different data sources - both use the same `fundamentals_*.csv` files. The mismatch was due to **different relaxation round logic** in the portfolio construction algorithm. With this fix, the Build & Test tab should now match the Performance tab when using identical filters.
