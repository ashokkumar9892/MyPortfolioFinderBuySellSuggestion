// ─── Stock Data ───────────────────────────────────────────────────────────────

export interface StockData {
  symbol: string;
  currentPrice: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  priceHistory: number[];   // intraday 5-min close prices
  volumeHistory: number[];  // intraday 5-min volumes
  lastUpdated: Date;
  error?: string;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

export interface TechnicalIndicators {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercentB: number;   // 0–1: 0=lower band, 1=upper band
  volumeRatio: number;  // current / 20-period average
  ema20: number;
  momentum: number;     // % change from previous close
}

// ─── Trading Signal ───────────────────────────────────────────────────────────

export type SignalType =
  | 'BUY'          // Open long — strong bullish
  | 'BUY TO COVER' // Close short — mild bullish
  | 'HOLD'         // No clear edge
  | 'SELL'         // Close long — mild bearish
  | 'SELL SHORT';  // Open short — strong bearish

export interface TradingSignal {
  symbol: string;
  signal: SignalType;
  score: number;
  entryPrice: number;
  exitTarget: number;
  stopLoss: number;
  riskRewardRatio: number;
  confidence: number;   // 0–100
  indicators: TechnicalIndicators;
  reasons: string[];
  timestamp: string;    // ISO string
  // ── Day range data ────────────────────────────────────────────
  dayHigh: number;
  dayLow: number;
  dayOpen: number;
  prevClose: number;
  intradayChange: number;       // % change from today's open
  // ── Intraday direction forecast ───────────────────────────────
  todayDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  todayDirectionConfidence: number;  // 0–100
  todayDirectionReasons: string[];
  // ── Trade mode context ────────────────────────────────────────
  tradeMode: 'DAY' | 'SWING';
  swingExitDate: string;      // e.g. "Tomorrow" or "+2 days"
  swingTarget: number;        // wider % target for swing
  swingStop: number;          // wider stop for swing
}

// ─── Trade Mode ────────────────────────────────────────────────────────────────
export type TradeMode = 'DAY' | 'SWING';

// ─── Strategy Parameters (tuned over time) ────────────────────────────────────

export interface StrategyParams {
  rsiOversold: number;       // default 30
  rsiOverbought: number;     // default 70
  buyThreshold: number;      // score >= this → BUY       (default 2.5)
  coverThreshold: number;    // score >= this → BTC        (default 1.2)
  sellThreshold: number;     // score <= -this → SELL      (default 1.2)
  shortThreshold: number;    // score <= -this → SHORT     (default 2.5)
  minVolumeRatio: number;    // default 1.5×
  bbMultiplier: number;      // default 2.0
  targetPct: number;         // exit target %             (default 0.025)
  stopPct: number;           // stop loss %               (default 0.015)
}

export const DEFAULT_PARAMS: StrategyParams = {
  rsiOversold: 32,       // stricter oversold (was 35)
  rsiOverbought: 68,     // stricter overbought (was 65)
  buyThreshold: 2.5,     // higher conviction required (was 1.5)
  coverThreshold: 1.5,   // was 0.8
  sellThreshold: 1.5,    // was 0.8
  shortThreshold: 2.5,   // was 1.5
  minVolumeRatio: 1.2,
  bbMultiplier: 2.0,
  targetPct: 0.025,
  stopPct: 0.015,
};

// ─── Stored Prediction ────────────────────────────────────────────────────────

export interface StoredPrediction {
  id: string;
  date: string;           // "Mon Mar 03 2025"
  symbol: string;
  signal: SignalType;
  score: number;
  entryPrice: number;
  exitTarget: number;
  stopLoss: number;
  confidence: number;
  reasons: string[];
  timestamp: string;
  // Filled in at 7 PM review:
  reviewedAt?: string;
  closingPrice?: number;
  wasCorrect?: boolean;
  profitLossPct?: number;
}

// ─── Daily Review ─────────────────────────────────────────────────────────────

export interface DailyReview {
  date: string;
  totalPredictions: number;
  actionablePredictions: number;   // non-HOLD signals
  correctPredictions: number;
  winRate: number;                 // 0–1
  avgProfitLossPct: number;
  paramsBefore: StrategyParams;
  paramsAfter: StrategyParams;
  tuningSummary: string;
  timestamp: string;
}

// ─── Market Movers ────────────────────────────────────────────────────────────

/** Raw info from the screener — symbol + day % change */
export interface MoverInfo {
  symbol: string;
  name: string;
  changePercent: number;  // e.g. +8.3 or -5.2
  price: number;
}

/** One prediction stored for hourly accuracy review */
export interface MoverSnapshot {
  id: string;          // `${symbol}_${timestamp}`
  timestamp: string;   // ISO when the prediction was made
  symbol: string;
  signal: SignalType;
  entryPrice: number;
  score: number;
  changePercent: number;  // gainer/loser % at prediction time
}

// ─── Monthly Range ────────────────────────────────────────────────────────────

export interface MonthData {
  label: string;        // "Mar 2026"
  key: string;          // "2026-03"
  high: number;
  low: number;
  isProjected: boolean;
}

export interface MonthlyRangeData {
  symbol: string;
  months: Record<string, MonthData>;  // keyed by "YYYY-MM"
}

// ─── App State ────────────────────────────────────────────────────────────────

export type LoadingState = 'idle' | 'loading' | 'refreshing' | 'error';

export interface AppState {
  signals: TradingSignal[];
  loading: LoadingState;
  lastUpdated: Date | null;
  marketOpen: boolean;
  strategyParams: StrategyParams;
  todayReviewed: boolean;
}
