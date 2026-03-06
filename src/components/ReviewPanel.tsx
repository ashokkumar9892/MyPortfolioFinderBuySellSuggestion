import React, { useState, useEffect } from 'react';
import {
  StoredPrediction,
  DailyReview,
  StrategyParams,
} from '../types';
import {
  todayPredictions,
  loadReviews,
  runEndOfDayReview,
  lastReviewDate,
} from '../services/storage';

interface Props {
  currentParams: StrategyParams;
  onParamsUpdated: (p: StrategyParams) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function signalColor(sig: string): string {
  if (sig === 'BUY') return '#3fb950';
  if (sig === 'BUY TO COVER') return '#58a6ff';
  if (sig === 'SELL') return '#e3b341';
  if (sig === 'SELL SHORT') return '#f85149';
  return '#8b949e';
}

// ─── Component ────────────────────────────────────────────────────────────────

const ReviewPanel: React.FC<Props> = ({ currentParams, onParamsUpdated }) => {
  const [predictions, setPredictions] = useState<StoredPrediction[]>([]);
  const [reviews, setReviews] = useState<DailyReview[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [activeTab, setActiveTab] = useState<'today' | 'history' | 'params'>(
    'today'
  );
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);

  function refresh() {
    setPredictions(todayPredictions());
    setReviews(loadReviews().slice().reverse()); // newest first
    setAlreadyReviewed(lastReviewDate() === new Date().toDateString());
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  async function handleRunReview() {
    setRunning(true);
    setProgress('Starting review…');
    try {
      const review = await runEndOfDayReview(currentParams, setProgress);
      onParamsUpdated(review.paramsAfter);
      refresh();
    } finally {
      setRunning(false);
    }
  }

  // Stats for today
  const actionable = predictions.filter((p) => p.signal !== 'HOLD');
  const reviewed = actionable.filter((p) => p.reviewedAt !== undefined);
  const wins = reviewed.filter((p) => p.wasCorrect).length;
  const winRate = reviewed.length > 0 ? (wins / reviewed.length) * 100 : 0;
  const avgPL =
    reviewed.length > 0
      ? reviewed.reduce((s, p) => s + (p.profitLossPct ?? 0), 0) /
        reviewed.length
      : 0;

  return (
    <div className="review-panel">
      {/* ── Panel Header ─────────────────────────────────────────── */}
      <div className="review-header">
        <h2 className="section-title">End-of-Day Review</h2>
        <div className="review-tabs">
          {(['today', 'history', 'params'] as const).map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'today'
                ? `Today (${actionable.length})`
                : tab === 'history'
                ? 'History'
                : 'Strategy Params'}
            </button>
          ))}
        </div>
        <button
          className="review-btn"
          onClick={handleRunReview}
          disabled={running || actionable.length === 0}
          title={alreadyReviewed ? 'Already reviewed today' : 'Run end-of-day review now'}
        >
          {running ? '⏳ Reviewing…' : alreadyReviewed ? '✅ Reviewed' : '▶ Run Review'}
        </button>
      </div>

      {progress && running && (
        <div className="progress-msg">{progress}</div>
      )}

      {/* ── Today Tab ────────────────────────────────────────────── */}
      {activeTab === 'today' && (
        <>
          {/* Stats Row */}
          {reviewed.length > 0 && (
            <div className="stats-row">
              <div className="stat-box">
                <span className="stat-label">Win Rate</span>
                <span
                  className="stat-value"
                  style={{ color: winRate >= 50 ? '#3fb950' : '#f85149' }}
                >
                  {winRate.toFixed(0)}%
                </span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Avg P/L</span>
                <span
                  className="stat-value"
                  style={{ color: avgPL >= 0 ? '#3fb950' : '#f85149' }}
                >
                  {avgPL >= 0 ? '+' : ''}
                  {avgPL.toFixed(2)}%
                </span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Correct</span>
                <span className="stat-value">
                  {wins}/{reviewed.length}
                </span>
              </div>
            </div>
          )}

          {/* Predictions Table */}
          {actionable.length === 0 ? (
            <p className="empty-msg">No actionable predictions yet today.</p>
          ) : (
            <div className="table-wrap">
              <table className="pred-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Signal</th>
                    <th>Entry</th>
                    <th>Target</th>
                    <th>Stop</th>
                    <th>Conf.</th>
                    <th>Close</th>
                    <th>P/L</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {actionable.map((p) => (
                    <tr key={p.id}>
                      <td className="sym-cell">{p.symbol}</td>
                      <td>
                        <span
                          className="mini-badge"
                          style={{ color: signalColor(p.signal) }}
                        >
                          {p.signal}
                        </span>
                      </td>
                      <td>${fmt(p.entryPrice)}</td>
                      <td className="green">${fmt(p.exitTarget)}</td>
                      <td className="red">${fmt(p.stopLoss)}</td>
                      <td>{p.confidence.toFixed(0)}%</td>
                      <td>
                        {p.closingPrice !== undefined
                          ? `$${fmt(p.closingPrice)}`
                          : '—'}
                      </td>
                      <td
                        style={{
                          color:
                            p.profitLossPct !== undefined
                              ? p.profitLossPct >= 0
                                ? '#3fb950'
                                : '#f85149'
                              : '#8b949e',
                        }}
                      >
                        {p.profitLossPct !== undefined
                          ? `${p.profitLossPct >= 0 ? '+' : ''}${p.profitLossPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td>
                        {p.wasCorrect === true ? (
                          <span className="result-win">WIN</span>
                        ) : p.wasCorrect === false ? (
                          <span className="result-loss">LOSS</span>
                        ) : (
                          <span className="result-pending">PENDING</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── History Tab ──────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <>
          {reviews.length === 0 ? (
            <p className="empty-msg">No historical reviews yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="pred-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Signals</th>
                    <th>Correct</th>
                    <th>Win Rate</th>
                    <th>Avg P/L</th>
                    <th>Tuning</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td>{r.actionablePredictions}</td>
                      <td>{r.correctPredictions}</td>
                      <td
                        style={{
                          color:
                            r.winRate >= 0.5 ? '#3fb950' : '#f85149',
                        }}
                      >
                        {(r.winRate * 100).toFixed(0)}%
                      </td>
                      <td
                        style={{
                          color:
                            r.avgProfitLossPct >= 0 ? '#3fb950' : '#f85149',
                        }}
                      >
                        {r.avgProfitLossPct >= 0 ? '+' : ''}
                        {r.avgProfitLossPct.toFixed(2)}%
                      </td>
                      <td className="tuning-cell">{r.tuningSummary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Params Tab ───────────────────────────────────────────── */}
      {activeTab === 'params' && (
        <div className="params-grid">
          {(
            [
              ['RSI Oversold', currentParams.rsiOversold, '(BUY trigger < this)'],
              ['RSI Overbought', currentParams.rsiOverbought, '(SHORT trigger > this)'],
              ['BUY Threshold', currentParams.buyThreshold, '(score ≥ this)'],
              ['BUY TO COVER Threshold', currentParams.coverThreshold, '(score ≥ this)'],
              ['SELL Threshold', currentParams.sellThreshold, '(score ≤ −this)'],
              ['SELL SHORT Threshold', currentParams.shortThreshold, '(score ≤ −this)'],
              ['Min Volume Ratio', currentParams.minVolumeRatio, '(× avg volume)'],
              ['BB Multiplier', currentParams.bbMultiplier, '(std devs)'],
              ['Target %', (currentParams.targetPct * 100).toFixed(1) + '%', '(exit target)'],
              ['Stop %', (currentParams.stopPct * 100).toFixed(1) + '%', '(stop loss)'],
            ] as [string, number | string, string][]
          ).map(([name, value, hint]) => (
            <div key={name} className="param-item">
              <span className="param-name">{name}</span>
              <span className="param-value">{value}</span>
              <span className="param-hint">{hint}</span>
            </div>
          ))}
          <p className="params-note">
            Parameters are auto-tuned nightly at 7 PM based on prediction
            accuracy.
          </p>
        </div>
      )}
    </div>
  );
};

export default ReviewPanel;
