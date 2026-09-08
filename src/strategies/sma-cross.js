import { sma, rsi, pctChange } from '../indicators.js';

/**
 * Trend-following: fast SMA crossing slow SMA.
 * BUY on golden cross, SELL on death cross — filtered by slope so we do not
 * trade sideways chop.
 */
export const id = 'sma-cross';
export const name = 'SMA Crossover (trend following)';
export const warmup = 60;

export function evaluate(candles) {
  const closes = candles.map((c) => c.close);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  const i = closes.length - 1;
  if (i < 1 || fast[i] == null || slow[i] == null || fast[i - 1] == null) {
    return { action: 'HOLD', confidence: 0, reason: 'warming up' };
  }

  const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
  const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
  const slope = pctChange(slow[i - 1] || slow[i], slow[i]);

  if (crossUp && slope > 0) {
    return {
      action: 'BUY',
      confidence: Math.min(1, 0.6 + Math.abs(slope) * 50),
      reason: `golden cross: SMA20 ${fast[i].toFixed(2)} > SMA50 ${slow[i].toFixed(2)}, trend slope +${(slope * 100).toFixed(3)}%`,
    };
  }
  if (crossDown && slope < 0) {
    return {
      action: 'SELL',
      confidence: Math.min(1, 0.6 + Math.abs(slope) * 50),
      reason: `death cross: SMA20 ${fast[i].toFixed(2)} < SMA50 ${slow[i].toFixed(2)}, trend slope ${(slope * 100).toFixed(3)}%`,
    };
  }
  return {
    action: 'HOLD',
    confidence: 0,
    reason: `no cross (SMA20 ${fast[i].toFixed(2)} vs SMA50 ${slow[i].toFixed(2)})`,
  };
}
