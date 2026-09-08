#!/usr/bin/env node
/**
 * Screen-recording script for the hackathon demo video.
 *
 * Design: every command's REAL output is captured beforehand (live testnet +
 * live DeepSeek LLM); the recording then replays it with controlled pacing —
 * section title cards, line-by-line reveal, deliberate pauses. No network
 * latency, no flakiness, deterministic ~2 minute video.
 *
 * Run:  node bin/recorder.js        (clears screen and starts the show)
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m',
};

const clear = () => process.stdout.write('\x1b[2J\x1b[H');

function banner(title, subtitle) {
  clear();
  const line = '═'.repeat(66);
  console.log(`${C.cyan}${C.bold}${line}`);
  console.log(`  ${title}`);
  if (subtitle) console.log(`${C.dim}  ${subtitle}`);
  console.log(`${line}${C.reset}`);
  console.log('');
}

/** Print text with a typewriter effect. */
async function type(text, cps = 240) {
  for (const ch of text) {
    process.stdout.write(ch);
    await sleep(1000 / cps);
  }
  process.stdout.write('\n');
}

/** Reveal a captured block line by line. */
async function reveal(lines, delayMs = 140, skipWait = 20) {
  for (let i = 0; i < lines.length; i++) {
    console.log(lines[i]);
    await sleep(i % skipWait === 0 ? delayMs * 4 : delayMs);
  }
}

const run = (args, env = {}) =>
  execSync(`node "${join(ROOT, 'bin', 'alphapilot.js')}" ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

// ── Pre-capture all real outputs ────────────────────────────────────────────
const LLM_ENV = {
  LLM_PROVIDER: 'deepseek',
  LLM_API_KEY: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LANGCHAIN_MODEL_NAME || 'deepseek-chat',
};

const captured = {};
const capture = (key, fn) => { try { captured[key] = fn().trimEnd(); } catch (e) { captured[key] = `[error: ${e.message}]`; } };

process.stdout.write('capturing real outputs…');
capture('backtest', () => run('backtest --symbol BTCUSDT --interval 1h --days 30'));
process.stdout.write(' backtest ✓');
capture('llm-review', () => execSync(
  `node -e "import('./src/llm.js').then(async ({LLMAnalyst}) => { const {loadConfig}=await import('./src/config.js'); const {MarketData}=await import('./src/market.js'); const cfg=loadConfig({}); const a=new LLMAnalyst(cfg); const m=new MarketData(cfg); const c=await m.klines('BTCUSDT','1h',200); const sig={action:'BUY',confidence:0.7,reason:'[sma-cross] BUY (0.70) golden cross | [rsi-reversion] HOLD (0.00) RSI 55 neutral'}; const r=await a.review(c,sig,null); console.log('LLM VERDICT: '+r.decision+'  (confidence '+r.confidenceAdjustment+')'); console.log('MODEL: '+r.provider+'/'+r.model); console.log(''); console.log('REASONING:'); console.log(r.reason); })"`,
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...LLM_ENV } },
));
process.stdout.write(' llm-review ✓');
capture('explain', () => run('explain', LLM_ENV));
process.stdout.write(' explain ✓');
capture('once', () => run('once', LLM_ENV));
process.stdout.write(' once ✓\n\n');

const show = (key, delayMs) => reveal(String(captured[key]).split(/\r?\n/), delayMs);

// ═══════════════════════════════ THE RECORDING ══════════════════════════════
await sleep(1500);

banner('AlphaPilot', 'Strategy-Execution AI Agent · Binance Agent OS · Hackathon Track A');
await type('signal  →  LLM verdict  →  risk gate  →  execute  →  audit', 160);
console.log('');
await type('$ git clone https://github.com/126vj3-gif/alphapilot-agent && npm install', 200);
await sleep(2200);

// 1 backtest
banner('1 / 4 · BACKTEST', 'same strategy & risk code as live — 30 days of real BTCUSDT klines');
await type('$ npx alphapilot backtest --symbol BTCUSDT --interval 1h --days 30', 200);
console.log('');
await show('backtest', 110);
await sleep(2400);

// 2 LLM review
banner('2 / 4 · LLM ANALYST', 'a proposed BUY gets a real second opinion before any order is placed');
await type('$ node -e "analyst.review(candles, proposedBuy)"   # DeepSeek, live', 140);
console.log('');
await show('llm-review', 160);
await sleep(2800);

// 3 explain
banner('3 / 4 · MARKET BRIEF', 'alphapilot explain — natural-language read of the tape');
await type('$ npx alphapilot explain', 200);
console.log('');
await show('explain', 120);
await sleep(2600);

// 4 live cycle
banner('4 / 4 · LIVE DECISION CYCLE', 'observe → signal → LLM review → risk gate → dry-run execution');
await type('$ npx alphapilot once', 220);
console.log('');
await show('once', 130);
await sleep(2400);

// outro
banner('AlphaPilot', 'github.com/126vj3-gif/alphapilot-agent');
await type('Binance Agent OS · @binance/spot SDK · Skills Hub format · binance-cli compatible', 150);
console.log('');
console.log(`${C.green}${C.bold}  backtest = live code   ·   LLM can veto or downsize any trade`);
console.log(`  every decision journaled   ·   kill switch   ·   no withdrawal path${C.reset}`);
console.log('');
console.log(`${C.dim}  DRY-RUN on testnet — no real funds were risked in this demo${C.reset}`);
await sleep(6000);
clear();
