import React from 'react';
import { TradingSignal, SignalType, MonthData } from '../types';

interface Props {
  signal: TradingSignal;
  changePercent: number;   // Polygon day % change (e.g. +117.8%)
  activeMonth?: MonthData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2): string {
  if (!n || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function pctDiff(val: number, ref: number): string {
  if (!ref) return '';
  const p = ((val - ref) / ref) * 100;
  return `(${p >= 0 ? '+' : ''}${p.toFixed(2)}%)`;
}

// Base percentages used when signal is HOLD (no strategy targets)
const DAY_TARGET_PCT   = 0.04;   // 4% day target for volatile movers
const DAY_STOP_PCT     = 0.025;  // 2.5% stop
const SWING_TARGET_PCT = 0.10;   // 10% swing target
const SWING_STOP_PCT   = 0.05;   // 5% swing stop

const SIGNAL_BADGE: Record<SignalType, { label: string; cls: string; emoji: string }> = {
  'BUY':          { label: 'BUY',           cls: 'mc-buy',   emoji: '▲' },
  'BUY TO COVER': { label: 'BUY TO COVER',  cls: 'mc-btc',   emoji: '↑' },
  'HOLD':         { label: 'WATCH',         cls: 'mc-hold',  emoji: '⟳' },
  'SELL':         { label: 'SELL',          cls: 'mc-sell',  emoji: '↓' },
  'SELL SHORT':   { label: 'SELL SHORT',    cls: 'mc-short', emoji: '▼' },
};

// ─── MoverCard ────────────────────────────────────────────────────────────────

function rangePos(price: number, low: number, rangeSize: number): number {
  if (rangeSize <= 0) return 50;
  return Math.max(0, Math.min(100, ((price - low) / rangeSize) * 100));
}

const MoverCard: React.FC<Props> = ({ signal, changePercent, activeMonth }) => {
  const badge  = SIGNAL_BADGE[signal.signal];
  const entry  = signal.entryPrice;
  const isLong  = signal.signal === 'BUY' || signal.signal === 'BUY TO COVER';
  const isShort = signal.signal === 'SELL SHORT' || signal.signal === 'SELL';
  const isHold  = signal.signal === 'HOLD';

  // For HOLD: derive expected direction from changePercent
  // (gainer still climbing → long; loser still falling → short)
  const holdLong = isHold && changePercent >= 0;

  // ── Day trade targets ──────────────────────────────────────────────────────
  // Use strategy targets when confirmed, fallback to base pct for HOLD
  let dayTarget: number, dayStop: number;
  if (isLong) {
    dayTarget = signal.exitTarget;
    dayStop   = signal.stopLoss;
  } else if (isShort) {
    dayTarget = signal.exitTarget;
    dayStop   = signal.stopLoss;
  } else {
    // HOLD — show expected range based on direction
    dayTarget = holdLong
      ? parseFloat((entry * (1 + DAY_TARGET_PCT)).toFixed(2))
      : parseFloat((entry * (1 - DAY_TARGET_PCT)).toFixed(2));
    dayStop = holdLong
      ? parseFloat((entry * (1 - DAY_STOP_PCT)).toFixed(2))
      : parseFloat((entry * (1 + DAY_STOP_PCT)).toFixed(2));
  }

  // ── Swing targets ──────────────────────────────────────────────────────────
  let swingHigh: number, swingLow: number;
  if (!isHold) {
    swingHigh = signal.swingTarget;
    swingLow  = signal.swingStop;
  } else {
    swingHigh = holdLong
      ? parseFloat((entry * (1 + SWING_TARGET_PCT)).toFixed(2))
      : parseFloat((entry * (1 - SWING_TARGET_PCT)).toFixed(2));
    swingLow = holdLong
      ? parseFloat((entry * (1 - SWING_STOP_PCT)).toFixed(2))
      : parseFloat((entry * (1 + SWING_STOP_PCT)).toFixed(2));
  }

  const showLong  = isLong  || holdLong;
  const showShort = isShort || (!holdLong && isHold);

  // ── Today's range bar ──────────────────────────────────────────────────────
  const rangeSize = signal.dayHigh - signal.dayLow;
  const curPos    = rangeSize > 0
    ? Math.max(0, Math.min(100, ((entry - signal.dayLow) / rangeSize) * 100))
    : 50;

  // R:R
  const risk   = Math.abs(entry - dayStop);
  const reward = Math.abs(dayTarget - entry);
  const rr     = risk > 0 ? (reward / risk).toFixed(1) : '—';

  // ── Potential rating ───────────────────────────────────────────────────────
  const dayRangePct   = entry > 0 ? Math.abs((dayTarget - entry) / entry * 100) : 0;
  const swingRangePct = entry > 0 ? Math.abs((showLong ? swingHigh : swingLow) - entry) / entry * 100 : 0;
  const rrNum         = parseFloat(rr as string) || 0;

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

  return (
    <div className={`mover-card ${badge.cls} ${topCardCls}`}>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mc-header">
        <div className="mc-top-row">
          <span className="mc-symbol">{signal.symbol}</span>
          <span className="mc-big-change"
            style={{ color: changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(1)}%
          </span>
        </div>
        <div className="mc-price-row">
          <span className="mc-price">${fmt(entry)}</span>
          <span className={`mc-sig-badge ${badge.cls}`}>{badge.emoji} {badge.label}</span>
        </div>
        {isHold && (
          <div className="mc-hold-hint" style={{ color: showLong ? 'var(--green)' : 'var(--red)' }}>
            {showLong ? '▲ Expected to continue higher' : '▼ Expected to continue lower'}
            {' '}— no confirmed signal yet
          </div>
        )}
        <div className="mc-conf-row">
          <div className="mc-conf-bar-wrap">
            <div className="mc-conf-bar" style={{ width: `${signal.confidence}%` }} />
          </div>
          <span className="mc-conf-label">Confidence {signal.confidence.toFixed(0)}%</span>
        </div>
      </div>

      {/* ── Monthly Plan (when active) ───────────────────────────────── */}
      {activeMonth && (() => {
        const { high, low } = activeMonth;
        const rangeSize  = high - low;
        const curPct     = rangeSize > 0 ? rangePos(entry, low, rangeSize) : 50;
        const toHighPct  = entry > 0 ? ((high  - entry) / entry) * 100 : 0;
        const toLowPct   = entry > 0 ? ((entry - low)   / entry) * 100 : 0;
        const rangePct   = low  > 0  ? (rangeSize / low) * 100 : 0;
        const posLabel   = curPct >= 80 ? 'Near Month High' : curPct <= 20 ? 'Near Month Low' : 'Mid Range';
        const posColor   = curPct >= 80 ? 'var(--red)' : curPct <= 20 ? 'var(--green)' : 'var(--yellow)';
        return (
          <div className="mc-plan mc-plan-day" style={{ borderLeftColor: 'var(--blue)' }}>
            <div className="mc-plan-title">
              📅 {activeMonth.label} — Monthly Range
              {activeMonth.isProjected
                ? <span className="mc-unconfirmed-chip">Projected</span>
                : <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--text2)' }}>Actual</span>}
            </div>
            {/* Range bar */}
            <div className="mc-range" style={{ marginTop: 6 }}>
              <div className="mc-range-bar-row">
                <span className="mc-range-edge mc-red-txt">${fmt(low)}</span>
                <div className="mc-range-track">
                  <div className="mc-range-fill" style={{ width: `${curPct}%`, background: 'var(--blue)' }} />
                  <div className="mc-range-dot" style={{ left: `${curPct}%` }} />
                </div>
                <span className="mc-range-edge mc-green-txt">${fmt(high)}</span>
              </div>
            </div>
            {/* Return banner */}
            <div className="sc-return-banner" style={{ marginTop: 6 }}>
              <div className="sc-return-side">
                <span className="sc-return-lbl">Month High</span>
                <span className="sc-return-big mc-green">+{toHighPct.toFixed(2)}%</span>
              </div>
              <div className="sc-return-side sc-return-right">
                <span className="sc-return-lbl">Month Low</span>
                <span className="sc-return-big mc-red">-{toLowPct.toFixed(2)}%</span>
              </div>
              <div className="sc-return-side sc-return-right">
                <span className="sc-return-lbl">Range</span>
                <span className="sc-return-big">{rangePct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="mc-plan-grid">
              <div className="mc-plan-row">
                <span className="mc-plan-lbl">📈 Expected High</span>
                <span className="mc-plan-val mc-green">${fmt(high)} <span className="mc-plan-pct">(+{toHighPct.toFixed(2)}%)</span></span>
              </div>
              <div className="mc-plan-row">
                <span className="mc-plan-lbl">📉 Expected Low</span>
                <span className="mc-plan-val mc-red">${fmt(low)} <span className="mc-plan-pct">(-{toLowPct.toFixed(2)}%)</span></span>
              </div>
              <div className="mc-plan-row">
                <span className="mc-plan-lbl">Position in Range</span>
                <span className="mc-plan-val" style={{ color: posColor }}>{curPct.toFixed(0)}% — {posLabel}</span>
              </div>
            </div>
            {(isLong || isShort) && (
              <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
                {isLong  && curPct <= 30 && <span className="monthly-tag monthly-tag-good">✅ Buying near month low — good entry</span>}
                {isLong  && curPct >= 70 && <span className="monthly-tag monthly-tag-warn">⚠️ Buying near month high — extended</span>}
                {isShort && curPct >= 70 && <span className="monthly-tag monthly-tag-good">✅ Shorting near month high — good entry</span>}
                {isShort && curPct <= 30 && <span className="monthly-tag monthly-tag-warn">⚠️ Shorting near month low — extended</span>}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Day Trading Plan ─────────────────────────────────────────── */}
      {!activeMonth && <div className="mc-plan mc-plan-day">
        <div className="mc-plan-title">
          📅 Day Trade — Exit Same Day
          {isHold && <span className="mc-unconfirmed-chip">Expected Range</span>}
          {dayPotential && <span className={`mc-potential-chip ${dayPotential.chipCls}`}>{dayPotential.label}</span>}
        </div>

        <div className="sc-return-banner">
          <div className="sc-return-side">
            <span className="sc-return-lbl">Expected Return</span>
            <span className={`sc-return-big ${showLong ? 'mc-green' : 'mc-red'}`}>
              {showLong ? '+' : '-'}{dayRangePct.toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">Risk</span>
            <span className="sc-return-big mc-red">
              -{Math.abs((dayStop - entry) / entry * 100).toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">R:R</span>
            <span className="sc-return-big">{rr}×</span>
          </div>
        </div>

        <div className="mc-plan-grid">
          <div className="mc-plan-row">
            <span className="mc-plan-lbl">Entry Price</span>
            <span className="mc-plan-val">${fmt(entry)}</span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">
              {showLong ? '🎯 Exit / Target High' : '🎯 Cover / Target Low'}
            </span>
            <span className="mc-plan-val mc-green">
              ${fmt(dayTarget)}
              <span className="mc-plan-pct"> {pctDiff(dayTarget, entry)}</span>
            </span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">🛑 Stop Loss</span>
            <span className="mc-plan-val mc-red">
              ${fmt(dayStop)}
              <span className="mc-plan-pct"> {pctDiff(dayStop, entry)}</span>
            </span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">Risk / Reward</span>
            <span className="mc-plan-val">{rr}×</span>
          </div>
        </div>
      </div>}

      {/* ── Swing Trading Plan ───────────────────────────────────────── */}
      {!activeMonth && <div className="mc-plan mc-plan-swing">
        <div className="mc-plan-title">
          📆 Swing Trade
          <span className="mc-hold-chip">Hold until {signal.swingExitDate}</span>
          {isHold && <span className="mc-unconfirmed-chip">Expected Range</span>}
          {swingPotential && <span className={`mc-potential-chip ${swingPotential.chipCls}`}>{swingPotential.label}</span>}
        </div>

        <div className="sc-return-banner">
          <div className="sc-return-side">
            <span className="sc-return-lbl">Expected Return</span>
            <span className={`sc-return-big ${showLong ? 'mc-green' : 'mc-red'}`}>
              {showLong ? '+' : '-'}{swingRangePct.toFixed(2)}%
            </span>
          </div>
          <div className="sc-return-side sc-return-right">
            <span className="sc-return-lbl">Hold</span>
            <span className="sc-return-big mc-purple">1–3 days</span>
          </div>
        </div>

        <div className="mc-plan-grid">
          <div className="mc-plan-row">
            <span className="mc-plan-lbl">Entry Price</span>
            <span className="mc-plan-val">${fmt(entry)}</span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">
              {showLong ? '📈 Expected High' : '📉 Expected Low'}
            </span>
            <span className="mc-plan-val mc-green">
              ${fmt(showLong ? swingHigh : swingLow)}
              <span className="mc-plan-pct"> {pctDiff(showLong ? swingHigh : swingLow, entry)}</span>
            </span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">
              {showLong ? '📉 Expected Low / Stop' : '📈 Cover High / Stop'}
            </span>
            <span className="mc-plan-val mc-red">
              ${fmt(showLong ? swingLow : swingHigh)}
              <span className="mc-plan-pct"> {pctDiff(showLong ? swingLow : swingHigh, entry)}</span>
            </span>
          </div>

          <div className="mc-plan-row">
            <span className="mc-plan-lbl">Holding Period</span>
            <span className="mc-plan-val mc-purple">1–3 trading days</span>
          </div>
        </div>
      </div>}

      {/* ── Today's Actual Range Bar ─────────────────────────────────── */}
      {!activeMonth && rangeSize > 0 && (
        <div className="mc-range">
          <div className="mc-range-header">
            <span className="mc-range-title">Today's Actual Range</span>
            <span className="mc-range-pos">Position {curPos.toFixed(0)}% of range</span>
          </div>
          <div className="mc-range-bar-row">
            <span className="mc-range-edge mc-red-txt">${fmt(signal.dayLow)}</span>
            <div className="mc-range-track">
              <div className="mc-range-fill" style={{ width: `${curPos}%` }} />
              <div className="mc-range-dot"  style={{ left: `${curPos}%` }} />
            </div>
            <span className="mc-range-edge mc-green-txt">${fmt(signal.dayHigh)}</span>
          </div>
          <div className="mc-range-dists">
            <span className="mc-green-txt">▲ To High +${fmt(signal.dayHigh - entry)}</span>
            <span className="mc-red-txt">▼ To Low −${fmt(entry - signal.dayLow)}</span>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="mc-footer">
        Updated {new Date(signal.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        {signal.reasons.length > 0 && (
          <span className="mc-reasons"> · {signal.reasons.slice(0, 2).join(' · ')}</span>
        )}
      </div>
    </div>
  );
};

export default MoverCard;
