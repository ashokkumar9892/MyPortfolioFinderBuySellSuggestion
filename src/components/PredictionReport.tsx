import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekRow {
  key: string;       // "2026-W10"
  total: number;
  correct: number;
  targetHit: number;
  winRate: number;
  targetHitRate: number;
}

interface SignalRow {
  key: string;       // "BUY" | "SELL SHORT" | ...
  total: number;
  correct: number;
  targetHit: number;
  winRate: number;
  targetHitRate: number;
}

interface SymbolRow {
  symbol: string;
  total: number;
  correct: number;
  targetHit: number;
  winRate: number;
  targetHitRate: number;
}

interface DailyRow {
  date: string;
  week: string;
  source: string;
  total: number;
  correct: number;
  winRate: number;
  avgRangeHit: number;
  holds: number;
  targetHits: number;
}

interface Report {
  generatedAt: string;
  weeksBack: number;
  weekly: WeekRow[];
  bySignal: SignalRow[];
  bySource: SignalRow[];
  bySymbol: SymbolRow[];
  daily: DailyRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function winColor(rate: number): string {
  if (rate >= 65) return '#3fb950';
  if (rate >= 50) return '#e3b341';
  return '#f85149';
}

function pct(n: number | undefined | null): string {
  if (n == null) return '-';
  return `${n.toFixed(1)}%`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const PredictionReport: React.FC = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [activeSection, setActiveSection] = useState<'weekly' | 'signal' | 'symbol' | 'daily'>('weekly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportTab, setExportTab] = useState<'all' | 'portfolio' | 'movers'>('all');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/predictions/report?weeks=${weeks}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ tab: exportTab });
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo)   params.set('to',   exportTo);
      const res = await fetch(`/api/predictions/export/csv?${params}`);
      if (!res.ok) {
        const j = await res.json();
        alert(j.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `predictions_${exportTab}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  // ── Overall summary ──────────────────────────────────────────────────────

  const totalPredictions = report?.daily.reduce((s, d) => s + d.total, 0) ?? 0;
  const totalCorrect     = report?.daily.reduce((s, d) => s + d.correct, 0) ?? 0;
  const totalTargetHits  = report?.daily.reduce((s, d) => s + d.targetHits, 0) ?? 0;
  const overallWin       = totalPredictions > 0 ? (totalCorrect / totalPredictions * 100) : 0;
  const avgRangeHit      = report?.daily.length
    ? report.daily.reduce((s, d) => s + (d.avgRangeHit || 0), 0) / report.daily.length
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="report-panel">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="report-header">
        <div className="report-title-row">
          <h2 className="report-title">Prediction Accuracy Report</h2>
          <div className="report-controls">
            <label className="ctrl-label">Look-back:</label>
            {[4, 8, 12, 26].map(w => (
              <button
                key={w}
                className={`ctrl-btn ${weeks === w ? 'active' : ''}`}
                onClick={() => setWeeks(w)}
              >
                {w}w
              </button>
            ))}
            <button className="ctrl-btn refresh-btn-sm" onClick={fetchReport} disabled={loading}>
              {loading ? '⟳' : '↺ Refresh'}
            </button>
          </div>
        </div>
        {report && (
          <p className="report-meta">
            Generated {new Date(report.generatedAt).toLocaleString()} · last {report.weeksBack} weeks
          </p>
        )}
      </div>

      {error && <div className="report-error">Error loading report: {error}</div>}

      {/* ── Summary Cards ───────────────────────────────────────────────── */}
      {report && (
        <div className="report-summary-cards">
          <div className="rpt-card">
            <span className="rpt-card-label">Total Signals</span>
            <span className="rpt-card-value">{totalPredictions}</span>
          </div>
          <div className="rpt-card">
            <span className="rpt-card-label">Direction Correct</span>
            <span className="rpt-card-value" style={{ color: winColor(overallWin) }}>
              {totalCorrect} / {totalPredictions}
            </span>
          </div>
          <div className="rpt-card">
            <span className="rpt-card-label">Win Rate</span>
            <span className="rpt-card-value" style={{ color: winColor(overallWin) }}>
              {pct(overallWin)}
            </span>
          </div>
          <div className="rpt-card">
            <span className="rpt-card-label">Target Hits</span>
            <span className="rpt-card-value green">{totalTargetHits}</span>
          </div>
          <div className="rpt-card">
            <span className="rpt-card-label">Avg Range Hit</span>
            <span className="rpt-card-value">{pct(avgRangeHit)}</span>
          </div>
          <div className="rpt-card">
            <span className="rpt-card-label">Days Tracked</span>
            <span className="rpt-card-value">{report.daily.length}</span>
          </div>
        </div>
      )}

      {/* ── Export Panel ────────────────────────────────────────────────── */}
      <div className="export-panel">
        <h3 className="export-title">Download CSV</h3>
        <div className="export-controls">
          <div className="export-row">
            <label className="ctrl-label">Source:</label>
            {(['all', 'portfolio', 'movers'] as const).map(t => (
              <button
                key={t}
                className={`ctrl-btn ${exportTab === t ? 'active' : ''}`}
                onClick={() => setExportTab(t)}
              >
                {t === 'all' ? 'All' : t === 'portfolio' ? 'Portfolio' : 'Market Movers'}
              </button>
            ))}
          </div>
          <div className="export-row">
            <label className="ctrl-label">From:</label>
            <input
              type="date"
              className="date-input"
              value={exportFrom}
              onChange={e => setExportFrom(e.target.value)}
            />
            <label className="ctrl-label">To:</label>
            <input
              type="date"
              className="date-input"
              value={exportTo}
              onChange={e => setExportTo(e.target.value)}
            />
            <button
              className="export-btn"
              onClick={handleExport}
              disabled={exportingRef(exporting)}
            >
              {exporting ? 'Exporting…' : '⬇ Download CSV'}
            </button>
          </div>
        </div>
        <p className="export-hint">
          CSV includes: Date · Source · Symbol · Signal · Entry · Day Target/Stop · Swing Target/Stop ·
          Actual Close · Direction Correct · Outcome · Range Hit % · P&amp;L %
        </p>
      </div>

      {/* ── Section Tabs ────────────────────────────────────────────────── */}
      {report && (
        <>
          <div className="report-section-tabs">
            {(['weekly', 'signal', 'symbol', 'daily'] as const).map(s => (
              <button
                key={s}
                className={`section-tab ${activeSection === s ? 'active' : ''}`}
                onClick={() => setActiveSection(s)}
              >
                {s === 'weekly' ? 'By Week' :
                 s === 'signal' ? 'By Signal' :
                 s === 'symbol' ? 'By Symbol' : 'Daily Log'}
              </button>
            ))}
          </div>

          {/* ── By Week ──────────────────────────────────────────────────── */}
          {activeSection === 'weekly' && (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Signals</th>
                    <th>Correct</th>
                    <th>Win Rate</th>
                    <th>Target Hits</th>
                    <th>Target Hit Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weekly.length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">No data yet — signals get reviewed nightly at 7 PM.</td></tr>
                  ) : report.weekly.slice().reverse().map(row => (
                    <tr key={row.key}>
                      <td className="sym-cell">{row.key}</td>
                      <td>{row.total}</td>
                      <td>{row.correct}</td>
                      <td style={{ color: winColor(row.winRate), fontWeight: 600 }}>{pct(row.winRate)}</td>
                      <td className="green">{row.targetHit}</td>
                      <td>{pct(row.targetHitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── By Signal ───────────────────────────────────────────────── */}
          {activeSection === 'signal' && (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Total</th>
                    <th>Correct</th>
                    <th>Win Rate</th>
                    <th>Target Hits</th>
                    <th>Target Hit Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bySignal.length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">No data yet.</td></tr>
                  ) : report.bySignal.sort((a,b) => b.total - a.total).map(row => (
                    <tr key={row.key}>
                      <td className={`signal-cell signal-${row.key.toLowerCase().replace(/ /g,'-')}`}>
                        {row.key}
                      </td>
                      <td>{row.total}</td>
                      <td>{row.correct}</td>
                      <td style={{ color: winColor(row.winRate), fontWeight: 600 }}>{pct(row.winRate)}</td>
                      <td className="green">{row.targetHit}</td>
                      <td>{pct(row.targetHitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── By Symbol ───────────────────────────────────────────────── */}
          {activeSection === 'symbol' && (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Total</th>
                    <th>Correct</th>
                    <th>Win Rate</th>
                    <th>Target Hits</th>
                    <th>Target Hit Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bySymbol.length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">No data yet.</td></tr>
                  ) : report.bySymbol.map(row => (
                    <tr key={row.symbol}>
                      <td className="sym-cell">{row.symbol}</td>
                      <td>{row.total}</td>
                      <td>{row.correct}</td>
                      <td style={{ color: winColor(row.winRate), fontWeight: 600 }}>{pct(row.winRate)}</td>
                      <td className="green">{row.targetHit}</td>
                      <td>{pct(row.targetHitRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Daily Log ────────────────────────────────────────────────── */}
          {activeSection === 'daily' && (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Signals</th>
                    <th>HOLDs</th>
                    <th>Correct</th>
                    <th>Win Rate</th>
                    <th>Target Hits</th>
                    <th>Avg Range Hit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.length === 0 ? (
                    <tr><td colSpan={8} className="empty-cell">No daily data yet.</td></tr>
                  ) : report.daily.map((row, i) => (
                    <tr key={i}>
                      <td className="sym-cell">{row.date}</td>
                      <td className="muted-cell">{row.source}</td>
                      <td>{row.total}</td>
                      <td className="muted-cell">{row.holds}</td>
                      <td>{row.correct}</td>
                      <td style={{ color: winColor(row.winRate * 100), fontWeight: 600 }}>
                        {pct(row.winRate * 100)}
                      </td>
                      <td className="green">{row.targetHits}</td>
                      <td>{pct(row.avgRangeHit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!report && !loading && !error && (
        <div className="report-empty">
          <p>No review data yet. Reviews run automatically at 7 PM each trading day.</p>
          <p>You can also trigger a review manually from the Portfolio tab → Review Panel.</p>
        </div>
      )}
    </div>
  );
};

// Tiny helper to avoid React warning about ref in disabled prop
function exportingRef(v: boolean) { return v; }

export default PredictionReport;
