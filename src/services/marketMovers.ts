import {
  MoverInfo,
  MoverSnapshot,
  TradingSignal,
  StrategyParams,
  DEFAULT_PARAMS,
} from '../types';
import { tuneParams } from './strategy';

// ─── Storage keys ─────────────────────────────────────────────────────────────

// v2 key forces fresh defaults (lower thresholds tuned for 20%+ movers)
const MOVER_PARAMS_KEY    = 'psf_mover_params_v2';
const MOVER_SNAPSHOTS_KEY = 'psf_mover_snapshots';

// Movers are already moving stocks — use moderate thresholds with wide targets
const MOVER_DEFAULT_PARAMS: StrategyParams = {
  ...DEFAULT_PARAMS,
  buyThreshold:   2.0,   // moderate (movers need momentum, not super strict)
  shortThreshold: 2.5,   // stricter for shorts (SELL SHORT on movers is risky)
  coverThreshold: 1.2,
  sellThreshold:  1.5,
  rsiOversold:    30,    // only SHORT movers near lower RSI if they're rolling over
  rsiOverbought:  72,    // movers can sustain high RSI longer
  targetPct:      0.04,  // 4% day target (movers are volatile)
  stopPct:        0.025, // 2.5% stop
};

// ─── Params persistence ───────────────────────────────────────────────────────

export function loadMoverParams(): StrategyParams {
  try {
    const raw = localStorage.getItem(MOVER_PARAMS_KEY);
    return raw ? { ...MOVER_DEFAULT_PARAMS, ...JSON.parse(raw) } : { ...MOVER_DEFAULT_PARAMS };
  } catch {
    return { ...MOVER_DEFAULT_PARAMS };
  }
}

export function saveMoverParams(p: StrategyParams): void {
  localStorage.setItem(MOVER_PARAMS_KEY, JSON.stringify(p));
}

// ─── Fetch movers from Yahoo Finance scan ─────────────────────────────────────

export async function fetchMarketMovers(limit = 10): Promise<{ gainers: MoverInfo[]; losers: MoverInfo[] }> {
  const res = await fetch(`/api/market-movers?limit=${limit}`);
  if (!res.ok) throw new Error(`Market movers fetch failed: ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    gainers: (data.gainers ?? []) as MoverInfo[],
    losers:  (data.losers  ?? []) as MoverInfo[],
  };
}

// ─── Snapshot storage ─────────────────────────────────────────────────────────

function loadSnapshots(): MoverSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(MOVER_SNAPSHOTS_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Store non-HOLD predictions so we can review them next hour.
 * Prunes entries older than 48 hours to keep localStorage lean.
 */
export function storeMoverSnapshots(
  signals: TradingSignal[],
  moverInfos: MoverInfo[],
): void {
  const existing = loadSnapshots();
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const pruned = existing.filter((s) => s.timestamp > cutoff);

  const now = new Date().toISOString();
  const infoMap = new Map(moverInfos.map((m) => [m.symbol, m]));

  const newEntries: MoverSnapshot[] = signals
    .filter((s) => s.signal !== 'HOLD')
    .map((s) => ({
      id: `${s.symbol}_${now}`,
      timestamp: now,
      symbol: s.symbol,
      signal: s.signal,
      entryPrice: s.entryPrice,
      score: s.score,
      changePercent: infoMap.get(s.symbol)?.changePercent ?? 0,
    }));

  localStorage.setItem(
    MOVER_SNAPSHOTS_KEY,
    JSON.stringify([...pruned, ...newEntries]),
  );
}

// ─── Prediction persistence (server-side) ────────────────────────────────────

export interface PredictionEntry {
  symbol: string;
  signal: string;
  entryPrice: number;
  dayTarget: number;
  dayStop: number;
  swingTarget: number;
  swingStop: number;
}

/** Save today's predictions for a tab to predictions.json on the server. */
export async function savePredictions(tab: 'portfolio' | 'movers', predictions: PredictionEntry[]): Promise<void> {
  if (predictions.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  try {
    await fetch('/api/predictions/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab, date, predictions }),
    });
  } catch { /* non-fatal */ }
}

/** Trigger the 7 PM review on the server and return results. */
export async function runServerReview(tab: 'portfolio' | 'movers'): Promise<RangeReview | null> {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch('/api/predictions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab, date }),
    });
    if (!res.ok) return null;
    return (await res.json()) as RangeReview;
  } catch { return null; }
}

/** Load the range review history for a tab. */
export async function loadRangeReviewHistory(tab: 'portfolio' | 'movers'): Promise<RangeReview[]> {
  try {
    const res = await fetch(`/api/predictions/review-history?tab=${tab}`);
    if (!res.ok) return [];
    return (await res.json()) as RangeReview[];
  } catch { return []; }
}

export interface RangeReviewResult {
  symbol: string;
  signal: string;
  entryPrice: number;
  dayTarget: number;
  swingTarget: number;
  actualPrice: number | null;
  dirCorrect: boolean;
  rangeHitPct: number;   // % of day target range hit
  swingHitPct: number;   // % of swing target range hit
  outcome: 'target-hit' | 'correct-dir' | 'wrong-dir' | 'no-data' | 'error';
}

export interface RangeReview {
  tab: string;
  date: string;
  reviewedAt: string;
  total: number;
  correct: number;
  winRate: number;
  avgRangeHitPct: number;
  summary: string;
  results: RangeReviewResult[];
}

// ─── 7 PM EST review scheduler ───────────────────────────────────────────────

/**
 * Schedules `cb` at 7:00 PM ET every day.
 * Returns a cleanup function that cancels the scheduled call.
 */
export function schedule9PMReview(cb: () => void): () => void {
  // Compute 7 PM ET in local time
  const now    = new Date();
  // Get current ET hour
  const etNow  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const target = new Date(now);
  target.setHours(target.getHours() + (19 - etNow.getHours()), 0, 0, 0); // 19 = 7 PM
  if (now >= target) target.setDate(target.getDate() + 1); // already past → tomorrow

  const delay = target.getTime() - now.getTime();
  let repeatId: ReturnType<typeof setInterval> | null = null;

  const timeoutId = setTimeout(() => {
    cb();
    // Fire every 24 hours after the first trigger
    repeatId = setInterval(cb, 24 * 60 * 60 * 1000);
  }, delay);

  return () => {
    clearTimeout(timeoutId);
    if (repeatId !== null) clearInterval(repeatId);
  };
}

/**
 * Nightly review: compares today's FIRST prediction for each mover
 * against current prices at ~9 PM. Used to tune the strategy overnight.
 */
export function runNightlyMoverReview(
  currentSignals: TradingSignal[],
  currentParams: StrategyParams,
): HourlyReviewResult {
  const snapshots = loadSnapshots();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySnaps = snapshots.filter((s) => s.timestamp >= todayStart.toISOString());

  // Keep only the earliest prediction per symbol (the "morning call")
  const firstBySymbol = new Map<string, MoverSnapshot>();
  for (const snap of todaySnaps) {
    const existing = firstBySymbol.get(snap.symbol);
    if (!existing || snap.timestamp < existing.timestamp) {
      firstBySymbol.set(snap.symbol, snap);
    }
  }

  const earlySnaps = Array.from(firstBySymbol.values());
  if (earlySnaps.length === 0) {
    return {
      winRate: 0.5, correct: 0, total: 0,
      tuningSummary: 'No predictions today to review',
      newParams: currentParams,
    };
  }

  const priceMap = new Map(currentSignals.map((s) => [s.symbol, s.entryPrice]));
  let correct = 0;
  for (const snap of earlySnaps) {
    const currentPrice = priceMap.get(snap.symbol);
    if (currentPrice === undefined) continue;
    const priceMoved = currentPrice - snap.entryPrice;
    const wasBullish = snap.signal === 'BUY' || snap.signal === 'BUY TO COVER';
    const wasBearish = snap.signal === 'SELL SHORT' || snap.signal === 'SELL';
    if ((wasBullish && priceMoved > 0) || (wasBearish && priceMoved < 0)) correct++;
  }

  const winRate = correct / earlySnaps.length;
  const { params: newParams, summary } = tuneParams(winRate, currentParams);

  return {
    winRate, correct,
    total: earlySnaps.length,
    tuningSummary: summary,
    newParams,
  };
}

// ─── Review History (server-side file persistence) ────────────────────────────

export interface ReviewRecord {
  date: string;         // "2026-03-04"
  correct: number;
  total: number;
  winRate: number;
  tuningSummary: string;
  savedAt?: string;     // set by server
}

/** Persist one nightly review result to mover_reviews.json on the server. */
export async function saveReviewRecord(result: HourlyReviewResult): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: today,
        correct: result.correct,
        total: result.total,
        winRate: result.winRate,
        tuningSummary: result.tuningSummary,
      }),
    });
  } catch {
    // Non-fatal
  }
}

/** Load all saved nightly review records from the server. */
export async function loadReviewHistory(): Promise<ReviewRecord[]> {
  try {
    const res = await fetch('/api/review/history');
    if (!res.ok) return [];
    return (await res.json()) as ReviewRecord[];
  } catch {
    return [];
  }
}

// ─── Hourly review + self-tuning ──────────────────────────────────────────────

export interface HourlyReviewResult {
  winRate: number;
  correct: number;
  total: number;
  tuningSummary: string;
  newParams: StrategyParams;
}

/**
 * Compare predictions made ~1 hour ago with current prices.
 * BUY/BTC correct if price went up; SELL/SHORT correct if price went down.
 * Tunes params exactly like the daily review but on an hourly cadence.
 */
export function runHourlyMoverReview(
  currentSignals: TradingSignal[],
  currentParams: StrategyParams,
): HourlyReviewResult {
  const snapshots = loadSnapshots();

  // Window: snapshots between 70 and 130 minutes ago
  const oneHourAgo  = new Date(Date.now() -  70 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 130 * 60 * 1000).toISOString();
  const prevHour = snapshots.filter(
    (s) => s.timestamp >= twoHoursAgo && s.timestamp < oneHourAgo,
  );

  if (prevHour.length === 0) {
    return {
      winRate: 0.5,
      correct: 0,
      total: 0,
      tuningSummary: 'No predictions from previous hour to review',
      newParams: currentParams,
    };
  }

  const priceMap = new Map(currentSignals.map((s) => [s.symbol, s.entryPrice]));

  let correct = 0;
  for (const snap of prevHour) {
    const currentPrice = priceMap.get(snap.symbol);
    if (currentPrice === undefined) continue;

    const priceMoved = currentPrice - snap.entryPrice;
    const wasBullish = snap.signal === 'BUY' || snap.signal === 'BUY TO COVER';
    const wasBearish = snap.signal === 'SELL SHORT' || snap.signal === 'SELL';

    if ((wasBullish && priceMoved > 0) || (wasBearish && priceMoved < 0)) {
      correct++;
    }
  }

  const winRate = correct / prevHour.length;
  const { params: newParams, summary } = tuneParams(winRate, currentParams);

  return {
    winRate,
    correct,
    total: prevHour.length,
    tuningSummary: summary,
    newParams,
  };
}
