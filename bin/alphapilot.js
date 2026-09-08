#!/usr/bin/env node
import { loadConfig } from '../src/config.js';
import { AlphaPilot } from '../src/agent.js';
import { backtest } from '../src/backtest.js';
import { StateStore } from '../src/state.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [,, command = 'once', ...args] = process.argv;

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function main() {
  const cfg = loadConfig({
    symbol: arg('symbol'),
    interval: arg('interval'),
    strategy: arg('strategy'),
  });

  switch (command) {
    case 'once': {
      // Single decision cycle — the agent's "one step" for inspection.
      const agent = new AlphaPilot(cfg);
      const result = await agent.cycle();
      console.log(`\nAlphaPilot · ${cfg.symbol} ${cfg.interval} · strategy=${cfg.strategy} · mode=${cfg.dryRun ? 'DRY-RUN' : 'LIVE'} (${cfg.apiEnv})`);
      console.log(`price: ${fmt(result.price)}   equity: ${fmt(result.equity)} USDT`);
      console.log(`signal: ${result.signal.action} (confidence ${result.signal.confidence})`);
      console.log(`  why: ${result.signal.reason}`);
      for (const e of result.events) {
        if (e.type === 'RISK_BLOCK' || e.type === 'ORDER_FILL') {
          console.log(`  [${e.type}] ${e.reason ?? e.order} ${e.pnl !== undefined ? 'pnl=' + e.pnl : ''}`);
        }
      }
      console.log(`journal: ${join('state', 'agent-state.json')}\n`);
      break;
    }

    case 'run': {
      const agent = new AlphaPilot(cfg);
      console.log(`AlphaPilot loop started · ${cfg.symbol} ${cfg.interval} · ${cfg.dryRun ? 'DRY-RUN' : 'LIVE'} · poll=${cfg.pollIntervalMs / 1000}s — Ctrl+C to stop`);
      await agent.run({
        onCycle: (r, n) => {
          const line = `#${n + 1} ${new Date().toLocaleTimeString()} price=${fmt(r.price)} equity=${fmt(r.equity)} signal=${r.signal.action}`;
          console.log(line);
        },
      });
      break;
    }

    case 'backtest': {
      const days = Number(arg('days', 90));
      const result = await backtest({ cfg, days });
      console.log(`\nBacktest · ${result.symbol} ${result.interval} · strategy=${result.strategy}`);
      console.log(`window: ${result.from.slice(0, 10)} → ${result.to.slice(0, 10)}  (${result.bars} bars)`);
      console.log(`equity: ${fmt(result.initialQuote)} → ${fmt(result.finalEquity)} USDT  (${result.returnPct > 0 ? '+' : ''}${result.returnPct}%)`);
      console.log(`trades: ${result.trades}  win rate: ${result.winRate}%  max drawdown: ${result.maxDrawdownPct}%`);
      console.log('');
      for (const f of result.fills.slice(-8)) {
        const d = new Date(f.time).toISOString().slice(0, 16).replace('T', ' ');
        console.log(`  ${d}  ${f.side.padEnd(4)} @ ${fmt(f.price)}  ${f.pnl !== undefined ? `pnl=${f.pnl}` : `size=${f.quoteQty} conf=${f.confidence}`}`);
      }
      if (result.fills.length > 8) console.log(`  … ${result.fills.length - 8} earlier fills omitted`);
      console.log('');
      break;
    }

    case 'explain': {
      // Natural-language market brief from the LLM analyst layer.
      const agent = new AlphaPilot(cfg);
      if (!agent.analyst.enabled) {
        console.error('LLM analyst disabled — set LLM_API_KEY (and optionally LLM_PROVIDER) in .env');
        process.exit(1);
      }
      const candles = await agent.market.klines(cfg.symbol, cfg.interval, 200);
      const signal = agent.strategy.evaluate(candles);
      console.log(`\nAlphaPilot · ${cfg.symbol} ${cfg.interval} · LLM=${cfg.llm.provider}${cfg.llm.model ? '/' + cfg.llm.model : ''}\n`);
      const brief = await agent.analyst.explain(candles, signal);
      console.log(brief ?? '(no output)');
      console.log(`\nmechanical signal for reference: ${signal.action} (${signal.confidence}) — ${signal.reason}\n`);
      break;
    }

    case 'status': {
      const store = new StateStore(cfg.stateDir);
      const state = store.load();
      const stopped = cfg.killSwitch;
      console.log(`\nAlphaPilot status`);
      console.log(`  mode: ${cfg.dryRun ? 'DRY-RUN' : 'LIVE'}   env: ${cfg.apiEnv}   kill-switch: ${stopped ? 'ON' : 'off'}`);
      console.log(`  day: ${state.dayStart}   start equity: ${fmt(state.dayStartEquity)}   trades today: ${state.tradesToday}`);
      if (state.position) {
        console.log(`  position: ${state.position.symbol} qty=${state.position.qty.toFixed(6)} entry=${state.position.entryPrice} SL=${state.position.stopLoss.toFixed(2)} TP=${state.position.takeProfit.toFixed(2)}`);
      } else {
        console.log('  position: flat');
      }
      const closed = state.trades.filter((t) => t.side === 'SELL');
      if (closed.length) {
        const pnl = closed.reduce((a, t) => a + (t.pnl ?? 0), 0);
        console.log(`  closed trades: ${closed.length}   net pnl: ${fmt(pnl)} USDT`);
      }
      const llmReviews = state.journal.filter((j) => j.type === 'LLM_REVIEW');
      if (llmReviews.length) {
        const vetoes = llmReviews.filter((j) => j.decision === 'VETO').length;
        const downsizes = llmReviews.filter((j) => j.decision === 'DOWNSIZE').length;
        console.log(`  LLM analyst: ${llmReviews.length} reviews   vetoes: ${vetoes}   downsizes: ${downsizes}`);
      }
      console.log('');
      break;
    }

    case 'stop': {
      // Manual kill switch: creates state/STOP; the agent refuses new orders.
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(cfg.stateDir, { recursive: true });
      writeFileSync(join(cfg.stateDir, 'STOP'), `${new Date().toISOString()}\n`);
      console.log('Kill switch armed — agent will refuse new orders until state/STOP is deleted.');
      break;
    }

    default:
      console.log(`AlphaPilot — strategy-execution agent on Binance Agent OS

Usage: alphapilot <command> [options]

Commands:
  once        Run a single observe → signal → LLM review → risk → execute cycle
  run         Continuous loop (poll every POLL_INTERVAL_MS, default 60s)
  explain     Natural-language market brief from the LLM analyst layer
  backtest    Replay history through the same strategy+risk code
              options: --symbol BTCUSDT --interval 1h --days 90 --strategy ensemble
  status      Show ledger, open position, LLM stats, and daily counters
  stop        Arm the kill switch (agent refuses new orders)

Options:
  --symbol BTCUSDT   --interval 1h   --strategy ensemble|sma-cross|rsi-reversion

Safety:
  DRY_RUN=true (default) simulates orders; set DRY_RUN=false to trade for real.
  Keys need SPOT trading permission only. There is no withdrawal path in this code.

AI layer (optional):
  LLM_PROVIDER=zhipu|openai|deepseek|groq|ollama   LLM_API_KEY=...   LLM_MODEL=...
  Without a key the agent runs purely mechanical rules — no feature is lost
  beyond the second opinion itself.
`);
  }
}

main().catch((err) => {
  console.error(`[alphapilot] fatal: ${err.message}`);
  process.exit(1);
});
