import { Spot } from '@binance/spot';

/**
 * Execution layer. Two modes:
 *  - dry-run (default): fills are simulated against the live market price and
 *    logged identically to real fills — zero exchange side effects.
 *  - live: MARKET orders through the official @binance/spot SDK on the
 *    configured environment (testnet or prod).
 *
 * The agent never has withdrawal capability: keys are trading-only, and the
 * risk manager gates every order before it reaches this class.
 */
export class Executor {
  constructor(cfg) {
    this.cfg = cfg;
    this.dryRun = cfg.dryRun;
    this.client = new Spot({
      configurationRestAPI: {
        basePath: cfg.basePath,
        apiKey: cfg.apiKey || undefined,
        apiSecret: cfg.apiSecret || undefined,
      },
    });
  }

  /**
   * Submit a MARKET order by quote quantity (e.g. buy 100 USDT worth of BTC).
   * Returns { orderId, price, qty, quoteQty, raw, simulated }.
   */
  async submitOrder({ symbol, side, quoteOrderQty }) {
    if (this.dryRun) {
      const price = await this.#fillPrice(symbol);
      const qty = quoteOrderQty / price;
      return {
        simulated: true,
        orderId: `dry-${Date.now()}`,
        price,
        qty,
        quoteQty: quoteOrderQty,
        raw: null,
      };
    }

    const res = await this.client.restAPI.newOrder({
      symbol,
      side,
      type: 'MARKET',
      quoteOrderQty,
      newOrderRespType: 'FULL',
    });
    const raw = await res.data();
    const fill = raw.fills?.[0] ?? {};
    const price = Number(fill.price ?? 0);
    const qty = Number(raw.executedQty ?? 0);
    return {
      simulated: false,
      orderId: raw.orderId,
      price: price > 0 ? price : qty > 0 ? quoteOrderQty / qty : 0,
      qty,
      quoteQty: quoteOrderQty,
      raw,
    };
  }

  /** Mid-market fill price approximation for simulated orders. */
  async #fillPrice(symbol) {
    const res = await this.client.restAPI.tickerPrice({ symbol });
    const d = await res.data();
    return Number(d.price);
  }
}
