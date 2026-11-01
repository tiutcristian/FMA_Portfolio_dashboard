const TRADING_DAYS = 252;
const CALENDAR_DAYS = 365;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function correlation(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    dx += (x - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  });
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// Largest peak-to-trough fall, starting from the initial value.
function maxDrawdown(points, initial) {
  let peak = { value: initial, date: null };
  let worst = { pct: 0, peakDate: null, troughDate: null };
  for (const p of points) {
    if (p.value > peak.value) peak = p;
    const dd = (p.value / peak.value - 1) * 100;
    if (dd < worst.pct) worst = { pct: dd, peakDate: peak.date, troughDate: p.date };
  }
  return worst;
}

// Daily % changes, where the first day is measured against the initial value.
function dailyReturns(points, initial) {
  let prev = initial;
  return points.map((p) => {
    const pct = (p.value / prev - 1) * 100;
    prev = p.value;
    return { date: p.date, pct };
  });
}

function returnStats(returns, periodsPerYear) {
  const pcts = returns.map((r) => r.pct);
  const sd = stdev(pcts);
  const sorted = [...returns].sort((a, b) => a.pct - b.pct);
  return {
    observations: returns.length,
    avgDailyPct: pcts.length ? mean(pcts) : null,
    dailyVolPct: sd,
    annualVolPct: sd == null ? null : sd * Math.sqrt(periodsPerYear),
    bestDay: sorted.at(-1) ?? null,
    worstDay: sorted[0] ?? null,
    upDays: pcts.filter((x) => x > 0).length,
    downDays: pcts.filter((x) => x < 0).length,
  };
}

export function buildDashboard(portfolio, prices) {
  const totalInitial = portfolio.assets.reduce((a, x) => a + x.allocation, 0);

  const assets = portfolio.assets.map((asset) => {
    const feed = prices.series[asset.id];
    const units = asset.allocation / asset.initialPrice;
    const isCrypto = asset.category === "Crypto";
    const history = feed.closes.map(({ date, close }) => ({
      date,
      close,
      value: units * close,
      changePct: (close / asset.initialPrice - 1) * 100,
    }));
    const returns = dailyReturns(history, asset.allocation);
    history.forEach((h, i) => (h.dailyPct = returns[i].pct));

    const last = history.at(-1);
    const value = last ? last.value : asset.allocation;
    const closes = history.map((h) => h.close);
    return {
      ...asset,
      units,
      currency: feed.currency,
      exchange: feed.exchange,
      timeZone: feed.timeZone,
      history,
      lastClose: last?.close ?? null,
      lastDate: last?.date ?? null,
      value,
      pnl: value - asset.allocation,
      returnPct: (value / asset.allocation - 1) * 100,
      high: closes.length ? Math.max(...closes) : null,
      low: closes.length ? Math.min(...closes) : null,
      weightInitialPct: (asset.allocation / totalInitial) * 100,
      contributionPct: ((value - asset.allocation) / totalInitial) * 100,
      maxDrawdown: maxDrawdown(history, asset.allocation),
      stats: returnStats(returns, isCrypto ? CALENDAR_DAYS : TRADING_DAYS),
    };
  });

  // Portfolio value on every date any asset has a close, carrying each
  // asset's last known close forward (e.g. ETFs over a weekend while BTC moves).
  const dates = [...new Set(assets.flatMap((a) => a.history.map((h) => h.date)))].sort();
  const cursors = assets.map(() => 0);
  const lastValues = assets.map((a) => a.allocation);
  const series = dates.map((date) => {
    const byAsset = {};
    assets.forEach((a, i) => {
      while (cursors[i] < a.history.length && a.history[cursors[i]].date <= date) {
        lastValues[i] = a.history[cursors[i]].value;
        cursors[i] += 1;
      }
      byAsset[a.id] = lastValues[i];
    });
    const value = Object.values(byAsset).reduce((x, y) => x + y, 0);
    return { date, value, returnPct: (value / totalInitial - 1) * 100, assets: byAsset };
  });

  // Risk stats use exchange trading days only, so weekend crypto moves fold
  // into the next trading day instead of diluting volatility.
  const tradingDates = new Set(
    assets.filter((a) => a.category !== "Crypto").flatMap((a) => a.history.map((h) => h.date)),
  );
  const tradingSeries = series.filter((p) => tradingDates.has(p.date));
  const portfolioReturns = dailyReturns(tradingSeries, totalInitial);

  const assetReturnsOnTradingDays = assets.map((a) =>
    dailyReturns(
      tradingSeries.map((p) => ({ date: p.date, value: p.assets[a.id] })),
      a.allocation,
    ).map((r) => r.pct),
  );
  const correlations = assets.map((_, i) =>
    assets.map((__, j) => correlation(assetReturnsOnTradingDays[i], assetReturnsOnTradingDays[j])),
  );

  const lastPoint = series.at(-1);
  const value = lastPoint ? lastPoint.value : totalInitial;
  const ranked = [...assets].sort((a, b) => b.returnPct - a.returnPct);
  const evaluation = Date.parse(`${portfolio.evaluationDate}T00:00:00Z`);
  const currentValues = assets.map((a) => a.value);

  return {
    meta: {
      student: portfolio.student,
      group: portfolio.group,
      currency: portfolio.currency,
      startDate: portfolio.startDate,
      evaluationDate: portfolio.evaluationDate,
      daysToEvaluation: Math.max(0, Math.ceil((evaluation - Date.now()) / 86_400_000)),
      dataThrough: lastPoint?.date ?? null,
      fetchedAt: prices.fetchedAt,
      stale: Boolean(prices.stale),
      fetchError: prices.error ?? null,
    },
    portfolio: {
      initialValue: totalInitial,
      value,
      pnl: value - totalInitial,
      returnPct: (value / totalInitial - 1) * 100,
      maxDrawdown: maxDrawdown(series, totalInitial),
      stats: returnStats(portfolioReturns, TRADING_DAYS),
      best: { id: ranked[0].id, returnPct: ranked[0].returnPct },
      worst: { id: ranked.at(-1).id, returnPct: ranked.at(-1).returnPct },
      currentWeights: Object.fromEntries(
        assets.map((a, i) => [a.id, (currentValues[i] / value) * 100]),
      ),
      series,
      correlations: { ids: assets.map((a) => a.id), matrix: correlations },
    },
    assets,
  };
}
