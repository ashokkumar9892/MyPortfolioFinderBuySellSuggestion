import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MoverCard from './MoverCard';
import { TradingSignal, TradeMode, StrategyParams, MoverInfo, MonthlyRangeData, MonthData } from '../types';
import { fetchAllStocks, isMarketOpen, marketSession, fetchMonthlyRanges } from '../services/stockApi';
import { analyzeStock } from '../services/strategy';
import {
  loadMoverParams,
  saveMoverParams,
  fetchMarketMovers,
  storeMoverSnapshots,
  runNightlyMoverReview,
  schedule9PMReview,
  saveReviewRecord,
  loadReviewHistory,
  savePredictions,
  runServerReview,
  loadRangeReviewHistory,
  HourlyReviewResult,
  ReviewRecord,
  RangeReview,
} from '../services/marketMovers';

const REFRESH_MS = 15 * 60 * 1000; // 15 min auto-refresh

// ── Return info helper (mirrors MoverCard logic) ───────────────────────────
function computeReturnInfo(sig: TradingSignal, changePct: number) {
  const e       = sig.entryPrice;
  const isLong  = sig.signal === 'BUY' || sig.signal === 'BUY TO COVER';
  const isHold  = sig.signal === 'HOLD';
  const bullish = isLong || (isHold && changePct >= 0);

  const dayTgt   = !isHold ? sig.exitTarget  : bullish ? e * 1.04  : e * 0.96;
  const dayStop  = !isHold ? sig.stopLoss    : bullish ? e * 0.975 : e * 1.025;
  const swingTgt = !isHold ? (bullish ? sig.swingTarget : sig.swingStop)
                           : (bullish ? e * 1.10        : e * 0.90);

  const dayRetPct   = e > 0 ? Math.abs((dayTgt  - e) / e * 100) : 0;
  const dayRiskPct  = e > 0 ? Math.abs((dayStop - e) / e * 100) : 0;
  const swingRetPct = e > 0 ? Math.abs((swingTgt - e) / e * 100) : 0;
  const rr          = dayRiskPct > 0 ? dayRetPct / dayRiskPct : 0;
  return { dayTgt, dayStop, swingTgt, dayRetPct, dayRiskPct, swingRetPct, rr, bullish };
}

interface Props {
  tradeMode: TradeMode;
  monthlyView: boolean;
  selectedMonthOffset: number;
}

const GainersLosers: React.FC<Props> = ({ tradeMode, monthlyView, selectedMonthOffset }) => {
  const [gainerInfos,   setGainerInfos]   = useState<MoverInfo[]>([]);
  const [loserInfos,    setLoserInfos]    = useState<MoverInfo[]>([]);
  const [gainerSignals, setGainerSignals] = useState<TradingSignal[]>([]);
  const [loserSignals,  setLoserSignals]  = useState<TradingSignal[]>([]);
  const [moverParams,   setMoverParams]   = useState<StrategyParams>(loadMoverParams);
  const [loading,       setLoading]       = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null);
  const [review,        setReview]        = useState<HourlyReviewResult | null>(null);
  const [rangeReview,   setRangeReview]   = useState<RangeReview | null>(null);
  const [countdown,     setCountdown]     = useState('');
  const [fetchError,    setFetchError]    = useState('');
  const [isOpen,        setIsOpen]        = useState(isMarketOpen());
  const [reviewHistory,     setReviewHistory]     = useState<ReviewRecord[]>([]);
  const [rangeReviewHistory, setRangeReviewHistory] = useState<RangeReview[]>([]);
  const [topView,           setTopView]           = useState<'day' | 'swing'>('day');
  const [monthlyRanges,     setMonthlyRanges]     = useState<Record<string, MonthlyRangeData>>({});
  const [monthlyLoading,    setMonthlyLoading]    = useState(false);

  // ── Top-50 derived data ────────────────────────────────────────────────────
  const enriched = useMemo(() => {
    const infoMap = new Map([...gainerInfos, ...loserInfos].map(m => [m.symbol, m]));
    const seen    = new Set<string>();
    return [...gainerSignals, ...loserSignals].reduce<
      Array<{ sig: TradingSignal; changePct: number } & ReturnType<typeof computeReturnInfo>>
    >((acc, sig) => {
      if (seen.has(sig.symbol)) return acc;
      seen.add(sig.symbol);
      const changePct = infoMap.get(sig.symbol)?.changePercent ?? sig.indicators.momentum;
      acc.push({ sig, changePct, ...computeReturnInfo(sig, changePct) });
      return acc;
    }, []);
  }, [gainerSignals, loserSignals, gainerInfos, loserInfos]);

  const topByDay   = useMemo(() =>
    [...enriched].sort((a, b) => b.dayRetPct   - a.dayRetPct  ).slice(0, 50), [enriched]);
  const topBySwing = useMemo(() =>
    [...enriched].sort((a, b) => b.swingRetPct - a.swingRetPct).slice(0, 50), [enriched]);

  const moverParamsRef = useRef<StrategyParams>(moverParams);
  useEffect(() => { moverParamsRef.current = moverParams; }, [moverParams]);

  const allSignalsRef = useRef<TradingSignal[]>([]);

  // ── Load histories on mount ────────────────────────────────────────────────
  useEffect(() => {
    loadReviewHistory().then(h => setReviewHistory([...h].reverse()));
    loadRangeReviewHistory('movers').then(h => setRangeReviewHistory([...h].reverse()));
  }, []);

  // ── Session watcher ────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setIsOpen(isMarketOpen()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch + analyse ────────────────────────────────────────────────────────
  const fetchAndAnalyse = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true); else setRefreshing(true);
    setFetchError('');

    try {
      const { gainers, losers } = await fetchMarketMovers(25);
      const allSymbols = [...new Set([...gainers.map(g => g.symbol), ...losers.map(l => l.symbol)])];

      let allSignals: TradingSignal[] = [];
      if (allSymbols.length > 0) {
        const stockData = await fetchAllStocks(allSymbols);
        allSignals = stockData.map(s => analyzeStock(s, moverParamsRef.current, tradeMode));
        allSignalsRef.current = allSignals;
        storeMoverSnapshots(allSignals, [...gainers, ...losers]);

        // Save predictions to server for 7 PM review
        const today = new Date().toISOString().slice(0, 10);
        const infoMap = new Map([...gainers, ...losers].map(m => [m.symbol, m]));
        savePredictions('movers', allSignals.map(s => ({
          symbol:      s.symbol,
          signal:      s.signal,
          entryPrice:  s.entryPrice,
          dayTarget:   s.exitTarget,
          dayStop:     s.stopLoss,
          swingTarget: s.swingTarget,
          swingStop:   s.swingStop,
          changePercent: infoMap.get(s.symbol)?.changePercent ?? 0,
          date: today,
        })));
      }

      const sigMap = new Map(allSignals.map(s => [s.symbol, s]));
      setGainerInfos(gainers);
      setLoserInfos(losers);
      setGainerSignals(gainers.map(g => sigMap.get(g.symbol)!).filter(Boolean));
      setLoserSignals(losers.map(l => sigMap.get(l.symbol)!).filter(Boolean));
      setLastUpdated(new Date());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tradeMode]);

  // ── Initial load + auto-refresh (market hours only) ───────────────────────
  useEffect(() => {
    fetchAndAnalyse(true);
    if (!isOpen) return;
    const id = setInterval(() => fetchAndAnalyse(), REFRESH_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── 7 PM ET nightly review ─────────────────────────────────────────────────
  useEffect(() => {
    const cancel = schedule9PMReview(() => {
      // Local strategy tuning (localStorage)
      const result = runNightlyMoverReview(allSignalsRef.current, moverParamsRef.current);
      if (result.total > 0) {
        setReview(result);
        setMoverParams(result.newParams);
        saveMoverParams(result.newParams);
        moverParamsRef.current = result.newParams;
        saveReviewRecord(result).then(() =>
          loadReviewHistory().then(h => setReviewHistory([...h].reverse()))
        );
      }
      // Server-side range accuracy review
      runServerReview('movers').then(r => {
        if (r && r.total > 0) {
          setRangeReview(r);
          loadRangeReviewHistory('movers').then(h => setRangeReviewHistory([...h].reverse()));
        }
      });
    });
    return cancel;
  }, []);

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!lastUpdated) return;
      const diff = Math.max(0, Math.floor((lastUpdated.getTime() + REFRESH_MS - Date.now()) / 1000));
      setCountdown(`${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  // ── Monthly range helpers ──────────────────────────────────────────────────
  function getMonthKey(offset: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getActiveMonth(sym: string): MonthData | undefined {
    const key = getMonthKey(selectedMonthOffset);
    return monthlyRanges[sym]?.months[key];
  }

  // ── Fetch monthly ranges when monthlyView toggles on ──────────────────────
  useEffect(() => {
    if (!monthlyView) return;
    const allSymbols = [...new Set([...gainerInfos, ...loserInfos].map(m => m.symbol))];
    if (allSymbols.length === 0) return;
    const missing = allSymbols.filter(s => !monthlyRanges[s]);
    if (missing.length === 0) return;
    setMonthlyLoading(true);
    fetchMonthlyRanges(missing).then(data => {
      setMonthlyRanges(prev => ({ ...prev, ...data }));
      setMonthlyLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyView, gainerInfos, loserInfos]);

  // ── Render section ─────────────────────────────────────────────────────────
  function renderSection(
    title: string,
    infos: MoverInfo[],
    signals: TradingSignal[],
    cls: 'movers-gainers' | 'movers-losers',
  ) {
    if (signals.length === 0 && !loading) return null;
    return (
      <div className="movers-section">
        <div className={`movers-section-header ${cls}`}>
          <span className="movers-section-title">{title}</span>
          <div className="movers-badges-row">
            {infos.map(info => (
              <span key={info.symbol} className={`mover-badge ${cls}`} title={info.name}>
                {info.symbol}
                <span className="mover-badge-pct">
                  {info.changePercent >= 0 ? '+' : ''}{info.changePercent.toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="stock-grid movers-grid">
          {signals.map(s => {
            const pct = infos.find(i => i.symbol === s.symbol)?.changePercent ?? s.indicators.momentum;
            return <MoverCard key={s.symbol} signal={s} changePercent={pct} activeMonth={monthlyView ? getActiveMonth(s.symbol) : undefined} />;
          })}
        </div>
      </div>
    );
  }

  const session   = marketSession();
  const reviewCls = !review ? '' : review.winRate >= 0.6 ? 'review-good' : review.winRate < 0.4 ? 'review-poor' : 'review-mid';
  const rangeCls  = !rangeReview ? '' : rangeReview.winRate >= 0.6 ? 'review-good' : rangeReview.winRate < 0.4 ? 'review-poor' : 'review-mid';

  return (
    <div className="movers-page">

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="movers-status-bar">
        <span className="movers-status-label">
          🔥 Top 25 Gainers &amp; Losers · Top 50 by Return · Yahoo Finance scan ·{' '}
          {isOpen ? 'Auto-refresh every 15 min' : `${session === 'closed' ? '🔴 Market Closed' : '🌙 After-Hours'} — last data shown`}
        </span>
        <div className="movers-status-right">
          {lastUpdated && (
            <span className="movers-updated">
              Updated {lastUpdated.toLocaleTimeString()}
              {isOpen && ` · Next: ${countdown}`}
            </span>
          )}
          {monthlyLoading && <span className="movers-updated">📅 Loading monthly ranges…</span>}
          <button
            className="refresh-btn"
            onClick={() => fetchAndAnalyse(true)}
            disabled={refreshing || loading}
          >
            {refreshing || loading ? '⟳ Loading…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Session banner when closed ──────────────────────────────────── */}
      {!isOpen && (
        <div className="movers-closed-banner">
          {session === 'closed'
            ? '🔴 Market closed — showing last fetched data. Auto-refresh resumes at 7 AM ET.'
            : '🌙 After-hours — showing current after-hours prices.'}
        </div>
      )}

      {/* ── Strategy tuning result ───────────────────────────────────────── */}
      {review && review.total > 0 && (
        <div className={`movers-review-bar ${reviewCls}`}>
          <span className="review-icon">{review.winRate >= 0.6 ? '✓' : review.winRate < 0.4 ? '✗' : '~'}</span>
          7 PM Review: <strong>{review.correct}/{review.total}</strong> correct
          ({(review.winRate * 100).toFixed(0)}%) — {review.tuningSummary}
        </div>
      )}

      {/* ── Range accuracy result ────────────────────────────────────────── */}
      {rangeReview && rangeReview.total > 0 && (
        <div className={`movers-review-bar ${rangeCls}`}>
          <span className="review-icon">📏</span>
          Range Accuracy: <strong>{rangeReview.correct}/{rangeReview.total}</strong> correct direction ·
          Avg range hit <strong>{rangeReview.avgRangeHitPct}%</strong> of target
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {fetchError && <div className="movers-error-bar">⚠ {fetchError}</div>}

      {/* ── Loading spinner ─────────────────────────────────────────────── */}
      {(loading || refreshing) && (
        <div className="loading-screen">
          <div className="spinner" />
          <p>Scanning {loading ? '~550' : ''} stocks for top movers…</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {!loading && (
        <>
          {renderSection('📈 Top 25 Gainers Today', gainerInfos, gainerSignals, 'movers-gainers')}
          {renderSection('📉 Top 25 Losers Today',  loserInfos,  loserSignals,  'movers-losers')}

          {/* ── Top 50 Best Returns Table ──────────────────────────────── */}
          {enriched.length > 0 && (
            <div className="review-history-section">
              <div className="top50-header">
                <span className="review-history-title" style={{ borderBottom: 'none', display: 'inline' }}>
                  🏆 Top {Math.min(enriched.length, 50)} Best Return Opportunities
                </span>
                <div className="top50-toggle">
                  <button className={`sort-btn ${topView === 'day' ? 'active' : ''}`} onClick={() => setTopView('day')}>⚡ Day Trade</button>
                  <button className={`sort-btn ${topView === 'swing' ? 'active' : ''}`} onClick={() => setTopView('swing')}>🌙 Swing Trade</button>
                </div>
              </div>
              <table className="review-history-table">
                <thead>
                  <tr>
                    <th>#</th><th>Symbol</th><th>Signal</th><th>Entry</th>
                    {topView === 'day'
                      ? <><th>Day Target</th><th>Return %</th><th>Stop</th><th>Risk %</th><th>R:R</th></>
                      : <><th>Swing Target</th><th>Return %</th><th>Hold</th></>}
                  </tr>
                </thead>
                <tbody>
                  {(topView === 'day' ? topByDay : topBySwing).map((item, i) => {
                    const { sig, changePct, dayTgt, dayStop, swingTgt, dayRetPct, dayRiskPct, swingRetPct, rr, bullish } = item;
                    const retPct    = topView === 'day' ? dayRetPct : swingRetPct;
                    const sigColor  = sig.signal === 'BUY' ? 'var(--green)'
                                    : sig.signal === 'SELL SHORT' ? 'var(--red)'
                                    : sig.signal === 'BUY TO COVER' ? 'var(--blue)'
                                    : sig.signal === 'SELL' ? 'var(--yellow)'
                                    : 'var(--text2)';
                    return (
                      <tr key={sig.symbol}>
                        <td style={{ color: 'var(--text2)', width: 28 }}>{i + 1}</td>
                        <td>
                          <strong>{sig.symbol}</strong>
                          <span style={{ marginLeft: 5, fontSize: '0.72rem', color: changePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                          </span>
                        </td>
                        <td><span style={{ color: sigColor, fontWeight: 600, fontSize: '0.75rem' }}>{sig.signal}</span></td>
                        <td>${sig.entryPrice.toFixed(2)}</td>
                        {topView === 'day' ? <>
                          <td style={{ color: bullish ? 'var(--green)' : 'var(--red)' }}>${dayTgt.toFixed(2)}</td>
                          <td><strong style={{ color: retPct >= 5 ? 'var(--green)' : 'var(--text)' }}>{bullish ? '+' : '-'}{dayRetPct.toFixed(2)}%</strong></td>
                          <td style={{ color: 'var(--red)' }}>${dayStop.toFixed(2)}</td>
                          <td style={{ color: 'var(--red)', fontSize: '0.8rem' }}>-{dayRiskPct.toFixed(2)}%</td>
                          <td style={{ color: rr >= 2 ? 'var(--green)' : rr >= 1 ? 'var(--text)' : 'var(--red)' }}>{rr.toFixed(1)}×</td>
                        </> : <>
                          <td style={{ color: bullish ? 'var(--green)' : 'var(--red)' }}>${swingTgt.toFixed(2)}</td>
                          <td><strong style={{ color: retPct >= 10 ? 'var(--green)' : 'var(--text)' }}>{bullish ? '+' : '-'}{swingRetPct.toFixed(2)}%</strong></td>
                          <td style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>1–3 days</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Params note ─────────────────────────────────────────────────── */}
      <div className="movers-params-note">
        Source: Yahoo Finance (live quotes) · Predictions saved for 7 PM ET review ·
        Buy threshold: {moverParams.buyThreshold.toFixed(2)} ·
        Short threshold: {moverParams.shortThreshold.toFixed(2)} ·
        RSI: {moverParams.rsiOversold}/{moverParams.rsiOverbought}
      </div>

      {/* ── Range Review History ─────────────────────────────────────────── */}
      {rangeReviewHistory.length > 0 && (
        <div className="review-history-section">
          <div className="review-history-title">📏 7 PM Range Review History (Market Movers)</div>
          <table className="review-history-table">
            <thead>
              <tr><th>Date</th><th>Direction</th><th>Avg Range Hit</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {rangeReviewHistory.map(r => {
                const pct = (r.winRate * 100).toFixed(0);
                const c   = r.winRate >= 0.6 ? 'rh-good' : r.winRate < 0.4 ? 'rh-poor' : 'rh-mid';
                return (
                  <tr key={r.date + r.tab} className={c}>
                    <td className="rh-date">{r.date}</td>
                    <td className="rh-result">{r.correct}/{r.total} <span className={`rh-badge ${c}`}>{pct}%</span></td>
                    <td className="rh-rate"><strong>{r.avgRangeHitPct}%</strong> of target</td>
                    <td className="rh-summary">{r.summary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Strategy History ─────────────────────────────────────────────── */}
      {reviewHistory.length > 0 && (
        <div className="review-history-section">
          <div className="review-history-title">📊 Strategy Tuning History</div>
          <table className="review-history-table">
            <thead>
              <tr><th>Date</th><th>Result</th><th>Win Rate</th><th>Tuning</th></tr>
            </thead>
            <tbody>
              {reviewHistory.map(r => {
                const pct = (r.winRate * 100).toFixed(0);
                const c   = r.winRate >= 0.6 ? 'rh-good' : r.winRate < 0.4 ? 'rh-poor' : 'rh-mid';
                return (
                  <tr key={r.date} className={c}>
                    <td className="rh-date">{r.date}</td>
                    <td className="rh-result">{r.correct}/{r.total}</td>
                    <td className="rh-rate"><span className={`rh-badge ${c}`}>{pct}%</span></td>
                    <td className="rh-summary">{r.tuningSummary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GainersLosers;
