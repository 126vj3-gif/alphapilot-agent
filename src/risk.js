/**
 * Risk manager — the layer that lets a strategy be *wrong* without wrecking
 * the account. Every order the executor places must pass `checkOrder` first.
 *
 * Guardrails:
 *  - position sizing: fraction of equity, scaled down by signal confidence
 *  - daily loss limit: agent flattens and refuses new entries for the day
 *  - per-day trade cap and per-symbol cooldown (anti-churn)
 *  - exchange minimum notional
 *  - kill switch (env var or state/STOP file) blocks everything
 */
export class RiskManager {
  constructor(cfg) {
    this.cfg = cfg;
    this.risk = cfg.risk;
  }

  /** Attach stop-loss / take-profit prices to a prospective entry. */
  planExit(side, price) {
    const { stopLossPct, takeProfitPct } = this.risk;
    return side === 'BUY'
      ? { stopLoss: price * (1 - stopLossPct), takeProfit: price * (1 + takeProfitPct) }
      : { stopLoss: price * (1 + stopLossPct), takeProfit: price * (1 - takeProfitPct) };
  }

  /**
   * Compute quote-amount (e.g. USDT) to deploy for an entry.
   * Base size = maxPositionPct * equity, scaled by confidence.
   */
  positionSize(equity, confidence) {
    const scale = 0.5 + 0.5 * Math.min(1, Math.max(0, confidence));
    return equity * this.risk.maxPositionPct * scale;
  }

  /**
   * Gate an intended action. Returns { ok: true, order } or
   * { ok: false, reason }.
   */
  checkOrder({ action, symbol, price, confidence, state, equity }) {
    const r = this.risk;
    const fail = (reason) => ({ ok: false, reason });

    if (this.cfg.killSwitch) return fail('kill switch is ON (KILL_SWITCH=1 or state/STOP file)');
    if (action !== 'BUY' && action !== 'SELL') return fail(`action ${action} is not an order`);

    // Daily loss limit.
    const dayPnl = equity - state.dayStartEquity;
    if (state.dayStartEquity > 0 && dayPnl / state.dayStartEquity <= -r.maxDailyLossPct) {
      return fail(`daily loss limit hit (${(100 * dayPnl / state.dayStartEquity).toFixed(2)}% ≤ -${(r.maxDailyLossPct * 100).toFixed(1)}%)`);
    }

    // Daily trade cap.
    if (state.tradesToday >= r.maxDailyTrades) {
      return fail(`daily trade cap reached (${state.tradesToday}/${r.maxDailyTrades})`);
    }

    // Cooldown per symbol.
    const last = state.lastEntryBySymbol[symbol];
    if (last && Date.now() - last < r.cooldownMin * 60_000) {
      const wait = Math.ceil((r.cooldownMin * 60_000 - (Date.now() - last)) / 60_000);
      return fail(`cooldown: ${wait} min left for ${symbol}`);
    }

    // Sizing + exchange minimum notional.
    const quoteQty = this.positionSize(equity, confidence);
    if (quoteQty < r.minQuoteNotional) {
      return fail(`position size ${quoteQty.toFixed(2)} below exchange minimum notional ${r.minQuoteNotional}`);
    }

    return {
      ok: true,
      order: {
        symbol,
        side: action,
        type: 'MARKET',
        quoteOrderQty: Number(quoteQty.toFixed(2)),
        ...this.planExit(action, price),
      },
    };
  }

  /**
   * Evaluate an open position against current price.
   * Returns EXIT_STOP / EXIT_TARGET / null.
   */
  checkPosition(position, price) {
    if (!position) return null;
    if (position.side === 'BUY') {
      if (price <= position.stopLoss) return 'EXIT_STOP';
      if (price >= position.takeProfit) return 'EXIT_TARGET';
    } else {
      if (price >= position.stopLoss) return 'EXIT_STOP';
      if (price <= position.takeProfit) return 'EXIT_TARGET';
    }
    return null;
  }
}
