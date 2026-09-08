import * as smaCross from './sma-cross.js';
import * as rsiReversion from './rsi-reversion.js';

/** Base strategies the ensemble votes on (ensemble itself excluded). */
const baseStrategies = [smaCross, rsiReversion];

/** Strategy registry. A strategy = { id, name, warmup, evaluate(candles) }. */
export const strategies = new Map([
  [smaCross.id, smaCross],
  [rsiReversion.id, rsiReversion],
]);

/**
 * Ensemble strategy: run every base strategy and aggregate their votes,
 * weighted by confidence. A trade only fires when total score passes the
 * threshold AND votes agree — one strong dissenting vote can veto.
 */
export const ensemble = {
  id: 'ensemble',
  name: 'Ensemble (SMA cross + RSI reversion)',
  warmup: Math.max(...baseStrategies.map((s) => s.warmup)),
  evaluate(candles) {
    const votes = baseStrategies.map((s) => ({
      id: s.id,
      ...s.evaluate(candles),
    }));

    let score = 0;
    let buyVotes = 0, sellVotes = 0;
    for (const v of votes) {
      const dir = v.action === 'BUY' ? 1 : v.action === 'SELL' ? -1 : 0;
      score += dir * v.confidence;
      if (dir > 0) buyVotes++;
      if (dir < 0) sellVotes++;
    }

    const reasons = votes.map((v) => `[${v.id}] ${v.action} (${v.confidence.toFixed(2)}) ${v.reason}`).join(' | ');
    const THRESHOLD = 0.5;

    if (score >= THRESHOLD && sellVotes === 0) {
      return { action: 'BUY', confidence: Math.min(1, score), reason: reasons, votes };
    }
    if (score <= -THRESHOLD && buyVotes === 0) {
      return { action: 'SELL', confidence: Math.min(1, -score), reason: reasons, votes };
    }
    return { action: 'HOLD', confidence: 0, reason: reasons, votes };
  },
};
strategies.set(ensemble.id, ensemble);

export function getStrategy(id) {
  const s = strategies.get(id);
  if (!s) throw new Error(`Unknown strategy "${id}". Available: ${[...strategies.keys()].join(', ')}`);
  return s;
}
