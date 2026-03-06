import React from 'react';
import { TradingSignal, SignalType, TradeMode } from '../types';

interface Props {
  signal: TradingSignal;
  tradeMode: TradeMode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<SignalType, { label: string; cls: string; emoji: string }> = {
  BUY:            { label: 'BUY',          cls: 'signal-buy',   emoji: '▲' },
  'BUY TO COVER': { label: 'BUY TO COVER', cls: 'signal-btc',   emoji: '↑' },
  HOLD:           { label: 'HOLD',         cls: 'signal-hold',  emoji: '—' },
  SELL:           { label: 'SELL',         cls: 'signal-sell',  emoji: '↓' },
  'SELL SHORT':   { label: 'SELL SHORT',   cls: 'signal-short', emoji: '▼' },
};

function fmt(n: number, dec = 2): string {
  if (!n || isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtPct(n: number, showSign = true): string {
  const sign = showSign && n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function rsiColor(v: number): string {
  if (v < 30) return '#3fb950';
  if (v > 70) return '#f85149';
  return '#8b949e';
}

function macdColor(v: number): string {
  return v >= 0 ? '#3fb950' : '#f85149';
}

/** Convert a price to a 0–100 % position within the day range. */
function rangePos(price: number, low: number, rangeSize: number): number {
  if (rangeSize <= 0) return 50;
  return Math.max(0, Math.min(100, ((price - low) / rangeSize) * 100));
}

// ─── Intraday Direction Banner ────────────────────────────────────────────────

interface DirectionProps {
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  confidence: number;
  reasons: string[];
  intradayChange: number;
}

const DirectionBanner: React.FC<DirectionProps> = ({
  direction, confidence, reasons, intradayChange,
}) => {
  const meta = {
    UP:       { emoji: '▲', label: 'LIKELY UP TODAY',       cls: 'dir-up' },
    DOWN:     { emoji: '▼', label: 'LIKELY DOWN TODAY',     cls: 'dir-down' },
    SIDEWAYS: { emoji: '↔', label: 'SIDEWAYS / UNCERTAIN',  cls: 'dir-side' },
  }[direction];

  return (
    <div className={`direction-banner ${meta.cls}`}>
      <div className="dir-main">
        <span className="dir-arrow">{meta.emoji}</span>
        <span className="dir-label">{meta.label}</span>
        <span className="dir-conf">{confidence}%</span>
      </div>
      {reasons.length > 0 && (
        <div className="dir-reasons">
          {reasons.join(' · ')}
          {intradayChange !== 0 && (
            <span style={{ color: intradayChange >= 0 ? '#3fb950' : '#f85149' }}>
              {' '}({fmtPct(intradayChange)} from open)
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Day Range Section ────────────────────────────────────────────────────────

interface RangeProps {
  current: number;
  dayLow: number;
  dayHigh: number;
  dayOpen: number;
  prevClose: number;
  signal: SignalType;
}

const DayRange: React.FC<RangeProps> = ({
  current, dayLow, dayHigh, dayOpen, prevClose, signal,
}) => {
  const rangeSize = dayHigh - dayLow;
  if (rangeSize <= 0 || dayLow <= 0) return null;

  const curPct   = rangePos(current, dayLow, rangeSize);
  const openPct  = rangePos(dayOpen, dayLow, rangeSize);

  const toHigh    = dayHigh - current;
  const toLow     = current - dayLow;
  const toHighPct = (toHigh / current) * 100;
  const toLowPct  = (toLow  / current) * 100;
  const rangePct  = prevClose > 0 ? (rangeSize / prevClose) * 100 : 0;
  const gapPct    = prevClose > 0 ? ((dayOpen - prevClose) / prevClose) * 100 : 0;

  const isLong  = signal === 'BUY' || signal === 'BUY TO COVER';
  const isShort = signal === 'SELL SHORT' || signal === 'SELL';

  // T1 / T2 / T3 price levels
  const longT1  = current + toHigh * 0.33;
  const longT2  = current + toHigh * 0.50;
  const longT3  = dayHigh;
  const shortT1 = current - toLow * 0.33;
  const shortT2 = current - toLow * 0.50;
  const shortT3 = dayLow;

  const t1Price  = isLong ? longT1  : isShort ? shortT1 : 0;
  const t2Price  = isLong ? longT2  : isShort ? shortT2 : 0;
  const t3Price  = isLong ? longT3  : isShort ? shortT3 : 0;

  const t1Pct    = (t1Price > 0) ? rangePos(t1Price, dayLow, rangeSize) : -1;
  const t2Pct    = (t2Price > 0) ? rangePos(t2Price, dayLow, rangeSize) : -1;
  const t3Pct    = (t3Price > 0) ? rangePos(t3Price, dayLow, rangeSize) : -1;

  const targetColor = isLong ? '#3fb950' : '#f85149';

  return (
    <div className="day-range-section">
      <div className="day-range-title">Today's Range</div>

      {/* ── Visual bar ──────────────────────────────────────────────── */}
      <div className="range-bar-wrap">
        <span className="range-edge red">${fmt(dayLow)}</span>

        <div className="range-bar" title={`$${fmt(current)} — ${curPct.toFixed(0)}% of range`}>
          {/* Filled fill up to current price */}
          <div className="range-fill" style={{ width: `${curPct}%` }} />

          {/* Current price marker — white diamond */}
          <div className="range-marker" style={{ left: `${curPct}%` }} />

          {/* Open price tick — yellow */}
          {dayOpen > 0 && (
            <div
              className="range-open-tick"
              style={{ left: `${openPct}%` }}
              title={`Open $${fmt(dayOpen)}`}
            />
          )}

          {/* T1 / T2 / T3 target ticks */}
          {(isLong || isShort) && t1Pct >= 0 && (
            <div
              className="range-target-tick t1-tick"
              style={{ left: `${t1Pct}%`, background: targetColor }}
              title={`T1 $${fmt(t1Price)}`}
            />
          )}
          {(isLong || isShort) && t2Pct >= 0 && (
            <div
              className="range-target-tick t2-tick"
              style={{ left: `${t2Pct}%`, background: targetColor }}
              title={`T2 $${fmt(t2Price)}`}
            />
          )}
          {(isLong || isShort) && t3Pct >= 0 && (
            <div
              className="range-target-tick t3-tick"
              style={{ left: `${t3Pct}%`, background: targetColor }}
              title={`T3 $${fmt(t3Price)}`}
            />
          )}
        </div>

        <span className="range-edge green">${fmt(dayHigh)}</span>
      </div>

      {/* T-label row below the bar */}
      {(isLong || isShort) && (
        <div className="range-tick-labels" style={{ color: targetColor }}>
          {t1Pct >= 0 && (
            <span style={{ left: `calc(${t1Pct}% + 34px)` }} className="tick-label">T1</span>
          )}
          {t2Pct >= 0 && (
            <span style={{ left: `calc(${t2Pct}% + 34px)` }} className="tick-label">T2</span>
          )}
          {t3Pct >= 0 && (
            <span style={{ left: `calc(${t3Pct}% + 34px)` }} className="tick-label">T3</span>
          )}
        </div>
      )}

      {/* ── Position stats ───────────────────────────────────────────── */}
      <div className="range-position-row">
        <span className="range-pos-label">
          Pos <strong>{curPct.toFixed(0)}%</strong>
        </span>
        <span className="range-volatility">
          Range <strong>{fmtPct(rangePct, false)}</strong>
        </span>
        {Math.abs(gapPct) > 0.1 && (
          <span className="range-gap" style={{ color: gapPct >= 0 ? '#3fb950' : '#f85149' }}>
            Gap {fmtPct(gapPct)}
          </span>
        )}
      </div>

      {/* ── Distance to extremes ─────────────────────────────────────── */}
      <div className="range-distances">
        <div className="dist-item">
          <span className="dist-label">▲ To High</span>
          <span className="dist-val green">+${fmt(toHigh)} ({fmtPct(toHighPct)})</span>
        </div>
        <div className="dist-item">
          <span className="dist-label">▼ To Low</span>
          <span className="dist-val red">−${fmt(toLow)} ({fmtPct(toLowPct)})</span>
        </div>
      </div>

      {/* ── Quick Profit Booking Levels ───────────────────────────────── */}
      {(isLong || isShort) && (
        <div className="quick-profits">
          <div className="qp-header">
            {isLong ? '📈 Profit Targets (Long)' : '📉 Profit Targets (Short)'}
          </div>
          <div className="qp-levels">
            {isLong ? (
              <>
                <div className="qp-item">
                  <span className="qp-label">T1 (⅓ to High)</span>
                  <span className="qp-val green">${fmt(longT1)}</span>
                  <span className="qp-pct green">+{((longT1 - current) / current * 100).toFixed(2)}%</span>
                </div>
                <div className="qp-item">
                  <span className="qp-label">T2 (½ to High)</span>
                  <span className="qp-val green">${fmt(longT2)}</span>
                  <span className="qp-pct green">+{((longT2 - current) / current * 100).toFixed(2)}%</span>
                </div>
                <div className="qp-item">
                  <span className="qp-label">T3 (Day High)</span>
                  <span className="qp-val green">${fmt(longT3)}</span>
                  <span className="qp-pct green">+{((longT3 - current) / current * 100).toFixed(2)}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="qp-item">
                  <span className="qp-label">T1 (⅓ to Low)</span>
                  <span className="qp-val red">${fmt(shortT1)}</span>
                  <span className="qp-pct red">{((shortT1 - current) / current * 100).toFixed(2)}%</span>
                </div>
                <div className="qp-item">
                  <span className="qp-label">T2 (½ to Low)</span>
                  <span className="qp-val red">${fmt(shortT2)}</span>
                  <span className="qp-pct red">{((shortT2 - current) / current * 100).toFixed(2)}%</span>
                </div>
                <div className="qp-item">
                  <span className="qp-label">T3 (Day Low)</span>
                  <span className="qp-val red">${fmt(shortT3)}</span>
                  <span className="qp-pct red">{((shortT3 - current) / current * 100).toFixed(2)}%</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Base pcts for HOLD fallback targets ─────────────────────────────────────
const HOLD_DAY_TARGET   = 0.025;   // 2.5%
const HOLD_DAY_STOP     = 0.015;   // 1.5%
const HOLD_SWING_TARGET = 0.063;   // 6.3%  (2.5× day)
const HOLD_SWING_STOP   = 0.030;   // 3.0%  (2× day)

// ─── StockCard ────────────────────────────────────────────────────────────────

const StockCard: React.FC<Props> = ({ signal }) => {
  const { label, cls, emoji } = SIGNAL_META[signal.signal];
  const { indicators: ind } = signal;

  const changePct    = ind.momentum ?? 0;
  const priceColor   = changePct >= 0 ? '#3fb950' : '#f85149';
  const isActionable = signal.signal !== 'HOLD';
  const entry        = signal.entryPrice;

  // Direction for HOLD signals — use todayDirection forecast
  const isLong  = signal.signal === 'BUY' || signal.signal === 'BUY TO COVER';
  const isShort = signal.signal === 'SELL SHORT' || signal.signal === 'SELL';
  const isHold  = signal.signal === 'HOLD';
  const holdUp  = isHold && signal.todayDirection !== 'DOWN';  // UP or SIDEWAYS → bullish bias

  // ── Day trade targets ──────────────────────────────────────────────────────
  let dayTarget: number, dayStop: number;
  if (isLong) {
    dayTarget = signal.exitTarget;
    dayStop   = signal.stopLoss;
  } else if (isShort) {
    dayTarget = signal.exitTarget;
    dayStop   = signal.stopLoss;
  } else {
    dayTarget = holdUp
      ? parseFloat((entry * (1 + HOLD_DAY_TARGET)).toFixed(2))
      : parseFloat((entry * (1 - HOLD_DAY_TARGET)).toFixed(2));
    dayStop = holdUp
      ? parseFloat((entry * (1 - HOLD_DAY_STOP)).toFixed(2))
      : parseFloat((entry * (1 + HOLD_DAY_STOP)).toFixed(2));
  }
  const dayRisk   = Math.abs(entry - dayStop);
  const dayReward = Math.abs(dayTarget - entry);
  const dayRR     = dayRisk > 0 ? (dayReward / dayRisk).toFixed(1) : '—';

  // ── Swing targets ──────────────────────────────────────────────────────────
  let swingTarget: number, swingStop: number;
  if (!isHold) {
    swingTarget = signal.swingTarget;
    swingStop   = signal.swingStop;
  } else {
    swingTarget = holdUp
      ? parseFloat((entry * (1 + HOLD_SWING_TARGET)).toFixed(2))
      : parseFloat((entry * (1 - HOLD_SWING_TARGET)).toFixed(2));
    swingStop = holdUp
      ? parseFloat((entry * (1 - HOLD_SWING_STOP)).toFixed(2))
      : parseFloat((entry * (1 + HOLD_SWING_STOP)).toFixed(2));
  }

  const showLong  = isLong || holdUp;

  // ── Potential rating ───────────────────────────────────────────────────────
  const dayRangePct   = Math.abs((dayTarget - entry) / entry * 100);
  const swingRangePct = Math.abs((swingTarget - entry) / entry * 100);
  const rrNum         = parseFloat(dayRR as string) || 0;

  type Potential = { label: string; cardCls: string; chipCls: string } | null;
  let dayPotential: Potential = null;
  let swingPotential: Potential = null;

  if (dayRangePct >= 8 && rrNum >= 2.5)
    dayPotential = { label: '🔥 HOT  ' + dayRangePct.toFixed(1) + '%', cardCls: 'pot-hot', chipCls: 'chip-hot' };
  else if (dayRangePct >= 5 && rrNum >= 1.8)
    dayPotential = { label: '⚡ STRONG  ' + dayRangePct.toFixed(1) + '%', cardCls: 'pot-strong', chipCls: 'chip-strong' };
  else if (dayRangePct >= 3 && rrNum >= 1.3)
    dayPotential = { label: '📈 GOOD  ' + dayRangePct.toFixed(1) + '%', cardCls: 'pot-good', chipCls: 'chip-good' };

  if (swingRangePct >= 15)
    swingPotential = { label: '🚀 BIG SWING  ' + swingRangePct.toFixed(1) + '%', cardCls: '', chipCls: 'chip-hot' };
  else if (swingRangePct >= 8)
    swingPotential = { label: '🌙 SWING  ' + swingRangePct.toFixed(1) + '%', cardCls: '', chipCls: 'chip-strong' };

  const topCardCls = dayPotential?.cardCls ?? '';

  function pctDiff(val: number): string {
    if (!entry) return '';
    const p = ((val - entry) / entry) * 100;
    return `(${p >= 0 ? '+' : ''}${p.toFixed(2)}%)`;
  }

  return (
    <div className={`stock-card ${isActionable ? 'actionable' : ''} ${topCardCls}`}>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="card-header">
        <span className="symbol">{signal.symbol}</span>
        <span className="price-block">
          <span className="price">${fmt(signal.entryPrice)}</span>
          <span className="change" style={{ color: priceColor }}>
            {fmtPct(changePct)}
          </span>
        </span>
      </div>

      {/* ── Signal Badge ─────────────────────────────────────────────── */}
      <div className="signal-row">
        <span className={`signal-badge ${cls}`}>{emoji} {label}</span>
        <div className="confidence-bar-wrap" title={`Confidence ${signal.confidence.toFixed(0)}%`}>
          <div className="confidence-bar" style={{ width: `${signal.confidence}%` }} />
        </div>
        <span className="confidence-label">{signal.confidence.toFixed(0)}%</span>
      </div>

      {/* ── Intraday Direction Forecast ───────────────────────────────── */}
      <DirectionBanner
        direction={signal.todayDirection}
        confidence={signal.todayDirectionConfidence}
        reasons={signal.todayDirectionReasons}
        intradayChange={signal.intradayChange}
      />

      {/* ── Day Trade Plan ─────────────────────────────────────────────── */}
      <div className="sc-plan sc-plan-day">
        <div className="sc-plan-title">
          📅 Day Trade — Exit Same Day
          {isHold && <span className="sc-expected-chip">Expected Range</span>}
          {dayPotential && <span className={`sc-potential-chip ${dayPotential.chipCls}`}>{dayPotential.label}</span>}
        </div>
        {/* Big return banner */}
        <div className="sc-return-banner">
          <div className="sc-return-side">
            <span className="sc-return-lbl">Expected Return</span>
            <span className={`sc-return-big ${showLong ? 'sc-green' : 'sc-red'}`}>
              {showLong ? '+' : '-'}{dayRangePct.toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">Risk</span>
            <span className="sc-return-big sc-red">
              -{Math.abs((dayStop - entry) / entry * 100).toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">R:R</span>
            <span className="sc-return-big">{dayRR}×</span>
          </div>
        </div>
        <div className="sc-plan-grid">
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">Entry Price</span>
            <span className="sc-plan-val">${fmt(entry)}</span>
          </div>
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">{showLong ? '🎯 Target / Exit' : '🎯 Cover / Exit'}</span>
            <span className="sc-plan-val sc-green">
              ${fmt(dayTarget)} <span className="sc-plan-pct">{pctDiff(dayTarget)}</span>
            </span>
          </div>
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">🛑 Stop Loss</span>
            <span className="sc-plan-val sc-red">
              ${fmt(dayStop)} <span className="sc-plan-pct">{pctDiff(dayStop)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Swing Trade Plan ───────────────────────────────────────────── */}
      <div className="sc-plan sc-plan-swing">
        <div className="sc-plan-title">
          📆 Swing Trade
          <span className="sc-hold-chip">Hold until {signal.swingExitDate}</span>
          {isHold && <span className="sc-expected-chip">Expected Range</span>}
          {swingPotential && <span className={`sc-potential-chip ${swingPotential.chipCls}`}>{swingPotential.label}</span>}
        </div>
        {/* Big return banner */}
        <div className="sc-return-banner">
          <div className="sc-return-side">
            <span className="sc-return-lbl">Expected Return</span>
            <span className={`sc-return-big ${showLong ? 'sc-green' : 'sc-red'}`}>
              {showLong ? '+' : '-'}{swingRangePct.toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">Hold</span>
            <span className="sc-return-big sc-purple">1–3 days</span>
          </div>
        </div>
        <div className="sc-plan-grid">
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">Entry Price</span>
            <span className="sc-plan-val">${fmt(entry)}</span>
          </div>
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">{showLong ? '📈 Expected High' : '📉 Expected Low'}</span>
            <span className="sc-plan-val sc-green">
              ${fmt(showLong ? swingTarget : swingStop)} <span className="sc-plan-pct">{pctDiff(showLong ? swingTarget : swingStop)}</span>
            </span>
          </div>
          <div className="sc-plan-row">
            <span className="sc-plan-lbl">{showLong ? '📉 Expected Low / Stop' : '📈 Cover High / Stop'}</span>
            <span className="sc-plan-val sc-red">
              ${fmt(showLong ? swingStop : swingTarget)} <span className="sc-plan-pct">{pctDiff(showLong ? swingStop : swingTarget)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Today's Range + T1/T2/T3 + Quick Profits ─────────────────── */}
      <DayRange
        current={signal.entryPrice}
        dayLow={signal.dayLow}
        dayHigh={signal.dayHigh}
        dayOpen={signal.dayOpen}
        prevClose={signal.prevClose}
        signal={signal.signal}
      />

      {/* ── Indicators Grid ──────────────────────────────────────────── */}
      <div className="indicators-grid">
        <div className="ind-item">
          <span className="ind-label">RSI</span>
          <span className="ind-value" style={{ color: rsiColor(ind.rsi) }}>
            {ind.rsi.toFixed(1)}
          </span>
        </div>
        <div className="ind-item">
          <span className="ind-label">MACD</span>
          <span className="ind-value" style={{ color: macdColor(ind.macdHistogram) }}>
            {ind.macdHistogram.toFixed(3)}
          </span>
        </div>
        <div className="ind-item">
          <span className="ind-label">BB%</span>
          <span className="ind-value">{(ind.bbPercentB * 100).toFixed(0)}%</span>
        </div>
        <div className="ind-item">
          <span className="ind-label">Vol</span>
          <span className="ind-value" style={{ color: ind.volumeRatio > 1.5 ? '#58a6ff' : '#8b949e' }}>
            {ind.volumeRatio.toFixed(1)}×
          </span>
        </div>
        <div className="ind-item">
          <span className="ind-label">EMA20</span>
          <span className="ind-value" style={{ color: signal.entryPrice >= ind.ema20 ? '#3fb950' : '#f85149' }}>
            ${fmt(ind.ema20)}
          </span>
        </div>
        <div className="ind-item">
          <span className="ind-label">Score</span>
          <span className="ind-value" style={{ color: signal.score >= 0 ? '#3fb950' : '#f85149' }}>
            {signal.score > 0 ? '+' : ''}{signal.score.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Reasons ──────────────────────────────────────────────────── */}
      {signal.reasons.length > 0 && (
        <div className="reasons">
          {signal.reasons.map((r, i) => (
            <span key={i} className="reason-tag">{r}</span>
          ))}
        </div>
      )}

      {/* ── Timestamp ────────────────────────────────────────────────── */}
      <div className="card-footer">
        Updated{' '}
        {new Date(signal.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  );
};

export default StockCard;
