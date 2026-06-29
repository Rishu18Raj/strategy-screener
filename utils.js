// ── design tokens ─────────────────────────────────────────────
export const C = {
  bg:"var(--bg)", card:"var(--bg-card)", hover:"var(--bg-hover)",
  border:"var(--border)", subtle:"var(--border-subtle)",
  primary:"var(--text-primary)", secondary:"var(--text-secondary)", muted:"var(--text-muted)",
  accent:"var(--accent)", accentDim:"var(--accent-dim)",
  green:"var(--green)", greenDim:"var(--green-dim)",
  red:"var(--red)", redDim:"var(--red-dim)",
  amber:"var(--amber)", amberDim:"var(--amber-dim)",
};

// ── sector colours ────────────────────────────────────────────
export const SECTOR_COLORS = {
  "Financial Services":                "#3b82f6",
  "Diversified":                       "#6366f1",
  "Capital Goods":                     "#8b5cf6",
  "Construction Materials":            "#a78bfa",
  "Power":                             "#f59e0b",
  "Banks":                             "#06b6d4",
  "Fast Moving Consumer Goods":        "#10b981",
  "Chemicals":                         "#14b8a6",
  "Healthcare":                        "#22c55e",
  "Metals & Mining":                   "#84cc16",
  "Services":                          "#eab308",
  "Oil Gas & Consumable Fuels":        "#f97316",
  "Consumer Services":                 "#ef4444",
  "Realty":                            "#ec4899",
  "Construction":                      "#d946ef",
  "Information Technology":            "#e11d48",
  "Automobile and Auto Components":    "#fb7185",
  "Consumer Durables":                 "#fbbf24",
  "Telecommunication":                 "#34d399",
  "Textiles":                          "#a3e635",
  "Media Entertainment & Publication": "#f43f5e",
};

// ── strategy constants ────────────────────────────────────────
export const SELECTED_SECTORS = new Set([
  "Banks","Financial Services","Media Entertainment & Publication",
  "Information Technology","Telecommunication","Capital Goods",
  "Construction","Consumer Services","Chemicals",
  "Oil Gas & Consumable Fuels","Power","Textiles",
]);

export const FILTERS       = { roe:13, revCAGR:7, epsCAGR:10, beta:1.2, pe:20 };
export const FILTERS_FIXED = { roe:13, revCAGR:7, beta:1.2 };
export const RELAXATION_ROUNDS = [
  [10, 20, 0, "base"],
  [10, 25, 1, "pe_relaxed"],
  [9,  25, 2, "eps_9_pe_25"],
  [8,  25, 3, "eps_8_pe_25"],
  [7,  25, 4, "eps_7_pe_25"],
];
export const MIN_PORTFOLIO_SIZE = 6;

export const LAST_REBALANCE = new Date("2026-06-25");
export const NEXT_REBALANCE = new Date("2026-09-25");

export const REBALANCE_DATES = new Set([
  "2024-06-25","2024-09-25","2024-12-25","2025-03-25",
  "2025-06-25","2025-09-25","2025-12-25","2026-03-25","2026-06-25",
]);

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

// ── helpers ───────────────────────────────────────────────────
export function fmtDate(d) {
  return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}

export function daysUntil(d) {
  return Math.ceil((d - new Date()) / 864e5);
}

export function growthScore(s) {
  return s.pe > 0 ? (s.epsCAGR || 0) / s.pe : 0;
}

export function passesFundamentals(s, epsThresh, peThresh) {
  try {
    return (
      !isNaN(s.roe)     && s.roe     >= FILTERS_FIXED.roe     &&
      !isNaN(s.revCAGR) && s.revCAGR >= FILTERS_FIXED.revCAGR &&
      !isNaN(s.epsCAGR) && s.epsCAGR >= epsThresh             &&
      !isNaN(s.pe)      && s.pe      <= peThresh
    );
  } catch { return false; }
}

export function getSectorCaps(all) {
  const c = {};
  all.forEach(s=>{ if(s.sector) c[s.sector] = (c[s.sector]||0)+1; });
  return Object.fromEntries(
    Object.entries(c).map(([k,v])=>[k, Math.min(3, Math.max(1, Math.floor(0.2*v)))])
  );
}

export function buildPortfolio(stocks) {
  const caps = getSectorCaps(stocks);
  let fp=0, sp=0, bp=0, portfolio=[], roundUsed=0;

  for (const [eps, pe, rnd] of RELAXATION_ROUNDS) {
    const fund = stocks.filter(s => passesFundamentals(s, eps, pe));
    const sec  = fund.filter(s => SELECTED_SECTORS.has(s.sector));
    const bet  = sec.filter(s => s.beta != null && s.beta <= FILTERS_FIXED.beta);
    if (rnd === 0) { fp=fund.length; sp=sec.length; bp=bet.length; }

    const bySec = {};
    bet.forEach(s => bySec[s.sector] ? bySec[s.sector].push(s) : bySec[s.sector]=[s]);

    const cands = [];
    Object.entries(bySec).forEach(([sec, ss]) => {
      const cap = caps[sec] || 1;
      [...ss].sort((a,b) => growthScore(b)-growthScore(a)).slice(0,cap).forEach(s =>
        cands.push({...s, filter_round:rnd})
      );
    });

    if (cands.length >= MIN_PORTFOLIO_SIZE || rnd === RELAXATION_ROUNDS.at(-1)[2]) {
      portfolio = cands; roundUsed = rnd; break;
    }
  }
  return { portfolio, fp, sp, bp, roundUsed };
}

// ── shared UI primitives ──────────────────────────────────────
export const pill = (bg, color, label) => (
  <span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:bg,color,
    fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{label}</span>
);