import React, { useState, useEffect, useCallback, useRef } from 'react';
import StockCard from './components/StockCard';
import ReviewPanel from './components/ReviewPanel';
import GainersLosers from './components/GainersLosers';
import PredictionReport from './components/PredictionReport';
import {
  TradingSignal,
  StrategyParams,
  SignalType,
  TradeMode,
  MonthlyRangeData,
  MonthData,
} from './types';
import { fetchAllStocks, fetchMonthlyRanges, marketStatusLabel, isMarketOpen, marketSession } from './services/stockApi';
import { analyzeStock } from './services/strategy';
import {
  loadParams,
  saveParams,
  storeTodaySignals,
  schedule7PMReview,
  runEndOfDayReview,
} from './services/storage';
import { savePredictions, runServerReview } from './services/marketMovers';
import './App.css';

// ─── Stock list ───────────────────────────────────────────────────────────────

const SYMBOLS = [
  'ABVX', 'AAP', 'ADMA', 'AGEN','AGMH','AARD','BEKE', 'CELC', 'CNC', 'CONI', 'DAVE','EXAS',
  'FIVN', 'GLUE','GEMI', 'LUMN', 'LWAY', 'MGPI', 'NNNN','NPKI', 'NVCR', 'NVDL',
  'ODD', 'PEGA', 'QURE', 'RXO', 'SBUX', 'SERV', 'SOGP', 'TIL','TLS',
  'TREE', 'UPST', 'WLDN', 'ZEPP',
];

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

type FilterOption = 'ALL' | SignalType;
const FILTERS: FilterOption[] = ['ALL', 'BUY', 'BUY TO COVER', 'HOLD', 'SELL', 'SELL SHORT'];

// ─── App ──────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'portfolio' | 'movers' | 'reports'>('portfolio');
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [params, setParams] = useState<StrategyParams>(loadParams);
  const [filter, setFilter] = useState<FilterOption>('ALL');
  const [sortBy, setSortBy] = useState<'return' | 'symbol' | 'confidence' | 'score'>('return');
  const [tradeMode, setTradeMode] = useState<TradeMode>('DAY');
  const [monthlyView, setMonthlyView] = useState(false);
  const [monthlyRanges, setMonthlyRanges] = useState<Record<string, MonthlyRangeData>>({});
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [selectedMonthOffset, setSelectedMonthOffset] = useState(0);
  const [reviewMsg, setReviewMsg] = useState('');
  const [countdown, setCountdown] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch & analyse ───────────────────────────────────────────────────────

  const fetchAndAnalyse = useCallback(
    async (isManual = false, mode: TradeMode = tradeMode) => {
      if (!isManual) setRefreshing(true);
      try {
        const stockData = await fetchAllStocks(SYMBOLS);
        const newSignals = stockData.map((s) => analyzeStock(s, params, mode));
        setSignals(newSignals);
        setLastUpdated(new Date());
        storeTodaySignals(newSignals);
        // Save predictions to server for 7 PM range review
        savePredictions('portfolio', newSignals.map(s => ({
          symbol: s.symbol, signal: s.signal,
          entryPrice: s.entryPrice, dayTarget: s.exitTarget, dayStop: s.stopLoss,
          swingTarget: s.swingTarget, swingStop: s.swingStop,
        })));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [params, tradeMode]
  );

  // Re-analyse immediately when trade mode changes (no new fetch needed)
  const reanalyse = useCallback(
    (mode: TradeMode) => {
      setSignals((prev) =>
        prev.map((s) => {
          // Volatility-adjusted swing targets (same logic as strategy.ts)
          const rangeSize = (s.dayHigh ?? 0) - (s.dayLow ?? 0);
          const dayRangePct = rangeSize > 0 && s.entryPrice > 0 ? rangeSize / s.entryPrice : 0;
          const swingTargetMult = Math.max(params.targetPct * 2.5, dayRangePct * 0.60);
          const swingStopMult   = Math.max(params.stopPct  * 2.0, dayRangePct * 0.35);
          const isLong = s.signal === 'BUY' || s.signal === 'BUY TO COVER';
          const swingTarget = parseFloat((isLong
            ? s.entryPrice * (1 + swingTargetMult)
            : s.entryPrice * (1 - swingTargetMult)
          ).toFixed(2));
          const swingStop = parseFloat((isLong
            ? s.entryPrice * (1 - swingStopMult)
            : s.entryPrice * (1 + swingStopMult)
          ).toFixed(2));
          return { ...s, tradeMode: mode, swingTarget, swingStop };
        })
      );
    },
    [params]
  );

  // ── Initial load + 10-min interval ───────────────────────────────────────

  useEffect(() => {
    fetchAndAnalyse(true);
    intervalRef.current = setInterval(() => {
      if (isMarketOpen()) fetchAndAnalyse();
    }, REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAndAnalyse]);

  // ── 7 PM auto-review ─────────────────────────────────────────────────────

  useEffect(() => {
    const cleanup = schedule7PMReview(async (currentParams) => {
      setReviewMsg('Running 7 PM end-of-day review…');
      const review = await runEndOfDayReview(currentParams, setReviewMsg);
      setParams(review.paramsAfter);
      saveParams(review.paramsAfter);
      // Also run server-side range accuracy review for portfolio
      runServerReview('portfolio');
      setTimeout(() => setReviewMsg(''), 8000);
    });
    return cleanup;
  }, []);

  // ── Countdown ────────────────────────────────────────────────────────────

  useEffect(() => {
    function tick() {
      if (!lastUpdated) return;
      const next = new Date(lastUpdated.getTime() + REFRESH_INTERVAL_MS);
      const diff = Math.max(0, Math.floor((next.getTime() - Date.now()) / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setCountdown(isMarketOpen() ? `${m}:${s.toString().padStart(2, '0')}` : '--');
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  function handleParamsUpdated(newParams: StrategyParams) {
    setParams(newParams);
    saveParams(newParams);
  }

  function handleModeChange(mode: TradeMode) {
    setTradeMode(mode);
    reanalyse(mode);
  }

  async function handleMonthlyToggle() {
    const next = !monthlyView;
    setMonthlyView(next);
    if (next && Object.keys(monthlyRanges).length === 0) {
      setMonthlyLoading(true);
      const data = await fetchMonthlyRanges(SYMBOLS);
      setMonthlyRanges(data);
      setMonthlyLoading(false);
    }
    if (!next) setSelectedMonthOffset(0);
  }

  function getMonthKey(offset: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function getMonthLabel(offset: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function getActiveMonth(sym: string): MonthData | undefined {
    const key = getMonthKey(selectedMonthOffset);
    return monthlyRanges[sym]?.months[key];
  }

  // ── Filtered & sorted ────────────────────────────────────────────────────

  function signalReturn(s: TradingSignal): number {
    if (s.entryPrice <= 0) return 0;
    const dayRet   = Math.abs(s.exitTarget   - s.entryPrice) / s.entryPrice * 100;
    const swingRet = Math.abs(s.swingTarget  - s.entryPrice) / s.entryPrice * 100;
    // HOLD signals have exitTarget === entryPrice, so they naturally sort last
    return Math.max(dayRet, swingRet);
  }

  const displayed = signals
    .filter((s) => filter === 'ALL' || s.signal === filter)
    .sort((a, b) => {
      if (sortBy === 'return') {
        // Non-HOLD first, then by highest return
        const aHold = a.signal === 'HOLD' ? 0 : 1;
        const bHold = b.signal === 'HOLD' ? 0 : 1;
        if (aHold !== bHold) return bHold - aHold;
        return signalReturn(b) - signalReturn(a);
      }
      if (sortBy === 'confidence') return b.confidence - a.confidence;
      if (sortBy === 'score') return Math.abs(b.score) - Math.abs(a.score);
      return a.symbol.localeCompare(b.symbol);
    });

  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'ALL' ? signals.length : signals.filter((s) => s.signal === f).length;
    return acc;
  }, {});

  const buys   = signals.filter((s) => s.signal === 'BUY').length;
  const shorts = signals.filter((s) => s.signal === 'SELL SHORT').length;
  const holds  = signals.filter((s) => s.signal === 'HOLD').length;
  const sentiment =
    buys > shorts + 2 ? 'Bullish' : shorts > buys + 2 ? 'Bearish' : 'Neutral';
  const sentimentColor =
    sentiment === 'Bullish' ? '#3fb950' : sentiment === 'Bearish' ? '#f85149' : '#e3b341';

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="app-title">📈 Portfolio Signal Finder</span>
          <span className="market-status">{marketStatusLabel()}</span>
        </div>
        <div className="topbar-right">
          {activeTab === 'portfolio' && lastUpdated && (
            <>
              <span className="last-updated">Updated {lastUpdated.toLocaleTimeString()}</span>
              {isMarketOpen() && (
                <span className="countdown" title="Next auto-refresh">Next: {countdown}</span>
              )}
            </>
          )}
          {activeTab === 'portfolio' && (
            <button
              className="refresh-btn"
              onClick={() => fetchAndAnalyse(true)}
              disabled={refreshing || loading}
            >
              {refreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
            </button>
          )}
        </div>
      </header>

      {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'portfolio' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('portfolio')}
        >
          📋 My Portfolio
        </button>
        <button
          className={`tab-btn ${activeTab === 'movers' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('movers')}
        >
          🚀 Market Movers
        </button>
        <button
          className={`tab-btn ${activeTab === 'reports' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          📊 Reports
        </button>

        {/* Trade mode toggle lives in the tab bar — applies to both tabs */}
        <div className="tab-bar-mode">
          <span className="trade-mode-label">Mode:</span>
          <button
            className={`trade-mode-btn ${tradeMode === 'DAY' ? 'active-day' : ''}`}
            onClick={() => handleModeChange('DAY')}
          >
            ⚡ Day
          </button>
          <button
            className={`trade-mode-btn ${tradeMode === 'SWING' ? 'active-swing' : ''}`}
            onClick={() => handleModeChange('SWING')}
          >
            🌙 Swing
          </button>
          <button
            className={`trade-mode-btn monthly-btn ${monthlyView ? 'active-monthly' : ''}`}
            onClick={handleMonthlyToggle}
            disabled={monthlyLoading}
            title="Show 1-month price range on each stock card"
          >
            {monthlyLoading ? '⟳ Loading…' : '📅 Monthly'}
          </button>
          <span className="trade-mode-hint">
            {tradeMode === 'DAY'
              ? 'Intraday — tight stops'
              : 'Hold overnight — wider targets'}
          </span>
        </div>
      </nav>

      {/* ── Monthly month navigation bar ─────────────────────────────────── */}
      {monthlyView && (
        <div className="month-nav-bar">
          <button
            className="month-nav-btn"
            onClick={() => setSelectedMonthOffset(o => Math.max(o - 1, -5))}
          >‹ Prev</button>
          <div className="month-nav-center">
            <span className="month-nav-label">{getMonthLabel(selectedMonthOffset)}</span>
            {selectedMonthOffset === 0 && <span className="month-chip month-chip-current">Current</span>}
            {selectedMonthOffset > 0  && <span className="month-chip month-chip-projected">Projected</span>}
            {selectedMonthOffset < 0  && <span className="month-chip month-chip-history">Historical</span>}
          </div>
          <button
            className="month-nav-btn"
            onClick={() => setSelectedMonthOffset(o => Math.min(o + 1, 3))}
          >Next ›</button>
        </div>
      )}

      {/* ── Extended-hours session banner ────────────────────────────────── */}
      {marketSession() === 'pre' && (
        <div className="session-banner session-pre">
          🌅 Pre-Market — 7:00 AM–9:30 AM ET · Lower volume · Wider spreads · Signals are indicative
        </div>
      )}
      {marketSession() === 'after' && (
        <div className="session-banner session-after">
          🌙 After-Hours — 4:00 PM–8:00 PM ET · Lower liquidity · Prices may gap at next open
        </div>
      )}

      {/* ── Review toast (portfolio only) ────────────────────────────────── */}
      {activeTab === 'portfolio' && reviewMsg && (
        <div className="review-toast">{reviewMsg}</div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          PORTFOLIO TAB
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'portfolio' && (
        <>
          {/* ── Summary Bar ──────────────────────────────────────────────── */}
          {!loading && signals.length > 0 && (
            <div className="summary-bar">
              <div className="summary-item">
                <span className="sum-label">Sentiment</span>
                <span className="sum-value" style={{ color: sentimentColor }}>{sentiment}</span>
              </div>
              <div className="summary-item">
                <span className="sum-label">BUY</span>
                <span className="sum-value green">{buys}</span>
              </div>
              <div className="summary-item">
                <span className="sum-label">SHORT</span>
                <span className="sum-value red">{shorts}</span>
              </div>
              <div className="summary-item">
                <span className="sum-label">HOLD</span>
                <span className="sum-value muted">{holds}</span>
              </div>
              <div className="summary-item">
                <span className="sum-label">RSI Avg</span>
                <span className="sum-value">
                  {(signals.reduce((s, x) => s + x.indicators.rsi, 0) / signals.length).toFixed(1)}
                </span>
              </div>
              <div className="summary-item">
                <span className="sum-label">Mode</span>
                <span className="sum-value" style={{ color: tradeMode === 'DAY' ? '#58a6ff' : '#bc8cff' }}>
                  {tradeMode}
                </span>
              </div>
            </div>
          )}

          {/* ── Filter & Sort Bar ─────────────────────────────────────────── */}
          {!loading && (
            <div className="filter-bar">
              <div className="filter-group">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    className={`filter-btn ${filter === f ? 'active' : ''} filter-${f.toLowerCase().replace(/ /g, '-')}`}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                    <span className="filter-count">{counts[f]}</span>
                  </button>
                ))}
              </div>
              <div className="sort-group">
                <label className="sort-label">Sort:</label>
                {(['return', 'symbol', 'confidence', 'score'] as const).map((s) => (
                  <button
                    key={s}
                    className={`sort-btn ${sortBy === s ? 'active' : ''}`}
                    onClick={() => setSortBy(s)}
                  >
                    {s === 'return' ? '📈 Return %' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Stock Grid ────────────────────────────────────────────────── */}
          <main className="main-content">
            {loading ? (
              <div className="loading-screen">
                <div className="spinner" />
                <p>Fetching {SYMBOLS.length} stocks…</p>
              </div>
            ) : displayed.length === 0 ? (
              <p className="empty-msg">No signals match the selected filter.</p>
            ) : (
              <div className="stock-grid">
                {displayed.map((s) => (
                  <StockCard
                    key={s.symbol}
                    signal={s}
                    tradeMode={tradeMode}
                    activeMonth={monthlyView ? getActiveMonth(s.symbol) : undefined}
                  />
                ))}
              </div>
            )}

            {!loading && (
              <ReviewPanel currentParams={params} onParamsUpdated={handleParamsUpdated} />
            )}
          </main>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          MARKET MOVERS TAB
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'movers' && (
        <main className="main-content">
          <GainersLosers tradeMode={tradeMode} />
        </main>
      )}

      {activeTab === 'reports' && (
        <main className="main-content">
          <PredictionReport />
        </main>
      )}

      <footer className="footer">
        Data via Yahoo Finance &amp; Polygon.io · Portfolio refreshes every 10 min · Movers refresh every 15 min ·
        End-of-day review at 7 PM · For educational purposes only — not financial advice.
      </footer>
    </div>
  );
};

export default App;
