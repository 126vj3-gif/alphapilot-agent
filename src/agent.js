import { MarketData } from './market.js';
import { Executor } from './executor.js';
import { RiskManager } from './risk.js';
import { StateStore } from './state.js';
import { getStrategy } from './strategies/index.js';

/**
 * AlphaPilot agent core — a single decision cycle:
 *
 *   market data → strategy signal → risk gate → execution → journal
 *
 * The loop is intentionally readable: every step appends to the on-disk
 * journal so the agent's behaviour is fully auditable after the fact.
 */
export class AlphaPilot {
  constructor(cfg) {
    this.cfg = cfg;
    this.market = new MarketData(cfg);
    this.executor = new Executor(cfg);
    this.risk = new RiskManager(cfg);
    this.store = new StateStore(cfg.stateDir);
    this.strategy = getStrategy(cfg.strategy);
  }

  /** Mark-to-market equity of the local ledger. */
  equity(state, price) {
    if (!state.position) return state.quote;
    const pos = state.position;
    return state.quote + pos.qty * price;
  }

  async cycle() {
    const state = this.store.load();
    this.store.rollDay(state, this.equity(state, state.position?.entryPrice ?? 0) || state.dayStartEquity);
    const events = [];
    const log = (type, data) => {
      const entry = { time: new Date().toISOString(), type, ...data };
      events.push(entry);
      state.journal.push(entry);
    };

    // 1 ─ Market observation
    const candles = await this.market.klines(
      this.cfg.symbol,
      this.cfg.interval,
      Math.max(200, this.strategy.warmup + 20),
    );
    const price = candles[candles.length - 1].close;
    let equity = this.equity(state, price);
    log('OBSERVE', {
      symbol: this.cfg.symbol,
      price,
      equity: Number(equity.toFixed(2)),
      mode: this.cfg.dryRun ? 'DRY-RUN' : 'LIVE',
      env: this.cfg.apiEnv,
    });

    // 2 ─ Manage the open position first (exits beat new entries)
    const exitReason = this.risk.checkPosition(state.position, price);
    if (exitReason) {
      await this.#closePosition(state, price, exitReason, log);
      equity = this.equity(state, price);
    }

    // 3 ─ Strategy signal
    const signal = this.strategy.evaluate(candles);
    log('SIGNAL', { strategy: this.strategy.id, action: signal.action, confidence: Number((signal.confidence ?? 0).toFixed(3)), reason: signal.reason });

    // 4 ─ Act on the signal (spot: long-only — SELL means "exit the long")
    let acted = null;
    if (signal.action === 'SELL' && state.position) {
      acted = await this.#closePosition(state, price, 'EXIT_SIGNAL', log);
    } else if (signal.action === 'BUY' && !state.position) {
      const gate = this.risk.checkOrder({
        action: 'BUY',
        symbol: this.cfg.symbol,
        price,
        confidence: signal.confidence,
        state,
        equity,
      });
      if (gate.ok) {
        acted = await this.#openPosition(state, gate.order, log);
      } else {
        log('RISK_BLOCK', { wanted: 'BUY', reason: gate.reason });
      }
    }

    this.store.save(state);
    return { price, equity: this.equity(state, price), signal, acted, events, state };
  }

  async #openPosition(state, order, log) {
    const fill = await this.executor.submitOrder(order);
    state.position = {
      symbol: order.symbol,
      side: 'BUY',
      qty: fill.qty,
      entryPrice: fill.price,
      entryTime: Date.now(),
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
    };
    state.quote -= fill.quoteQty;
    state.tradesToday += 1;
    state.lastEntryBySymbol[order.symbol] = Date.now();
    state.trades.push({
      time: new Date().toISOString(),
      symbol: order.symbol,
      side: 'BUY',
      qty: fill.qty,
      price: fill.price,
      quoteQty: fill.quoteQty,
      simulated: fill.simulated,
    });
    log('ORDER_FILL', {
      order: `${order.symbol} BUY ${fill.quoteQty} USDT @ ${fill.price}`,
      stopLoss: Number(order.stopLoss.toFixed(2)),
      takeProfit: Number(order.takeProfit.toFixed(2)),
      simulated: fill.simulated,
      orderId: fill.orderId,
    });
    return fill;
  }

  async #closePosition(state, price, reason, log) {
    const pos = state.position;
    if (!pos) return null;
    const fill = await this.executor.submitOrder({
      symbol: pos.symbol,
      side: 'SELL',
      quoteOrderQty: pos.qty * price, // market-out the whole position
    });
    const proceeds = fill.price > 0 ? pos.qty * fill.price : pos.quoteAtEntry ?? 0;
    const pnl = proceeds - pos.qty * pos.entryPrice;
    state.quote += proceeds;
    state.position = null;
    state.tradesToday += 1;
    state.trades.push({
      time: new Date().toISOString(),
      symbol: pos.symbol,
      side: 'SELL',
      qty: pos.qty,
      price: fill.price,
      quoteQty: proceeds,
      pnl: Number(pnl.toFixed(2)),
      reason,
      simulated: fill.simulated,
    });
    log('ORDER_FILL', {
      order: `${pos.symbol} SELL (close) @ ${fill.price}`,
      reason,
      pnl: Number(pnl.toFixed(2)),
      simulated: fill.simulated,
      orderId: fill.orderId,
    });
    return fill;
  }

  /** Continuous loop. */
  async run({ maxCycles = Infinity, onCycle } = {}) {
    let n = 0;
    for (;;) {
      const started = Date.now();
      try {
        const result = await this.cycle();
        onCycle?.(result, n);
      } catch (err) {
        console.error(`[alphapilot] cycle error: ${err.message}`);
      }
      if (++n >= maxCycles) break;
      const wait = Math.max(1000, this.cfg.pollIntervalMs - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
