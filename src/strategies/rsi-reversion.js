import { rsi } from '../indicators.js';

/**
 * Mean reversion on RSI extremes with a volatility floor: only fades
 * oversold/overbought readings when the market is not in a strong trend
 * (shallow SMA50 slope), which is where mean reversion actually works.
 */
export const id = 'rsi-reversion';
export const name = 'RSI Mean Reversion';
export const warmup = 70;

export function evaluate(candles) {
  const closes = candles.map((c) => c.close);
  const i = closes.length - 1;
  const rsiSeries = rsi(closes, 14);
  const value = rsiSeries[i];
  if (value == null) return { action: 'HOLD', confidence: 0, reason: 'warming up' };

  // Regime filter: distance of price from SMA50 as trend proxy.
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
  const trendStrength = Math.abs((closes[i] - sma50) / sma50);

  if (value <= 30 && trendStrength < 0.08) {
    return {
      action: 'BUY',
      confidence: Math.min(1, (30 - value) / 15 + 0.4),
      reason: `RSI ${value.toFixed(1)} oversold, weak trend (${(trendStrength * 100).toFixed(2)}% from SMA50) → fade the dip`,
    };
  }
  if (value >= 70 && trendStrength < 0.08) {
    return {
      action: 'SELL',
      confidence: Math.min(1, (value - 70) / 15 + 0.4),
      reason: `RSI ${value.toFixed(1)} overbought, weak trend (${(trendStrength * 100).toFixed(2)}% from SMA50) → fade the spike`,
    };
  }
  return {
    action: 'HOLD',
    confidence: 0,
    reason: `RSI ${value.toFixed(1)} neutral`,
  };
}
