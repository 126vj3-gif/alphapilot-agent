import { sma, rsi, atr } from '../src/indicators.js';

/**
 * Deterministic analysis engine for the workbench.
 * EVERY number here is computed by rules from klines — the LLM may only
 * narrate, never invent levels (same principle as the hackathon peers:
 * deterministic core, model writes prose).
 */

const TF_SECONDS = { '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400 };

export function toSec(interval) {
  return TF_SECONDS[interval] || 3600;
}

/** Swing points: fractal with 2 confirm bars on each side. */
export function swings(candles, wing = 2) {
  const highs = [], lows = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: c.high });
    if (isLow) lows.push({ i, price: c.low });
  }
  return { highs, lows };
}

/** Cluster swing levels within max(0.75*ATR, 0.25%); strength = touches. */
export function supportResistance(candles, topN = 6) {
  const closes = candles.map((c) => c.close);
  const a = atr(candles, 14) || closes[closes.length - 1] * 0.005;
  const tol = Math.max(a * 0.75, closes[closes.length - 1] * 0.0025);
  const { highs, lows } = swings(candles);
  const all = [
    ...highs.map((h) => ({ price: h.price, kind: 'R', i: h.i })),
    ...lows.map((l) => ({ price: l.price, kind: 'S', i: l.i })),
  ].sort((x, y) => x.i - y.i);

  const clusters = [];
  for (const lvl of all) {
    const c = clusters.find((cl) => Math.abs(cl.price - lvl.price) <= tol);
    if (c) {
      c.touches += 1;
      c.lastIdx = Math.max(c.lastIdx, lvl.i);
      c.price = (c.price * (c.touches - 1) + lvl.price) / c.touches;
      if (lvl.kind === 'R') c.kinds.R = true; else c.kinds.S = true;
    } else {
      clusters.push({ price: lvl.price, touches: 1, lastIdx: lvl.i, kinds: { [lvl.kind]: true } });
    }
  }
  const n = closes.length;
  return clusters
    .map((c) => ({
      price: Number(c.price.toFixed(2)),
      kind: c.kinds.R && !c.kinds.S ? 'R' : c.kinds.S && !c.kinds.R ? 'S' : 'SR',
      touches: c.touches,
      recency: Number(((c.lastIdx + 1) / n).toFixed(3)),
      distPct: Number((((c.price - closes[n - 1]) / closes[n - 1]) * 100).toFixed(2)),
    }))
    .sort((x, y) => (y.touches * 0.6 + y.recency * 0.4) - (x.touches * 0.6 + x.recency * 0.4))
    .slice(0, topN);
}

/** Fibonacci retracement of the most recent significant swing. */
export function fibonacci(candles) {
  const { highs, lows } = swings(candles, 3);
  const lastH = highs[highs.length - 1];
  const lastL = lows[lows.length - 1];
  if (!lastH || !lastL) return null;
  let hi, lo, dir;
  if (lastH.i > lastL.i) { hi = lastH.price; lo = lastL.price; dir = 'up'; }
  else { hi = lastH.price; lo = lastL.price; dir = 'down'; }
  const range = hi - lo;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786].map((r) => ({
    ratio: r,
    price: Number((dir === 'up' ? hi - range * r : lo + range * r).toFixed(2)),
  }));
  const ext = 1.272;
  levels.push({
    ratio: ext,
    price: Number((dir === 'up' ? lo + range * ext : hi - range * ext).toFixed(2)),
  });
  return { swingHigh: hi, swingLow: lo, direction: dir, levels };
}

/** Trend classification for one timeframe. */
export function trendOf(candles) {
  const closes = candles.map((c) => c.close);
  const f = sma(closes, 20);
  const s = sma(closes, 50);
  const n = closes.length - 1;
  if (f[n] == null || s[n] == null) return { label: '数据不足', score: 0 };
  const slope = s[n] - s[n - 1];
  const above = closes[n] > s[n];
  let label = '震荡', score = 0;
  if (f[n] > s[n] && slope > 0) { label = '多头'; score = above ? 1 : 0.5; }
  else if (f[n] < s[n] && slope < 0) { label = '空头'; score = above ? -0.5 : -1; }
  return {
    label,
    score,
    sma20: Number(f[n].toFixed(2)),
    sma50: Number(s[n].toFixed(2)),
    close: Number(closes[n].toFixed(2)),
  };
}

/**
 * Full deterministic analysis: structure, indicators, S/R, Fib,
 * multi-timeframe resonance, observation plan.
 */
export function analyzeSymbol(baseCandles, mtfCandles, signal) {
  const closes = baseCandles.map((c) => c.close);
  const n = closes.length - 1;
  const price = closes[n];
  const r = rsi(closes, 14)[n];
  const a = atr(baseCandles, 14);
  const tr = trendOf(baseCandles);

  const sr = supportResistance(baseCandles);
  const fib = fibonacci(baseCandles);
  const nearestR = sr.filter((l) => l.price > price).sort((x, y) => x.price - y.price)[0];
  const nearestS = sr.filter((l) => l.price < price).sort((x, y) => y.price - x.price)[0];

  const mtf = Object.entries(mtfCandles).map(([tf, c]) => ({ tf, ...trendOf(c) }));
  const resonance = mtf.reduce((s, m) => s + m.score, 0);

  // Observation plan — derived from structure, never invented.
  const swingPts = swings(baseCandles, 3);
  const recentLow = swingPts.lows.length ? Math.max(...swingPts.lows.slice(-3).map((l) => l.price)) : price * (1 - 2 * a);
  const recentHigh = swingPts.highs.length ? Math.min(...swingPts.highs.slice(-3).map((h) => h.price)) : price * (1 + 2 * a);
  let plan;
  if (resonance > 0.5) {
    plan = {
      bias: '偏多观察',
      zone: [Number((price - a).toFixed(2)), Number(price.toFixed(2))],
      breakout: nearestR ? nearestR.price : Number(recentHigh.toFixed(2)),
      invalid: Number((recentLow - 0.5 * a).toFixed(2)),
      target: fib && fib.direction === 'up'
        ? fib.levels.find((l) => l.ratio === 1.272)?.price
        : Number((price + 2 * a).toFixed(2)),
    };
  } else if (resonance < -0.5) {
    plan = {
      bias: '偏空观察',
      zone: [Number(price.toFixed(2)), Number((price + a).toFixed(2))],
      breakdown: nearestS ? nearestS.price : Number(recentLow.toFixed(2)),
      invalid: Number((recentHigh + 0.5 * a).toFixed(2)),
      target: fib && fib.direction === 'down'
        ? fib.levels.find((l) => l.ratio === 1.272)?.price
        : Number((price - 2 * a).toFixed(2)),
    };
  } else {
    plan = {
      bias: '区间观望',
      range: [nearestS ? nearestS.price : Number((price - a).toFixed(2)), nearestR ? nearestR.price : Number((price + a).toFixed(2))],
      note: '多空周期未共振，等待区间边界的选择性突破',
    };
  }

  return {
    price: Number(price.toFixed(2)),
    structure: {
      trend: tr.label,
      sma20: tr.sma20,
      sma50: tr.sma50,
      closeAboveSma50: above50(tr, price),
      atr14: a ? Number(a.toFixed(2)) : null,
      rsi14: r != null ? Number(r.toFixed(1)) : null,
      rsiZone: r == null ? '' : r > 70 ? '超买' : r < 30 ? '超卖' : '中性',
    },
    resonance: {
      score: Number(resonance.toFixed(2)),
      verdict: resonance > 0.5 ? '多头共振' : resonance < -0.5 ? '空头共振' : '无共振',
      timeframes: mtf.map((m) => ({ tf: m.tf, label: m.label, score: m.score, sma20: m.sma20, sma50: m.sma50 })),
    },
    signal: signal ? { action: signal.action, confidence: Number((signal.confidence ?? 0).toFixed(2)), reason: signal.reason } : null,
    levels: { supportResistance: sr, fib },
    plan,
    generatedAt: new Date().toISOString(),
  };
}

function above50(tr, price) {
  return tr.sma50 != null ? price > tr.sma50 : null;
}
