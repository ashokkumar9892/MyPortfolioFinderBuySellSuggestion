// ─── Technical Indicators ─────────────────────────────────────────────────────
// All functions work on arrays of numbers (close prices or volumes).

/** Simple moving average over the last `period` values. */
export function sma(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  if (slice.length < period) return prices[prices.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average — full array result. */
export function emaArray(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/** Latest EMA value. */
export function ema(prices: number[], period: number): number {
  const arr = emaArray(prices, period);
  return arr[arr.length - 1] ?? prices[prices.length - 1] ?? 0;
}

// ─── RSI ──────────────────────────────────────────────────────────────────────

/**
 * Wilder-smoothed RSI (14-period by default).
 * Returns 50 when there is not enough data.
 */
export function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  // Initial averages
  let avgGain =
    gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss =
    losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder smoothing
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD(12, 26, 9).
 * Returns zeros when there is not enough data.
 */
export function macd(prices: number[]): MACDResult {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = emaArray(prices, 12);
  const ema26 = emaArray(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);

  if (macdLine.length < 9) return { macd: 0, signal: 0, histogram: 0 };

  const signalLine = emaArray(macdLine, 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];

  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
  };
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  /** 0 = at lower band, 1 = at upper band */
  percentB: number;
}

/**
 * Bollinger Bands (20-period SMA, configurable multiplier).
 * Falls back to ±2 % when there is not enough data.
 */
export function bollingerBands(
  prices: number[],
  period = 20,
  multiplier = 2.0
): BollingerResult {
  const current = prices[prices.length - 1] ?? 0;
  if (prices.length < period) {
    return {
      upper: current * 1.02,
      middle: current,
      lower: current * 0.98,
      percentB: 0.5,
    };
  }

  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((acc, p) => acc + (p - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = mean + multiplier * stdDev;
  const lower = mean - multiplier * stdDev;
  const range = upper - lower;
  const percentB = range === 0 ? 0.5 : (current - lower) / range;

  return { upper, middle: mean, lower, percentB };
}

// ─── Volume Ratio ─────────────────────────────────────────────────────────────

/**
 * Current volume vs the 20-period average of prior bars.
 * Returns 1 when there is not enough history.
 */
export function volumeRatio(volumes: number[], period = 20): number {
  if (volumes.length < 2) return 1;
  const current = volumes[volumes.length - 1];
  const prior = volumes.slice(-Math.min(period + 1, volumes.length), -1);
  if (prior.length === 0) return 1;
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  return avg === 0 ? 1 : current / avg;
}
