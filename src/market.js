import { Spot } from '@binance/spot';

/**
 * Market data provider over the official @binance/spot SDK.
 * Klines are the single source of truth for strategies; the same shape is
 * used by the backtester so strategies run identically live vs. simulated.
 */
export class MarketData {
  constructor(cfg) {
    this.cfg = cfg;
    this.client = new Spot({
      configurationRestAPI: {
        basePath: cfg.basePath,
        apiKey: cfg.apiKey || undefined,
        apiSecret: cfg.apiSecret || undefined,
      },
    });
  }

  /** Fetch recent klines as candles {openTime, open, high, low, close, volume}. */
  async klines(symbol, interval, limit = 200) {
    const res = await this.client.restAPI.klines({ symbol, interval, limit });
    const raw = await res.data();
    return raw.map((k) => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: k[6],
    }));
  }

  /** Latest price for a symbol. */
  async price(symbol) {
    const res = await this.client.restAPI.tickerPrice({ symbol });
    const d = await res.data();
    return Number(d.price);
  }

  /** Spot account info (requires API key). */
  async account() {
    const res = await this.client.restAPI.account();
    return res.data();
  }

  /** Quote-asset free balance for a symbol like BTCUSDT (quote = USDT). */
  async quoteBalance(symbol) {
    const info = await this.account();
    const quote = symbol.endsWith('USDT') ? 'USDT' : symbol.slice(-3);
    const bal = info.balances.find((b) => b.asset === quote);
    return bal ? Number(bal.free) : 0;
  }
}
