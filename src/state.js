import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * JSON-file persistence for agent state: equity, open position, trade log
 * and decision journal. Deliberately simple and human-auditable — every
 * decision the agent makes is on disk in plain text.
 */
export class StateStore {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.file = join(stateDir, 'agent-state.json');
    mkdirSync(stateDir, { recursive: true });
  }

  load() {
    if (!existsSync(this.file)) return this.fresh();
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return this.fresh();
    }
  }

  fresh(quote = 10_000) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      version: 1,
      dayStart: today,
      dayStartEquity: quote,
      quote,
      position: null, // { symbol, qty, entryPrice, entryTime, stopLoss, takeProfit }
      trades: [],
      journal: [],
      lastEntryBySymbol: {},
      tradesToday: 0,
    };
  }

  save(state) {
    // Keep journal bounded — last 500 decisions.
    state.journal = state.journal.slice(-500);
    state.trades = state.trades.slice(-500);
    writeFileSync(this.file, JSON.stringify(state, null, 2));
  }

  /** Roll daily counters when the calendar day changes. */
  rollDay(state, equity) {
    const today = new Date().toISOString().slice(0, 10);
    if (state.dayStart !== today) {
      state.dayStart = today;
      state.dayStartEquity = equity;
      state.tradesToday = 0;
    }
  }
}
