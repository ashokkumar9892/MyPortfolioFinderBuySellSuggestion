import {
  StockData,
  StrategyParams,
  TradingSignal,
  TradeMode,
  SignalType,
  TechnicalIndicators,
} from '../types';
import {
  rsi as calcRSI,
  macd as calcMACD,
  bollingerBands as calcBB,
  volumeRatio as calcVolRatio,
  ema,
} from '../utils/indicators';

// ─── Signal generation ────────────────────────────────────────────────────────

/** Next weekday label for swing trades. */
function nextTradingDay(offset = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  // Skip weekends
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function analyzeStock(
  stock: StockData,
  params: StrategyParams,
  tradeMode: TradeMode = 'DAY'
): TradingSignal {
  const prices = stock.priceHistory;
  const volumes = stock.volumeHistory;
  const current = stock.currentPrice;

  // Not enough data → HOLD with zero confidence
  if (prices.length < 3 || current === 0) {
    return buildHold(stock, params, tradeMode);
  }

  // ── Compute indicators ──────────────────────────────────────────────────────
  const rsiVal = calcRSI(prices);
  const macdRes = calcMACD(prices);
  const bbRes = calcBB(prices, 20, params.bbMultiplier);
  const volRatio = calcVolRatio(volumes);
  const ema20 = ema(prices, 20);
  const momentum =
    stock.previousClose > 0
      ? ((current - stock.previousClose) / stock.previousClose) * 100
      : 0;

  const indicators: TechnicalIndicators = {
    rsi: rsiVal,
    macd: macdRes.macd,
    macdSignal: macdRes.signal,
    macdHistogram: macdRes.histogram,
    bbUpper: bbRes.upper,
    bbMiddle: bbRes.middle,
    bbLower: bbRes.lower,
    bbPercentB: bbRes.percentB,
    volumeRatio: volRatio,
    ema20,
    momentum,
  };

  // ── Score each indicator ────────────────────────────────────────────────────
  let score = 0;
  const reasons: string[] = [];

  // 1. RSI (max contribution ±2.0)
  if (rsiVal < params.rsiOversold) {
    const strength = (params.rsiOversold - rsiVal) / params.rsiOversold;
    score += 2.0 * strength;
    reasons.push(`RSI ${rsiVal.toFixed(1)} — oversold`);
  } else if (rsiVal > params.rsiOverbought) {
    const strength = (rsiVal - params.rsiOverbought) / (100 - params.rsiOverbought);
    score -= 2.0 * strength;
    reasons.push(`RSI ${rsiVal.toFixed(1)} — overbought`);
  }

  // 2. MACD histogram (max contribution ±1.5)
  if (macdRes.histogram !== 0) {
    const normalized = Math.tanh(macdRes.histogram * 5); // tanh squashes to ±1
    score += 1.5 * normalized;
    reasons.push(
      macdRes.histogram > 0
        ? `MACD bullish (hist ${macdRes.histogram.toFixed(3)})`
        : `MACD bearish (hist ${macdRes.histogram.toFixed(3)})`
    );
  }

  // 3. Bollinger Bands %B (max contribution ±1.0)
  if (bbRes.percentB < 0.2) {
    score += (0.2 - bbRes.percentB) * 5; // up to +1.0
    reasons.push(`Price near lower BB (${(bbRes.percentB * 100).toFixed(0)}%)`);
  } else if (bbRes.percentB > 0.8) {
    score -= (bbRes.percentB - 0.8) * 5; // up to -1.0
    reasons.push(`Price near upper BB (${(bbRes.percentB * 100).toFixed(0)}%)`);
  }

  // 4. Trend: price vs EMA-20 (contribution ±0.5)
  if (ema20 > 0) {
    const trendStrength = Math.tanh((current - ema20) / ema20 * 20);
    score += 0.5 * trendStrength;
    if (current > ema20) {
      reasons.push(`Above EMA20 — uptrend`);
    } else {
      reasons.push(`Below EMA20 — downtrend`);
    }
  }

  // 5. Momentum: % change from prev close (contribution ±0.5)
  const momScore = Math.tanh(momentum / 3) * 0.5;
  score += momScore;

  // 6. Volume amplification (multiplicative ×1.0–1.3)
  if (volRatio > params.minVolumeRatio) {
    const amp = 1 + Math.min((volRatio - 1) * 0.1, 0.3);
    score *= amp;
    reasons.push(`Volume ${volRatio.toFixed(1)}× avg — signal confirmed`);
  }

  // ── Confluence check ─────────────────────────────────────────────────────────
  // BUY conditions: MACD bullish, BB lower half, above EMA-20, RSI not overbought
  const bullishCount =
    (macdRes.histogram > 0 ? 1 : 0) +                     // MACD bullish (momentum building)
    (bbRes.percentB < 0.5 ? 1 : 0) +                      // price not at top of range
    (ema20 > 0 && current > ema20 ? 1 : 0) +              // above EMA-20 uptrend
    (rsiVal < params.rsiOverbought ? 1 : 0);               // RSI not overbought

  // SHORT conditions: MACD bearish, BB upper half, below EMA-20, RSI overbought (not oversold!)
  // Key insight: only short when RSI is elevated, NOT when stock is already beaten down
  const bearishCount =
    (macdRes.histogram < 0 ? 1 : 0) +                     // MACD bearish (momentum declining)
    (bbRes.percentB > 0.5 ? 1 : 0) +                      // price at top of range
    (ema20 > 0 && current < ema20 ? 1 : 0) +              // below EMA-20 downtrend
    (rsiVal > params.rsiOversold ? 1 : 0);                 // RSI not oversold (crucial — don't short beaten stocks)

  // Hard gates: MACD must confirm direction (single most reliable indicator)
  const macdBullish = macdRes.histogram > 0;
  const macdBearish = macdRes.histogram < 0;

  // RSI gates: don't BUY overbought, don't SHORT oversold
  const rsiAllowsBuy   = rsiVal < params.rsiOverbought;    // RSI < 68 for BUY
  const rsiAllowsSell  = rsiVal > params.rsiOversold + 8;  // RSI > 40 for SELL
  const rsiAllowsShort = rsiVal > params.rsiOverbought - 8; // RSI > 60 for SELL SHORT (must be elevated)

  // Trend alignment
  const aboveEMA = ema20 > 0 && current > ema20;
  const belowEMA = ema20 > 0 && current < ema20;

  // ── Classify signal ─────────────────────────────────────────────────────────
  let signal: SignalType;

  // BUY: strong score + MACD confirms + RSI OK + above EMA + 3/4 confluence
  const strongBuy   = score >= params.buyThreshold   && macdBullish && rsiAllowsBuy  && aboveEMA && bullishCount >= 3;
  // BUY TO COVER: slightly weaker but still needs MACD + EMA + 2/4
  const weakBuy     = score >= params.coverThreshold && macdBullish && rsiAllowsBuy  && aboveEMA && bullishCount >= 2;
  // SELL SHORT: very strict — MACD bearish + RSI elevated + below EMA + 3/4
  const strongShort = score <= -params.shortThreshold && macdBearish && rsiAllowsShort && belowEMA && bearishCount >= 3;
  // SELL: strict — MACD bearish + RSI not oversold + below EMA + 2/4
  const weakSell    = score <= -params.sellThreshold  && macdBearish && rsiAllowsSell  && belowEMA && bearishCount >= 2;

  if (strongBuy) {
    signal = 'BUY';
  } else if (weakBuy) {
    signal = 'BUY TO COVER';
  } else if (strongShort) {
    signal = 'SELL SHORT';
  } else if (weakSell) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  // ── Entry / Exit / Stop prices ──────────────────────────────────────────────
  let exitTarget: number;
  let stopLoss: number;

  if (signal === 'BUY') {
    exitTarget = current * (1 + params.targetPct);
    stopLoss = current * (1 - params.stopPct);
  } else if (signal === 'BUY TO COVER') {
    exitTarget = current * (1 + params.targetPct * 0.6);
    stopLoss = current * (1 - params.stopPct * 0.67);
  } else if (signal === 'SELL SHORT') {
    exitTarget = current * (1 - params.targetPct);
    stopLoss = current * (1 + params.stopPct);
  } else if (signal === 'SELL') {
    exitTarget = current * (1 - params.targetPct * 0.6);
    stopLoss = current * (1 + params.stopPct * 0.67);
  } else {
    exitTarget = current;
    stopLoss = current;
  }

  const risk = Math.abs(current - stopLoss);
  const reward = Math.abs(exitTarget - current);
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  // Confidence: normalise |score| against the threshold used
  const threshold =
    signal === 'BUY' || signal === 'BUY TO COVER'
      ? params.buyThreshold
      : params.shortThreshold;
  const confidence = Math.min((Math.abs(score) / threshold) * 100, 100);

  // ── Intraday direction forecast ──────────────────────────────────────────────
  const intradayChange =
    stock.open > 0 ? ((current - stock.open) / stock.open) * 100 : 0;

  const dirReasons: string[] = [];
  let dirScore = 0;

  // 1. Strategy score contributes 40% (bullish strategy = likely up today)
  dirScore += Math.tanh(score / 2) * 0.4;

  // 2. Intraday momentum (current vs open): 30%
  const intradayStrength = Math.tanh(intradayChange / 2);
  dirScore += intradayStrength * 0.3;
  if (intradayChange > 0.5)
    dirReasons.push(`Above open +${intradayChange.toFixed(2)}%`);
  else if (intradayChange < -0.5)
    dirReasons.push(`Below open ${intradayChange.toFixed(2)}%`);

  // 3. MACD histogram sign: 20%
  dirScore += Math.tanh(macdRes.histogram * 5) * 0.2;
  if (macdRes.histogram > 0) dirReasons.push('MACD bullish');
  else if (macdRes.histogram < 0) dirReasons.push('MACD bearish');

  // 4. RSI extreme: 10% (mean-reversion signal)
  if (rsiVal < 30) { dirScore += 0.1; dirReasons.push('RSI oversold — reversal likely'); }
  else if (rsiVal > 70) { dirScore -= 0.1; dirReasons.push('RSI overbought — pullback likely'); }

  // 5. Price position in day range: 10%
  const rangeSize = stock.high - stock.low;
  if (rangeSize > 0) {
    const posInRange = (current - stock.low) / rangeSize;
    if (posInRange < 0.3) { dirScore += 0.1; dirReasons.push('Near day low — bounce zone'); }
    else if (posInRange > 0.7) { dirScore -= 0.1; dirReasons.push('Near day high — resistance zone'); }
  }

  let todayDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  let todayDirectionConfidence: number;

  if (dirScore >= 0.25) {
    todayDirection = 'UP';
    todayDirectionConfidence = Math.min(Math.round((dirScore / 1.0) * 100), 95);
  } else if (dirScore <= -0.25) {
    todayDirection = 'DOWN';
    todayDirectionConfidence = Math.min(Math.round((Math.abs(dirScore) / 1.0) * 100), 95);
  } else {
    todayDirection = 'SIDEWAYS';
    todayDirectionConfidence = Math.round((1 - Math.abs(dirScore) / 0.25) * 60 + 20);
  }

  return {
    symbol: stock.symbol,
    signal,
    score: parseFloat(score.toFixed(3)),
    entryPrice: current,
    exitTarget: parseFloat(exitTarget.toFixed(2)),
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
    confidence: parseFloat(confidence.toFixed(1)),
    indicators,
    reasons,
    timestamp: new Date().toISOString(),
    dayHigh: stock.high,
    dayLow: stock.low,
    dayOpen: stock.open,
    prevClose: stock.previousClose,
    intradayChange: parseFloat(intradayChange.toFixed(3)),
    todayDirection,
    todayDirectionConfidence,
    todayDirectionReasons: dirReasons,
    // ── Swing trade fields (always computed, regardless of tradeMode) ───────────
    tradeMode,
    swingExitDate: nextTradingDay(1),
    ...(() => {
      // Volatility-adjusted swing targets: scale with today's actual range (ATR proxy).
      // Stocks with wide day ranges (e.g. ±16%) need wider stops/targets than flat pct.
      const dayRangePct = rangeSize > 0 && current > 0 ? rangeSize / current : 0;
      const swingTargetMult = Math.max(params.targetPct * 2.5, dayRangePct * 0.60);
      const swingStopMult   = Math.max(params.stopPct  * 2.0, dayRangePct * 0.35);
      const isLongSignal = signal === 'BUY' || signal === 'BUY TO COVER';
      return {
        swingTarget: parseFloat((isLongSignal
          ? current * (1 + swingTargetMult)
          : current * (1 - swingTargetMult)
        ).toFixed(2)),
        swingStop: parseFloat((isLongSignal
          ? current * (1 - swingStopMult)
          : current * (1 + swingStopMult)
        ).toFixed(2)),
      };
    })(),
  };
}

function buildHold(stock: StockData, _params: StrategyParams, tradeMode: TradeMode = 'DAY'): TradingSignal {
  const p = stock.currentPrice;
  return {
    symbol: stock.symbol,
    signal: 'HOLD',
    score: 0,
    entryPrice: p,
    exitTarget: p,
    stopLoss: p,
    riskRewardRatio: 0,
    confidence: 0,
    indicators: {
      rsi: 50,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bbUpper: p,
      bbMiddle: p,
      bbLower: p,
      bbPercentB: 0.5,
      volumeRatio: 1,
      ema20: p,
      momentum: 0,
    },
    reasons: stock.error ? [`Error: ${stock.error}`] : ['Insufficient data'],
    timestamp: new Date().toISOString(),
    dayHigh: stock.high,
    dayLow: stock.low,
    dayOpen: stock.open,
    prevClose: stock.previousClose,
    intradayChange: 0,
    todayDirection: 'SIDEWAYS',
    todayDirectionConfidence: 0,
    todayDirectionReasons: [],
    tradeMode,
    swingExitDate: nextTradingDay(1),
    swingTarget: p,
    swingStop: p,
  };
}

// ─── Self-tuning ──────────────────────────────────────────────────────────────

/**
 * Adjust strategy params based on yesterday's win rate.
 * Tightens thresholds when accuracy is poor, relaxes when it is good.
 */
export function tuneParams(
  winRate: number,
  current: StrategyParams
): { params: StrategyParams; summary: string } {
  const p = { ...current };
  let summary = '';

  if (winRate < 0.45) {
    // Poor — tighten buy+short thresholds, push RSI gates wider
    p.buyThreshold   = Math.min(p.buyThreshold   + 0.25, 4.0);
    p.shortThreshold = Math.min(p.shortThreshold + 0.35, 4.5); // tighten shorts more aggressively
    p.coverThreshold = Math.min(p.coverThreshold + 0.15, 3.0);
    p.sellThreshold  = Math.min(p.sellThreshold  + 0.20, 3.5);
    p.rsiOversold    = Math.max(p.rsiOversold  - 2, 20);       // harder to trigger oversold
    p.rsiOverbought  = Math.min(p.rsiOverbought + 2, 82);      // harder to trigger overbought
    summary = `Win rate ${(winRate * 100).toFixed(0)}% — tightened thresholds (shorts ++)`;
  } else if (winRate < 0.55) {
    // Below target — tighten slightly
    p.buyThreshold   = Math.min(p.buyThreshold   + 0.1, 3.5);
    p.shortThreshold = Math.min(p.shortThreshold + 0.2, 4.0);
    p.rsiOversold    = Math.max(p.rsiOversold  - 1, 22);
    p.rsiOverbought  = Math.min(p.rsiOverbought + 1, 80);
    summary = `Win rate ${(winRate * 100).toFixed(0)}% — tightened slightly`;
  } else if (winRate >= 0.65) {
    // Good — relax slightly to catch more setups (but keep shorts strict)
    p.buyThreshold   = Math.max(p.buyThreshold   - 0.1, 1.8);
    p.shortThreshold = Math.max(p.shortThreshold - 0.05, 2.2); // relax shorts less than buys
    p.coverThreshold = Math.max(p.coverThreshold - 0.05, 1.0);
    p.rsiOversold    = Math.min(p.rsiOversold  + 1, 35);
    p.rsiOverbought  = Math.max(p.rsiOverbought - 1, 65);
    summary = `Win rate ${(winRate * 100).toFixed(0)}% — relaxed slightly`;
  } else {
    summary = `Win rate ${(winRate * 100).toFixed(0)}% — parameters unchanged`;
  }

  return { params: p, summary };
}
