import fs from "node:fs/promises";
import path from "node:path";

const CACHE_FILE = path.resolve("data/cache/prices.json");
const CACHE_TTL_MS = 30 * 60 * 1000;
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

let memoryCache = null;

// Calendar date (YYYY-MM-DD) of a unix timestamp in the given IANA time zone.
function dateInZone(unixSeconds, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

async function fetchSymbol(symbol, startDate) {
  const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `${YAHOO_URL}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${symbol}`);
  const body = await res.json();
  if (body.chart.error) throw new Error(`${symbol}: ${body.chart.error.description}`);

  const result = body.chart.result[0];
  const meta = result.meta;
  const timeZone = meta.exchangeTimezoneName || "UTC";
  const closes = result.indicators.quote[0].close || [];
  const timestamps = result.timestamp || [];

  const nowSeconds = Date.now() / 1000;
  const today = dateInZone(nowSeconds, timeZone);
  // Today's bar only counts once the regular session is over. For crypto the
  // "session" is the whole UTC day, so today's candle is never final.
  const sessionEnd = meta.currentTradingPeriod?.regular?.end ?? Infinity;
  const todayIsClosed = nowSeconds >= sessionEnd;

  const byDate = new Map();
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (close == null) return;
    const date = dateInZone(ts, timeZone);
    if (date < startDate) return;
    if (date > today || (date === today && !todayIsClosed)) return;
    byDate.set(date, close);
  });

  return {
    symbol,
    currency: meta.currency,
    exchange: meta.fullExchangeName || meta.exchangeName,
    timeZone,
    closes: [...byDate].map(([date, close]) => ({ date, close })),
  };
}

export async function getPrices(portfolio, { force = false } = {}) {
  if (!memoryCache) {
    try {
      memoryCache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
    } catch {
      memoryCache = null;
    }
  }
  const fresh = memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS;
  if (fresh && !force) return memoryCache;

  let entries;
  try {
    entries = await Promise.all(
      portfolio.assets.map(async (asset) => [asset.id, await fetchSymbol(asset.symbol, portfolio.startDate)]),
    );
  } catch (err) {
    // Serve the last good data rather than an empty dashboard.
    if (memoryCache) return { ...memoryCache, stale: true, error: err.message };
    throw err;
  }
  memoryCache = { fetchedAt: Date.now(), series: Object.fromEntries(entries) };
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(memoryCache));
  return memoryCache;
}
