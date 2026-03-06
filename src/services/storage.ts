import {
  StoredPrediction,
  DailyReview,
  StrategyParams,
  DEFAULT_PARAMS,
  TradingSignal,
} from '../types';
import { tuneParams } from './strategy';
import { fetchStock } from './stockApi';

// ─── Keys ─────────────────────────────────────────────────────────────────────

const KEYS = {
  PREDICTIONS: 'psf_predictions',
  PARAMS: 'psf_strategy_params',
  REVIEWS: 'psf_daily_reviews',
  LAST_REVIEW: 'psf_last_review_date',
} as const;

// ─── Strategy Params ──────────────────────────────────────────────────────────

export function loadParams(): StrategyParams {
  try {
    const raw = localStorage.getItem(KEYS.PARAMS);
    return raw ? { ...DEFAULT_PARAMS, ...JSON.parse(raw) } : { ...DEFAULT_PARAMS };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

export function saveParams(p: StrategyParams): void {
  localStorage.setItem(KEYS.PARAMS, JSON.stringify(p));
}

// ─── Predictions ──────────────────────────────────────────────────────────────

export function loadPredictions(): StoredPrediction[] {
  try {
    const raw = localStorage.getItem(KEYS.PREDICTIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePredictions(preds: StoredPrediction[]): void {
  localStorage.setItem(KEYS.PREDICTIONS, JSON.stringify(preds));
}

/** Upsert a prediction (matched by id). */
export function upsertPrediction(pred: StoredPrediction): void {
  const all = loadPredictions();
  const idx = all.findIndex((p) => p.id === pred.id);
  if (idx >= 0) all[idx] = pred;
  else all.push(pred);
  savePredictions(all);
}

/** Store the first signal for today for each symbol (skip HOLDs). */
export function storeTodaySignals(signals: TradingSignal[]): void {
  const today = new Date().toDateString();
  const existing = loadPredictions();
  const existingIds = new Set(
    existing
      .filter((p) => p.date === today)
      .map((p) => p.symbol)
  );

  const toAdd: StoredPrediction[] = signals
    .filter((s) => s.signal !== 'HOLD' && !existingIds.has(s.symbol))
    .map((s) => ({
      id: `${today}__${s.symbol}`,
      date: today,
      symbol: s.symbol,
      signal: s.signal,
      score: s.score,
      entryPrice: s.entryPrice,
      exitTarget: s.exitTarget,
      stopLoss: s.stopLoss,
      confidence: s.confidence,
      reasons: s.reasons,
      timestamp: s.timestamp,
    }));

  if (toAdd.length > 0) {
    savePredictions([...existing, ...toAdd]);
  }
}

/** Update a prediction's signal (when it changes direction during the day). */
export function updateSignalForToday(signal: TradingSignal): void {
  const today = new Date().toDateString();
  if (signal.signal === 'HOLD') return;
  const all = loadPredictions();
  const id = `${today}__${signal.symbol}`;
  const idx = all.findIndex((p) => p.id === id);
  if (idx >= 0) {
    // Update existing entry
    all[idx] = {
      ...all[idx],
      signal: signal.signal,
      score: signal.score,
      entryPrice: signal.entryPrice,
      exitTarget: signal.exitTarget,
      stopLoss: signal.stopLoss,
      confidence: signal.confidence,
      reasons: signal.reasons,
      timestamp: signal.timestamp,
    };
    savePredictions(all);
  } else {
    storeTodaySignals([signal]);
  }
}

export function todayPredictions(): StoredPrediction[] {
  const today = new Date().toDateString();
  return loadPredictions().filter((p) => p.date === today);
}

// ─── Daily Reviews ────────────────────────────────────────────────────────────

export function loadReviews(): DailyReview[] {
  try {
    const raw = localStorage.getItem(KEYS.REVIEWS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveReviews(reviews: DailyReview[]): void {
  localStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));
}

export function lastReviewDate(): string {
  return localStorage.getItem(KEYS.LAST_REVIEW) ?? '';
}

function setLastReviewDate(date: string): void {
  localStorage.setItem(KEYS.LAST_REVIEW, date);
}

// ─── End-of-Day Review (runs at 7 PM) ────────────────────────────────────────

/**
 * Fetch current prices for all predicted symbols, evaluate predictions,
 * compute win rate, tune params, and persist everything.
 * Returns the DailyReview record.
 */
export async function runEndOfDayReview(
  currentParams: StrategyParams,
  onProgress?: (msg: string) => void
): Promise<DailyReview> {
  const today = new Date().toDateString();
  const preds = todayPredictions().filter((p) => p.signal !== 'HOLD');

  onProgress?.(`Reviewing ${preds.length} predictions for ${today}…`);

  // Fetch closing price for each symbol
  const symbolSet = [...new Set(preds.map((p) => p.symbol))];
  const priceMap = new Map<string, number>();

  for (const sym of symbolSet) {
    onProgress?.(`Fetching closing price for ${sym}…`);
    const data = await fetchStock(sym);
    if (data && data.currentPrice > 0) {
      priceMap.set(sym, data.currentPrice);
    }
  }

  // Evaluate each prediction
  let correct = 0;
  let totalPL = 0;
  const updated: StoredPrediction[] = [];

  for (const pred of preds) {
    const closingPrice = priceMap.get(pred.symbol) ?? pred.entryPrice;
    let wasCorrect = false;
    let profitLossPct = 0;

    if (pred.signal === 'BUY' || pred.signal === 'BUY TO COVER') {
      wasCorrect = closingPrice > pred.entryPrice;
      profitLossPct =
        ((closingPrice - pred.entryPrice) / pred.entryPrice) * 100;
    } else if (pred.signal === 'SELL SHORT' || pred.signal === 'SELL') {
      wasCorrect = closingPrice < pred.entryPrice;
      profitLossPct =
        ((pred.entryPrice - closingPrice) / pred.entryPrice) * 100;
    }

    if (wasCorrect) correct++;
    totalPL += profitLossPct;

    updated.push({
      ...pred,
      reviewedAt: new Date().toISOString(),
      closingPrice,
      wasCorrect,
      profitLossPct: parseFloat(profitLossPct.toFixed(3)),
    });
  }

  // Persist updated predictions
  updated.forEach(upsertPrediction);

  const actionable = preds.length;
  const winRate = actionable > 0 ? correct / actionable : 0;
  const avgPL = actionable > 0 ? totalPL / actionable : 0;

  // Tune parameters
  const { params: newParams, summary } = tuneParams(winRate, currentParams);
  saveParams(newParams);

  const review: DailyReview = {
    date: today,
    totalPredictions: todayPredictions().length,
    actionablePredictions: actionable,
    correctPredictions: correct,
    winRate: parseFloat(winRate.toFixed(4)),
    avgProfitLossPct: parseFloat(avgPL.toFixed(3)),
    paramsBefore: currentParams,
    paramsAfter: newParams,
    tuningSummary: summary,
    timestamp: new Date().toISOString(),
  };

  const reviews = loadReviews();
  // Replace any existing review for today
  const existingIdx = reviews.findIndex((r) => r.date === today);
  if (existingIdx >= 0) reviews[existingIdx] = review;
  else reviews.push(review);
  saveReviews(reviews);

  setLastReviewDate(today);
  onProgress?.(`Review complete. Win rate: ${(winRate * 100).toFixed(0)}%.`);

  return review;
}

// ─── 7 PM auto-review scheduler ──────────────────────────────────────────────

/**
 * Sets up a timer that fires exactly at 19:00 local time each day.
 * Returns a cleanup function.
 */
export function schedule7PMReview(
  cb: (params: StrategyParams) => void
): () => void {
  function msUntil7PM(): number {
    const now = new Date();
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      19,
      0,
      0,
      0
    );
    // If 7 PM already passed today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  let timeoutId: ReturnType<typeof setTimeout>;

  function scheduleNext() {
    const ms = msUntil7PM();
    timeoutId = setTimeout(() => {
      cb(loadParams());
      scheduleNext(); // schedule the next day
    }, ms);
  }

  scheduleNext();
  return () => clearTimeout(timeoutId);
}
