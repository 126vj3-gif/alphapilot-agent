import { getStrategy } from './strategies/index.js';
import { MarketData } from './market.js';

/**
 * Event-driven backtester. Replays historical klines through the SAME
 * strategy + risk code used live (dry-run fills at candle close), so
 * backtest behaviour and live behaviour cannot drift apart.
 */
export async function backtest({ cfg, days = 90, initialQuote = 10_000 }) {
  const strategy = getStrategy(cfg.strategy);
  const market = new MarketData(cfg);

  // Klines needed: enough history that the strategy is warm from bar #1.
  const perDay = { '15m': 96, '30m': 48, '1h': 24, '2h': 12, '4h': 6, '1d': 1 }[cfg.interval] ?? 24;
  const bars = Math.min(1000, perDay * days);
  const candles = await market.klines(cfg.symbol, cfg.interval, bars);

  const r = cfg.risk;
  let quote = initialQuote;
  let position = null;
  let trades = 0;
  let cooldownUntil = 0;
  let peakEquity = initialQuote;
  let maxDrawdown = 0;
  const fills = [];

  const equityAt = (price) => (position ? quote + position.qty * price : quote);

  for (let i = strategy.warmup; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1); // strategy sees the past only
    const price = candles[i].close;
    const time = candles[i].closeTime;

    // 1 ─ exit management on the open position
    if (position) {
      let exit = null;
      if (price <= position.stopLoss) exit = 'EXIT_STOP';
      else if (price >= position.takeProfit) exit = 'EXIT_TARGET';
      if (exit) {
        const proceeds = position.qty * price;
        const pnl = proceeds - position.qty * position.entryPrice;
        quote += proceeds;
        fills.push({ time, side: 'SELL', price, pnl: Number(pnl.toFixed(2)), reason: exit });
        position = null;
        trades++;
        cooldownUntil = time + r.cooldownMin * 60_000;
      }
    }

    // 2 ─ strategy signal
    const signal = strategy.evaluate(slice);

    // 3 ─ entry (spot long-only)
    if (signal.action === 'BUY' && !position && time >= cooldownUntil) {
      const scale = 0.5 + 0.5 * Math.min(1, Math.max(0, signal.confidence));
      const qty = (quote * r.maxPositionPct * scale) / price;
      if (qty * price >= r.minQuoteNotional) {
        position = {
          qty,
          entryPrice: price,
          stopLoss: price * (1 - r.stopLossPct),
          takeProfit: price * (1 + r.takeProfitPct),
        };
        quote -= qty * price;
        fills.push({ time, side: 'BUY', price, quoteQty: Number((qty * price).toFixed(2)), confidence: Number(signal.confidence.toFixed(2)) });
        trades++;
      }
    } else if (signal.action === 'SELL' && position) {
      const proceeds = position.qty * price;
      const pnl = proceeds - position.qty * position.entryPrice;
      quote += proceeds;
      fills.push({ time, side: 'SELL', price, pnl: Number(pnl.toFixed(2)), reason: 'EXIT_SIGNAL' });
      position = null;
      trades++;
      cooldownUntil = time + r.cooldownMin * 60_000;
    }

    const eq = equityAt(price);
    peakEquity = Math.max(peakEquity, eq);
    maxDrawdown = Math.max(maxDrawdown, (peakEquity - eq) / peakEquity);
  }

  const finalEquity = equityAt(candles[candles.length - 1].close);
  const wins = fills.filter((f) => f.side === 'SELL' && f.pnl > 0).length;
  const losses = fills.filter((f) => f.side === 'SELL' && f.pnl <= 0).length;

  return {
    symbol: cfg.symbol,
    interval: cfg.interval,
    strategy: strategy.id,
    bars: candles.length - strategy.warmup,
    from: new Date(candles[strategy.warmup].openTime).toISOString(),
    to: new Date(candles[candles.length - 1].openTime).toISOString(),
    initialQuote,
    finalEquity: Number(finalEquity.toFixed(2)),
    returnPct: Number((((finalEquity - initialQuote) / initialQuote) * 100).toFixed(2)),
    trades,
    wins,
    losses,
    winRate: trades ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 0,
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(2)),
    fills,
  };
}
