import { StockData, MonthlyRangeData, MonthData } from '../types';

const BASE = '/api'; // proxied by Vite → Express on :7001

// ─── Types returned by Yahoo Finance ─────────────────────────────────────────

interface YFQuote {
  open:   (number | null)[];
  high:   (number | null)[];
  low:    (number | null)[];
  close:  (number | null)[];
  volume: (number | null)[];
}

interface YFMeta {
  currency: string;
  symbol: string;
  regularMarketPrice:     number;
  regularMarketDayHigh?:  number;   // regular session high (not extended)
  regularMarketDayLow?:   number;   // regular session low  (not extended)
  regularMarketOpen?:     number;
  previousClose?:         number;
  chartPreviousClose?:    number;
  currentTradingPeriod?: {
    pre?:     { start: number; end: number };
    regular?: { start: number; end: number };
    post?:    { start: number; end: number };
  };
}

interface YFResult {
  meta: YFMeta;
  timestamp?: number[];
  indicators: { quote: YFQuote[] };
}

// ─── Parse Yahoo Finance response ────────────────────────────────────────────

function parseYF(
  symbol: string,
  data: { chart?: { result?: YFResult[] } },
): StockData | null {
  const result = data.chart?.result?.[0];
  if (!result) return null;

  const meta  = result.meta;
  const quote = result.indicators?.quote?.[0];
  if (!quote) return null;

  const closes  = (quote.close  ?? []).filter((v): v is number => v !== null);
  const volumes = (quote.volume ?? []).filter((v): v is number => v !== null);
  if (closes.length === 0) return null;

  const currentPrice  = meta.regularMarketPrice ?? closes[closes.length - 1];
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? currentPrice;

  // Prefer Yahoo's regular-session day high/low (excludes pre/post market spikes).
  // Fall back to computed range only if meta values are missing.
  const dayHigh = meta.regularMarketDayHigh ?? Math.max(...closes);
  const dayLow  = meta.regularMarketDayLow  ?? Math.min(...closes);

  return {
    symbol:        symbol.toUpperCase(),
    currentPrice,
    previousClose,
    open:          meta.regularMarketOpen ?? closes[0],
    high:          dayHigh,
    low:           dayLow,
    volume:        volumes[volumes.length - 1] ?? 0,
    priceHistory:  closes,
    volumeHistory: volumes,
    lastUpdated:   new Date(),
  };
}

// ─── Public fetch API ─────────────────────────────────────────────────────────

/** Fetch a single stock's intraday 5-minute chart (includes pre/post market). */
export async function fetchStock(symbol: string): Promise<StockData | null> {
  try {
    const res = await fetch(`${BASE}/stock/${symbol}?interval=5m&range=1d`);
    if (!res.ok) return null;
    return parseYF(symbol, await res.json());
  } catch {
    return null;
  }
}

/**
 * Fetch all symbols via the batch endpoint.
 * Falls back to parallel individual requests if batch fails.
 */
export async function fetchAllStocks(symbols: string[]): Promise<StockData[]> {
  try {
    const res = await fetch(`${BASE}/stocks/batch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbols, interval: '5m', range: '1d' }),
    });
    if (!res.ok) throw new Error('Batch failed');

    const batch: Record<string, { success: boolean; data?: unknown; error?: string }> =
      await res.json();

    return symbols.map((sym) => {
      const entry = batch[sym];
      if (entry?.success && entry.data) {
        const parsed = parseYF(sym, entry.data as { chart?: { result?: YFResult[] } });
        return parsed ?? makeError(sym, 'Parse failed');
      }
      return makeError(sym, entry?.error ?? 'Unknown error');
    });
  } catch {
    const settled = await Promise.allSettled(symbols.map(fetchStock));
    return settled.map((r, i) =>
      r.status === 'fulfilled' && r.value ? r.value : makeError(symbols[i], 'Fetch failed')
    );
  }
}

/**
 * Fetch 6 months of daily candles for all symbols.
 * Returns actual high/low per calendar month + 3 projected future months.
 */
export async function fetchMonthlyRanges(
  symbols: string[],
): Promise<Record<string, MonthlyRangeData>> {
  try {
    const res = await fetch(`${BASE}/stocks/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols, interval: '1d', range: '6mo' }),
    });
    if (!res.ok) throw new Error('Batch failed');
    const batch: Record<string, { success: boolean; data?: unknown; error?: string }> =
      await res.json();

    const result: Record<string, MonthlyRangeData> = {};

    for (const sym of symbols) {
      const entry = batch[sym];
      if (!entry?.success || !entry.data) continue;
      const r = (entry.data as { chart?: { result?: YFResult[] } }).chart?.result?.[0];
      if (!r) continue;
      const q = r.indicators?.quote?.[0];
      const timestamps = r.timestamp ?? [];
      if (!q || !timestamps.length) continue;

      const currentPrice: number = r.meta.regularMarketPrice ?? 0;

      // ── Group daily highs/lows into calendar month buckets ──────────────
      const buckets: Record<string, { highs: number[]; lows: number[]; closes: number[] }> = {};
      timestamps.forEach((ts, i) => {
        const d = new Date(ts * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!buckets[key]) buckets[key] = { highs: [], lows: [], closes: [] };
        if (q.high[i]  != null) buckets[key].highs.push(q.high[i] as number);
        if (q.low[i]   != null) buckets[key].lows.push(q.low[i] as number);
        if (q.close[i] != null) buckets[key].closes.push(q.close[i] as number);
      });

      // ── Build actual MonthData from buckets ──────────────────────────────
      const months: Record<string, MonthData> = {};
      const monthRangePcts: number[] = [];

      for (const [key, bucket] of Object.entries(buckets)) {
        if (!bucket.highs.length || !bucket.lows.length) continue;
        const [yearStr, moStr] = key.split('-');
        const year = parseInt(yearStr);
        const mo   = parseInt(moStr);     // 1-12
        const high = Math.max(...bucket.highs);
        const low  = Math.min(...bucket.lows);
        const midClose = bucket.closes[Math.floor(bucket.closes.length / 2)] || currentPrice;
        if (midClose > 0) monthRangePcts.push((high - low) / midClose);
        const label = new Date(year, mo - 1, 1)
          .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        months[key] = { label, key, high, low, isProjected: false };
      }

      // ── Project 3 future months using avg monthly volatility × √N ───────
      const avgRangePct = monthRangePcts.length
        ? monthRangePcts.reduce((a, b) => a + b, 0) / monthRangePcts.length
        : 0.10;   // fallback 10%

      const now = new Date();
      for (let n = 1; n <= 3; n++) {
        const d = new Date(now.getFullYear(), now.getMonth() + n, 1);
        const yr = d.getFullYear();
        const mo = d.getMonth() + 1;
        const key = `${yr}-${String(mo).padStart(2, '0')}`;
        if (months[key]) continue;   // already have actual data
        const halfRange = (avgRangePct / 2) * Math.sqrt(n);
        const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        months[key] = {
          label, key,
          high: parseFloat((currentPrice * (1 + halfRange)).toFixed(2)),
          low:  parseFloat((currentPrice * (1 - halfRange)).toFixed(2)),
          isProjected: true,
        };
      }

      result[sym.toUpperCase()] = { symbol: sym.toUpperCase(), months };
    }
    return result;
  } catch {
    return {};
  }
}

function makeError(symbol: string, error: string): StockData {
  return {
    symbol: symbol.toUpperCase(),
    currentPrice: 0, previousClose: 0,
    open: 0, high: 0, low: 0, volume: 0,
    priceHistory: [], volumeHistory: [],
    lastUpdated: new Date(),
    error,
  };
}

// ─── Market Session (Eastern Time) ───────────────────────────────────────────
// Uses Intl / toLocaleString for correct DST handling — no manual UTC offsets.
// Session windows (ET):
//   Pre-market  : 07:00 – 09:29
//   Regular     : 09:30 – 15:59
//   After-hours : 16:00 – 20:00
//   Closed      : everything else / weekends

export type MarketSession = 'pre' | 'regular' | 'after' | 'closed';

function getETTime(): { day: number; mins: number } {
  const now = new Date();
  // toLocaleString in 'America/New_York' handles EST/EDT automatically
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return {
    day:  et.getDay(),                        // 0=Sun, 6=Sat
    mins: et.getHours() * 60 + et.getMinutes(),
  };
}

export function marketSession(): MarketSession {
  const { day, mins } = getETTime();
  if (day === 0 || day === 6) return 'closed';         // weekend

  if (mins >= 7 * 60      && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60)     return 'regular';
  if (mins >= 16 * 60     && mins < 20 * 60)      return 'after';
  return 'closed';
}

/** True any time from 7 AM to 8 PM ET on weekdays. */
export function isMarketOpen(): boolean {
  return marketSession() !== 'closed';
}

/** Human-readable label + emoji for the current session. */
export function marketStatusLabel(): string {
  switch (marketSession()) {
    case 'pre':     return '🌅 Pre-Market';
    case 'regular': return '🟢 Market Open';
    case 'after':   return '🌙 After-Hours';
    case 'closed':  return '🔴 Market Closed';
  }
}
