require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = 7001;

app.use(cors());
app.use(express.json());

const POLYGON_KEY = process.env.POLYGON_API_KEY || '';

// ─── Shared headers for Yahoo Finance chart API ────────────────────────────────

const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com',
};

// ─── Stock chart proxy (Yahoo Finance v8) ─────────────────────────────────────

app.get('/api/stock/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '5m', range = '1d' } = req.query;
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      {
        params: { interval, range, includePrePost: true, events: 'div,splits' },
        headers: YF_HEADERS,
        timeout: 15000,
      }
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    console.error(`[${symbol}] Error:`, error.message);
    res.status(status).json({ error: error.message, symbol });
  }
});

// ─── Batch stock chart proxy ───────────────────────────────────────────────────

app.post('/api/stocks/batch', async (req, res) => {
  const { symbols, interval = '5m', range = '1d' } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: 'symbols array required' });
  }
  const results = {};
  for (const symbol of symbols) {
    try {
      const response = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        {
          params: { interval, range, includePrePost: true },
          headers: YF_HEADERS,
          timeout: 15000,
        }
      );
      results[symbol] = { success: true, data: response.data };
    } catch (err) {
      results[symbol] = { success: false, error: err.message };
    }
    await new Promise((r) => setTimeout(r, 200)); // be polite
  }
  res.json(results);
});

// ─── Market Movers via Yahoo Finance quote API ────────────────────────────────
// Scans a curated universe of ~180 liquid US stocks, picks top 10 gainers/losers.
// No external API key required — uses the same Yahoo Finance proxy we already have.

const SCAN_UNIVERSE = [
  // Mega caps
  'AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','BRK-B','UNH','LLY','EXAS',
  // Large cap tech
  'AMD','INTC','AVGO','QCOM','TXN','ORCL','IBM','CRM','ADBE','NOW',
  'NFLX','UBER','LYFT','SNAP','PINS','SPOT','RBLX','U','DDOG','NET',
  'CRWD','OKTA','ZS','SNOW','MDB','PLTR','AFRM','SOFI','UPST','SQ','PYPL',
  // Finance
  'JPM','BAC','GS','MS','C','WFC','AXP','BX','KKR','V','MA',
  // Healthcare / Biotech
  'JNJ','PFE','MRK','ABBV','AMGN','GILD','BIIB','REGN','VRTX','BMY',
  'MRNA','BNTX','NVAX','INO','AGEN','NVCR','ADMA','ABVX','CELC','QURE',
  // Consumer / Retail
  'WMT','HD','COST','TGT','AMZN','MCD','SBUX','NKE','PG','KO','PEP',
  // Energy
  'XOM','CVX','SLB','HAL','DVN','MPC','VLO','OXY',
  // EV / Auto
  'TSLA','NIO','XPEV','LI','RIVN','LCID','F','GM',
  // Crypto / Blockchain
  'COIN','MSTR','MARA','RIOT','CLSK','HUT','BTBT','CIFR','CORZ','IREN',
  // ETFs (often used as market indicators)
  'SPY','QQQ','IWM','UVXY','SQQQ','TQQQ',
  // Popular volatile / meme
  'GME','AMC','BB','BBBY','NOK','SNDL','MULN','FFIE',
  // Semiconductors
  'MU','LRCX','KLAC','AMAT','ASML','TSM','SMCI',
  // Travel / Leisure
  'ABNB','BKNG','EXPE','CCL','RCL','DAL','UAL','AAL','LUV',
  // Media / Streaming
  'DIS','PARA','WBD','NFLX','T','VZ','CMCSA',
  // User portfolio stocks
  'AAP','CNC','CONI','DAVE','FIVN','GLUE','LUMN','LWAY','MGPI','NNNN',
  'NVDL','ODD','PEGA','RXO','SERV','SOGP','TIL', 'TLS','TREE','WLDN','ZEPP',
];

// ── Build the scan list: merge SCAN_UNIVERSE with optional stocks.csv ──────────
// Drop a stocks.csv file in the project root (one ticker per line or comma-separated)
// to add your own symbols. They are merged with the built-in list automatically.
function buildScanList() {
  const csvPath = path.join(__dirname, 'stocks.csv');
  let extra = [];
  if (fs.existsSync(csvPath)) {
    try {
      const raw = fs.readFileSync(csvPath, 'utf8');
      extra = raw.split(/[\r\n,]+/).map(s => s.trim().toUpperCase()).filter(s => s && !s.startsWith('#'));
      console.log(`[market-movers] Loaded ${extra.length} extra symbols from stocks.csv`);
    } catch (e) {
      console.warn('[market-movers] Could not read stocks.csv:', e.message);
    }
  }
  return [...new Set([...SCAN_UNIVERSE, ...extra])];
}

// ── Fetch one stock quote using the chart API (v8 — no crumb needed) ──────────
async function fetchQuickQuote(symbol) {
  try {
    const { data } = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      {
        params: { interval: '1d', range: '5d', includePrePost: true },
        headers: YF_HEADERS,
        timeout: 8000,
      }
    );
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta  = result.meta;
    const price = meta.regularMarketPrice ?? 0;
    const prev  = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    if (price <= 0 || prev <= 0) return null;
    return {
      symbol,
      name:          meta.longName || meta.shortName || symbol,
      changePercent: parseFloat(((price - prev) / prev * 100).toFixed(2)),
      price:         parseFloat(price.toFixed(2)),
    };
  } catch {
    return null; // skip failed symbols silently
  }
}

// GET /api/market-movers?limit=10
// Returns { gainers: MoverInfo[], losers: MoverInfo[], scanned: number }
app.get('/api/market-movers', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10'), 50);
  try {
    const scanList = buildScanList();

    // Fetch all in parallel — Yahoo v8/chart handles concurrent requests well
    const results = await Promise.all(scanList.map(fetchQuickQuote));
    const allQuotes = results.filter(Boolean);

    if (allQuotes.length === 0) {
      return res.status(503).json({ error: 'No quotes returned from Yahoo Finance — market may be closed' });
    }

    const sorted  = [...allQuotes].sort((a, b) => b.changePercent - a.changePercent);
    const gainers = sorted.slice(0, limit);
    const losers  = sorted.slice(-limit).reverse();

    console.log(`[market-movers] Scanned ${allQuotes.length}/${scanList.length}. Top: ${gainers[0]?.symbol} ${gainers[0]?.changePercent}%`);
    res.json({ gainers, losers, scanned: allQuotes.length });
  } catch (err) {
    console.error('[market-movers] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Legacy Polygon movers (kept as fallback) ──────────────────────────────────
app.get('/api/movers/:type', async (req, res) => {
  const { type } = req.params;
  if (!POLYGON_KEY) return res.status(500).json({ error: 'POLYGON_API_KEY not set' });
  try {
    const { data } = await axios.get(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/${type}`,
      { params: { include_otc: false, apiKey: POLYGON_KEY }, timeout: 12000 }
    );
    const tickers = Array.isArray(data.tickers) ? data.tickers : [];
    res.json(tickers.slice(0, 20).map(t => ({
      symbol: t.ticker, name: t.ticker,
      changePercent: parseFloat((t.todaysChangePerc ?? 0).toFixed(2)),
      price: parseFloat((t.day?.c ?? t.lastTrade?.p ?? 0).toFixed(2)),
    })));
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ─── Extended-hours snapshot: batch Polygon snapshot for a ticker list ────────
// POST /api/extended-snapshot  { tickers: string[] }
// Returns raw Polygon ticker snapshots so the client can compute pre/AH change.

app.post('/api/extended-snapshot', async (req, res) => {
  const { tickers } = req.body;
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'tickers array required' });
  }
  if (!POLYGON_KEY) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not set in .env' });
  }

  try {
    // Polygon accepts comma-separated tickers; cap at 250 per call
    const chunk = tickers.slice(0, 250).join(',');
    const { data } = await axios.get(
      'https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers',
      {
        params: { tickers: chunk, include_otc: false, apiKey: POLYGON_KEY },
        timeout: 20000,
      }
    );
    res.json(data.tickers ?? []);
  } catch (err) {
    console.error('[extended-snapshot] Error:', err.response?.status, err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ─── Daily predictions storage (saved to predictions.json) ───────────────────
// Both tabs save their signals here; the 7 PM review reads this file.

const PREDICTIONS_FILE   = path.join(__dirname, 'predictions.json');
const RANGE_REVIEWS_FILE = path.join(__dirname, 'range_reviews.json');

function readPredictions() {
  try {
    return fs.existsSync(PREDICTIONS_FILE)
      ? JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf8'))
      : [];
  } catch { return []; }
}

function readRangeReviews() {
  try {
    return fs.existsSync(RANGE_REVIEWS_FILE)
      ? JSON.parse(fs.readFileSync(RANGE_REVIEWS_FILE, 'utf8'))
      : [];
  } catch { return []; }
}

// POST /api/predictions/save
// Body: { tab, date, predictions: [{ symbol, signal, entryPrice, dayTarget, dayStop, swingTarget, swingStop }] }
// Uses first-wins per symbol: once a non-HOLD signal is recorded it is never overwritten.
// HOLD signals can be upgraded to a non-HOLD on a later refresh.
app.post('/api/predictions/save', (req, res) => {
  const { tab, date, predictions } = req.body;
  if (!tab || !date || !Array.isArray(predictions)) {
    return res.status(400).json({ error: 'tab, date, and predictions[] required' });
  }
  let all = readPredictions();
  const existingIdx = all.findIndex(r => r.tab === tab && r.date === date);

  if (existingIdx === -1) {
    // First save of the day — store everything as-is
    all.push({ tab, date, savedAt: new Date().toISOString(), predictions });
  } else {
    // Merge: keep first non-HOLD per symbol; upgrade HOLD → non-HOLD if a signal appears later
    const existing = all[existingIdx];
    const existingMap = new Map(existing.predictions.map(p => [p.symbol, p]));
    for (const pred of predictions) {
      const prev = existingMap.get(pred.symbol);
      if (!prev) {
        existingMap.set(pred.symbol, pred);                          // new symbol
      } else if (prev.signal === 'HOLD' && pred.signal !== 'HOLD') {
        existingMap.set(pred.symbol, pred);                          // HOLD → actionable
      }
      // else: keep the first non-HOLD signal (first-wins)
    }
    all[existingIdx] = { ...existing, predictions: Array.from(existingMap.values()) };
  }

  all = all.slice(-30);
  try {
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(all, null, 2));
    res.json({ ok: true, saved: predictions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/predictions/review  { tab, date }
// Fetches current prices, compares predicted ranges vs actual, saves to range_reviews.json
app.post('/api/predictions/review', async (req, res) => {
  const { tab, date } = req.body;
  if (!tab || !date) return res.status(400).json({ error: 'tab and date required' });

  const all = readPredictions();
  const entry = all.find(r => r.tab === tab && r.date === date);
  if (!entry || !entry.predictions.length) {
    return res.json({ ok: true, message: 'No predictions for this date', results: [] });
  }

  const results = [];
  for (const pred of entry.predictions.filter(p => p.signal !== 'HOLD')) {
    try {
      const { data } = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pred.symbol)}`,
        { params: { interval: '1d', range: '1d', includePrePost: false }, headers: YF_HEADERS, timeout: 8000 }
      );
      const meta = data.chart?.result?.[0]?.meta;
      if (!meta) { results.push({ ...pred, actualPrice: null, outcome: 'no-data' }); continue; }

      const actualPrice = meta.regularMarketPrice ?? 0;
      const isLong  = pred.signal === 'BUY' || pred.signal === 'BUY TO COVER';
      const isShort = pred.signal === 'SELL SHORT' || pred.signal === 'SELL';

      const priceDiff  = actualPrice - pred.entryPrice;
      const dirCorrect = (isLong && priceDiff > 0) || (isShort && priceDiff < 0);

      const totalRange = Math.abs(pred.dayTarget - pred.entryPrice);
      const actualMove = isLong ? Math.max(0, actualPrice - pred.entryPrice)
                                : Math.max(0, pred.entryPrice - actualPrice);
      const rangeHitPct = totalRange > 0 ? parseFloat(((actualMove / totalRange) * 100).toFixed(1)) : 0;

      const swingRange  = Math.abs(pred.swingTarget - pred.entryPrice);
      const swingHitPct = swingRange > 0 ? parseFloat(((actualMove / swingRange) * 100).toFixed(1)) : 0;

      results.push({
        symbol: pred.symbol, signal: pred.signal,
        entryPrice: pred.entryPrice, dayTarget: pred.dayTarget, dayStop: pred.dayStop,
        swingTarget: pred.swingTarget, swingStop: pred.swingStop,
        actualPrice, dirCorrect, rangeHitPct, swingHitPct,
        outcome: dirCorrect ? (rangeHitPct >= 100 ? 'target-hit' : 'correct-dir') : 'wrong-dir',
      });
      await new Promise(r => setTimeout(r, 80));
    } catch {
      results.push({ ...pred, actualPrice: null, outcome: 'error' });
    }
  }

  const scored   = results.filter(r => r.outcome !== 'no-data' && r.outcome !== 'error');
  const correct  = scored.filter(r => r.dirCorrect).length;
  const winRate  = scored.length > 0 ? correct / scored.length : 0;
  const avgRange = scored.length > 0
    ? parseFloat((scored.reduce((s, r) => s + (r.rangeHitPct ?? 0), 0) / scored.length).toFixed(1))
    : 0;

  const review = {
    tab, date, reviewedAt: new Date().toISOString(),
    total: scored.length, correct, winRate, avgRangeHitPct: avgRange, results,
    summary: `${correct}/${scored.length} correct (${(winRate*100).toFixed(0)}%) · avg range hit ${avgRange}%`,
  };

  let reviews = readRangeReviews();
  reviews = reviews.filter(r => !(r.tab === tab && r.date === date));
  reviews.push(review);
  reviews = reviews.slice(-30);
  try { fs.writeFileSync(RANGE_REVIEWS_FILE, JSON.stringify(reviews, null, 2)); } catch { /* non-fatal */ }

  console.log(`[7PM review][${tab}] ${review.summary}`);
  res.json(review);
});

// GET /api/predictions/review-history?tab=portfolio|movers
app.get('/api/predictions/review-history', (req, res) => {
  const { tab } = req.query;
  const all = readRangeReviews();
  res.json(tab ? all.filter(r => r.tab === tab) : all);
});

// ─── Nightly review history (saved to mover_reviews.json) ────────────────────

const REVIEW_FILE = path.join(__dirname, 'mover_reviews.json');

function readReviews() {
  try {
    return fs.existsSync(REVIEW_FILE)
      ? JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8'))
      : [];
  } catch { return []; }
}

// POST /api/review  { date, correct, total, winRate, tuningSummary }
app.post('/api/review', (req, res) => {
  const record = req.body;
  if (!record || !record.date) {
    return res.status(400).json({ error: 'date required' });
  }
  let history = readReviews();
  history = history.filter(r => r.date !== record.date); // replace same-day entry
  history.push({ ...record, savedAt: new Date().toISOString() });
  history = history.slice(-30); // keep last 30 days
  try {
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(history, null, 2));
    console.log(`[review] Saved ${record.date}: ${record.correct}/${record.total} (${(record.winRate * 100).toFixed(0)}%)`);
    res.json({ ok: true, total: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/review/history  → array of ReviewRecord sorted oldest first
app.get('/api/review/history', (_req, res) => {
  res.json(readReviews());
});

// ─── Prediction CSV export ────────────────────────────────────────────────────
// GET /api/predictions/export/csv?tab=portfolio|movers|all&from=YYYY-MM-DD&to=YYYY-MM-DD
// Downloads all stored predictions joined with their review outcomes as a CSV.

app.get('/api/predictions/export/csv', (req, res) => {
  const { tab, from, to } = req.query;
  const allPreds   = readPredictions();
  const allReviews = readRangeReviews();

  // Build lookup: tab+date → outcome map keyed by symbol
  const reviewMap = {};
  for (const rv of allReviews) {
    const key = `${rv.tab}__${rv.date}`;
    reviewMap[key] = {};
    for (const r of (rv.results || [])) {
      reviewMap[key][r.symbol] = r;
    }
  }

  // Flatten predictions into rows
  const rows = [];
  for (const entry of allPreds) {
    if (tab && tab !== 'all' && entry.tab !== tab) continue;
    if (from && entry.date < from) continue;
    if (to   && entry.date > to)   continue;
    const rvKey = `${entry.tab}__${entry.date}`;
    for (const p of (entry.predictions || [])) {
      const rv = (reviewMap[rvKey] || {})[p.symbol] || {};
      rows.push({
        Date:            entry.date,
        Source:          entry.tab === 'movers' ? 'Market Movers' : 'Portfolio',
        Symbol:          p.symbol,
        Signal:          p.signal,
        EntryPrice:      p.entryPrice  != null ? p.entryPrice.toFixed(2)  : '',
        DayTarget:       p.dayTarget   != null ? p.dayTarget.toFixed(2)   : '',
        DayStop:         p.dayStop     != null ? p.dayStop.toFixed(2)     : '',
        SwingTarget:     p.swingTarget != null ? p.swingTarget.toFixed(2) : '',
        SwingStop:       p.swingStop   != null ? p.swingStop.toFixed(2)   : '',
        ActualClose:     rv.actualPrice != null ? rv.actualPrice.toFixed(2) : 'Pending',
        DirCorrect:      rv.dirCorrect  != null ? (rv.dirCorrect ? 'YES' : 'NO') : 'Pending',
        Outcome:         rv.outcome     || 'Pending',
        DayRangeHit_pct: rv.rangeHitPct != null ? rv.rangeHitPct : '',
        SwingRangeHit_pct: rv.swingHitPct != null ? rv.swingHitPct : '',
        PnL_pct:         rv.actualPrice != null && p.entryPrice > 0
          ? (() => {
              const isLong = p.signal === 'BUY' || p.signal === 'BUY TO COVER';
              const isShort = p.signal === 'SELL SHORT' || p.signal === 'SELL';
              if (isLong)  return (((rv.actualPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2);
              if (isShort) return (((p.entryPrice - rv.actualPrice) / p.entryPrice) * 100).toFixed(2);
              return '0.00';
            })()
          : '',
      });
    }
  }

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No prediction data found for the requested range.' });
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = String(row[h] ?? '');
        return v.includes(',') ? `"${v}"` : v;
      }).join(',')
    ),
  ];

  const filename = `predictions_${tab || 'all'}_${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvLines.join('\r\n'));
});

// ─── Prediction accuracy report ───────────────────────────────────────────────
// GET /api/predictions/report?weeks=4
// Returns per-week + per-signal + per-source stats for the dashboard.

app.get('/api/predictions/report', (req, res) => {
  const weeks = parseInt(req.query.weeks || '4', 10);
  const allReviews = readRangeReviews();
  const allPreds   = readPredictions();

  // Build per-day predictions lookup for HOLD vs non-HOLD counts
  const predMap = {};
  for (const entry of allPreds) {
    predMap[`${entry.tab}__${entry.date}`] = entry.predictions || [];
  }

  // Helper: ISO week string from date string "YYYY-MM-DD"
  function getWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const thu = new Date(d);
    thu.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)));
    const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
    const wk = Math.ceil((((thu - yearStart) / 86400000) + 1) / 7);
    return `${thu.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
  }

  // Cutoff: last N weeks
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const weeklyMap   = {}; // week → { total, correct, targetHit, pnlSum, pnlCount }
  const signalMap   = {}; // signal → same
  const sourceMap   = {}; // tab → same
  const symbolMap   = {}; // symbol → same
  const dailyRows   = []; // one row per day per tab

  for (const rv of allReviews) {
    if (rv.date < cutoffStr) continue;
    const week  = getWeek(rv.date);
    const preds = predMap[`${rv.tab}__${rv.date}`] || [];
    const holds = preds.filter(p => p.signal === 'HOLD').length;

    const row = {
      date:        rv.date,
      week,
      source:      rv.tab === 'movers' ? 'Market Movers' : 'Portfolio',
      total:       rv.total,
      correct:     rv.correct,
      winRate:     rv.winRate,
      avgRangeHit: rv.avgRangeHitPct,
      holds,
      targetHits:  (rv.results || []).filter(r => r.outcome === 'target-hit').length,
    };
    dailyRows.push(row);

    // Aggregate into weekly / signal / source buckets
    for (const bucket of [
      [weeklyMap, week],
      [sourceMap, rv.tab],
    ]) {
      const [map, key] = bucket;
      if (!map[key]) map[key] = { total: 0, correct: 0, targetHit: 0, pnlSum: 0, pnlCount: 0 };
      map[key].total     += rv.total;
      map[key].correct   += rv.correct;
      map[key].targetHit += row.targetHits;
    }

    // Per-signal breakdown
    for (const r of (rv.results || [])) {
      if (!r.signal) continue;
      if (!signalMap[r.signal]) signalMap[r.signal] = { total: 0, correct: 0, targetHit: 0 };
      signalMap[r.signal].total++;
      if (r.dirCorrect)             signalMap[r.signal].correct++;
      if (r.outcome === 'target-hit') signalMap[r.signal].targetHit++;

      // Per-symbol breakdown
      if (!symbolMap[r.symbol]) symbolMap[r.symbol] = { total: 0, correct: 0, targetHit: 0, signals: {} };
      symbolMap[r.symbol].total++;
      if (r.dirCorrect)               symbolMap[r.symbol].correct++;
      if (r.outcome === 'target-hit') symbolMap[r.symbol].targetHit++;
      symbolMap[r.symbol].signals[r.signal] = (symbolMap[r.symbol].signals[r.signal] || 0) + 1;
    }
  }

  // Finalise win-rates
  const finalize = (map) => Object.entries(map).map(([key, v]) => ({
    key, ...v,
    winRate: v.total > 0 ? parseFloat((v.correct / v.total * 100).toFixed(1)) : 0,
    targetHitRate: v.total > 0 ? parseFloat((v.targetHit / v.total * 100).toFixed(1)) : 0,
  }));

  const symbolStats = Object.entries(symbolMap).map(([symbol, v]) => ({
    symbol, ...v,
    winRate: v.total > 0 ? parseFloat((v.correct / v.total * 100).toFixed(1)) : 0,
    targetHitRate: v.total > 0 ? parseFloat((v.targetHit / v.total * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.total - a.total);

  res.json({
    generatedAt: new Date().toISOString(),
    weeksBack: weeks,
    weekly:  finalize(weeklyMap).sort((a, b) => a.key.localeCompare(b.key)),
    bySignal: finalize(signalMap),
    bySource: finalize(sourceMap),
    bySymbol: symbolStats.slice(0, 30),
    daily:    dailyRows.sort((a, b) => b.date.localeCompare(a.date)),
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    polygon: POLYGON_KEY ? 'configured' : 'MISSING — set POLYGON_API_KEY in .env',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ Stock proxy server running at http://localhost:${PORT}`);
  if (!POLYGON_KEY) {
    console.warn('⚠  POLYGON_API_KEY not found in .env — Market Movers will not work');
  } else {
    console.log('   Polygon.io API key loaded ✓');
  }
  console.log('   Press Ctrl+C to stop\n');
});
