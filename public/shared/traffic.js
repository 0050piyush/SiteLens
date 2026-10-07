// Rank-to-visits model shared by the server and the browser-only mode.

// Calibration of monthly visits against rank, fitted to publicly reported
// figures for well-known sites. Power law: visits = A * rank^-B.
const A = 85e9;
const B = 1.15;

export function visitsForRank(rank) {
  return rank ? A * Math.pow(rank, -B) : null;
}

export function trafficEstimate(rankInfo) {
  if (!rankInfo?.rank) {
    return {
      available: false,
      note: rankInfo && rankInfo.apiReachable === false && !rankInfo.rank
        ? 'The ranking service could not be reached, so there is no traffic estimate right now.'
        : 'This site is outside the Tranco top 1M, so it likely gets under ~10k visits per month. We do not invent numbers for sites we cannot rank.',
      rankUnavailable: !!(rankInfo && rankInfo.apiReachable === false && !rankInfo.rank),
    };
  }
  const mid = visitsForRank(rankInfo.rank);
  const history = rankInfo.history.map((h) => ({ date: h.date, visits: Math.round(visitsForRank(h.rank)) }));
  const first = history[0]?.visits;
  const last = history.at(-1)?.visits;
  return {
    available: true,
    monthlyVisits: Math.round(mid),
    low: Math.round(mid * 0.5),
    high: Math.round(mid * 1.8),
    dailyVisits: Math.round(mid / 30.4),
    trendPct: first && last && history.length > 1 ? Math.round(((last - first) / first) * 1000) / 10 : null,
    history,
    model: `visits ≈ ${A.toExponential(2)} × rank^-${B}`,
    confidence: rankInfo.rank <= 10000 ? 'medium' : rankInfo.rank <= 200000 ? 'low' : 'very low',
    note: 'Modelled from Tranco rank with a power-law fit. Ranks blend DNS and browser data, so infrastructure domains (CDNs, APIs) can rank higher than their human traffic.',
  };
}
