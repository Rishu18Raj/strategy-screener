export const SELECTED_SECTORS = new Set([
  "Banks","Financial Services","Media Entertainment & Publication",
  "Information Technology","Telecommunication","Capital Goods",
  "Construction","Consumer Services","Chemicals",
  "Oil Gas & Consumable Fuels","Power","Textiles",
]);

export const FILTERS = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };
export const LAST_REBALANCE = new Date("2026-06-25");
export const NEXT_REBALANCE = new Date("2026-09-25");
export const DATA_QUARTER   = "Q4 FY26";

export const BASE = "https://raw.githubusercontent.com/Rishu18Raj/strategy-screener/main/data";
export const URLS = {
  fundamentals:     `${BASE}/fundamentals.csv`,
  betas:            `${BASE}/betas.json`,
  perfSummary:      `${BASE}/performance_summary.json`,
  nav:              `${BASE}/nav.json`,
  tradeLog:         `${BASE}/trade_log.json`,
  portfolioCurrent: `${BASE}/portfolio_current.json`,
};

// historical portfolio URLs by label
export const PORTFOLIO_SNAPSHOTS = [
  {label:"Jun 2024", year:"2024", month:"Jun", file:"portfolio_2024Q2.json"},
  {label:"Sep 2024", year:"2024", month:"Sep", file:"portfolio_2024Q3.json"},
  {label:"Dec 2024", year:"2024", month:"Dec", file:"portfolio_2024Q4.json"},
  {label:"Mar 2025", year:"2025", month:"Mar", file:"portfolio_2025Q1.json"},
  {label:"Jun 2025", year:"2025", month:"Jun", file:"portfolio_2025Q2.json"},
  {label:"Sep 2025", year:"2025", month:"Sep", file:"portfolio_2025Q3.json"},
  {label:"Dec 2025", year:"2025", month:"Dec", file:"portfolio_2025Q4.json"},
  {label:"Mar 2026", year:"2026", month:"Mar", file:"portfolio_2026Q1.json"},
  {label:"Jun 2026", year:"2026", month:"Jun", file:"portfolio_2026Q2.json"},
];

export const REBALANCE_DATES = new Set([
  "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
  "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]);

export const TABS = [
  {id:"overview",    label:"Overview"},
  {id:"performance", label:"Portfolio Performance"},
  {id:"explore",     label:"Build & Test"},
  {id:"resources",   label:"Resources"},
];

export const SECTOR_COLORS = {
  "Financial Services":"#3b82f6","Diversified":"#6366f1","Capital Goods":"#8b5cf6",
  "Construction Materials":"#a78bfa","Power":"#f59e0b","Banks":"#06b6d4",
  "Fast Moving Consumer Goods":"#10b981","Chemicals":"#14b8a6","Healthcare":"#22c55e",
  "Metals & Mining":"#84cc16","Services":"#eab308","Oil Gas & Consumable Fuels":"#f97316",
  "Consumer Services":"#ef4444","Realty":"#ec4899","Construction":"#d946ef",
  "Information Technology":"#e11d48","Automobile and Auto Components":"#fb7185",
  "Consumer Durables":"#fbbf24","Telecommunication":"#34d399","Textiles":"#a3e635",
  "Media Entertainment & Publication":"#f43f5e",
};

export const C={
  bg:"var(--bg)",card:"var(--bg-card)",hover:"var(--bg-hover)",
  border:"var(--border)",subtle:"var(--border-subtle)",
  primary:"var(--text-primary)",secondary:"var(--text-secondary)",muted:"var(--text-muted)",
  accent:"var(--accent)",accentDim:"var(--accent-dim)",
  green:"var(--green)",greenDim:"var(--green-dim)",
  red:"var(--red)",redDim:"var(--red-dim)",
  amber:"var(--amber)",amberDim:"var(--amber-dim)",
};
