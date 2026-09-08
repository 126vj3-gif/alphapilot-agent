#!/usr/bin/env node
/**
 * Live operations demo — drives a REAL PowerShell console the way a human
 * would: types each command into the terminal, runs it, shows the output.
 * The script itself runs under node inside the visible terminal window,
 * so every byte it prints lands on screen exactly once (no PS 5.1 piping).
 *
 * A parallel machine-readable log goes to %TEMP%/alphapilot-opslog.json so
 * the recording can be verified programmatically afterwards.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG = join(process.env.TEMP || '/tmp', 'alphapilot-opslog.jsonl');
const GO = join(process.env.TEMP || '/tmp', 'alphapilot-go.txt');
const DONE = join(process.env.TEMP || '/tmp', 'alphapilot-ops-done.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (obj) => appendFileSync(LOG, JSON.stringify(obj) + '\n');
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', gray: '\x1b[90m',
};

const line = '='.repeat(72);
function header(t) {
  console.log(`\n${C.cyan}${C.bold}${line}\n  ${t}\n${line}${C.reset}\n`);
  log({ t: Date.now(), ev: 'header', text: t });
}

function typePrompt(cmd) {
  process.stdout.write(`${C.green}PS C:\\Users\\Administrator\\agentos\\binance-agent> ${C.reset}`);
  // type visibly but fast
  for (const ch of cmd) {
    process.stdout.write(ch);
    // no per-char delay here; bulk delay after
  }
  process.stdout.write('\n');
}

async function run(cmd, args, pauseMs = 1500) {
  typePrompt([cmd, ...args].join(' '));
  log({ t: Date.now(), ev: 'cmd', text: [cmd, ...args].join(' ') });
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr ? `\n[stderr] ${r.stderr}` : '');
  process.stdout.write(out);
  log({ t: Date.now(), ev: 'output', text: out.slice(0, 2000), code: r.status });
  console.log('');
  await sleep(pauseMs);
}

// ── wait for the GO signal from the recorder side ──────────────────────────
while (!existsSync(GO)) await sleep(200);
log({ t: Date.now(), ev: 'go' });
try { writeFileSync(LOG, "") } catch {}

console.log(`${C.cyan}${C.bold}${line}`);
console.log('  AlphaPilot  -  Strategy-Execution AI Agent on Binance Agent OS');
console.log(`${line}${C.reset}`);
console.log(`${C.gray}  live demo: real testnet market data + real LLM analyst (DeepSeek)${C.reset}\n`);
await sleep(4000);

header('1/5  project files');
typePrompt('dir');
log({ t: Date.now(), ev: 'cmd', text: 'dir' });
const d = spawnSync('cmd', ['/c', 'dir', '/b'], { cwd: ROOT, encoding: 'utf8' });
console.log(d.stdout);
log({ t: Date.now(), ev: 'output', text: d.stdout.slice(0, 500) });
await sleep(3500);

header('2/5  one live decision cycle  (observe > signal > risk > dry-run execute)');
await run('node', ['bin/alphapilot.js', 'once'], 5000);

header('3/5  AI market brief  (LLM analyst, live call, answers in Chinese)');
await run('node', ['bin/alphapilot.js', 'explain'], 9000);

header('4/5  backtest  (same strategy + risk code as live, 30 days BTCUSDT)');
await run('node', ['bin/alphapilot.js', 'backtest', '--symbol', 'BTCUSDT', '--interval', '1h', '--days', '30'], 6000);

header('5/5  safety: kill switch  (one command refuses every new order)');
await run('node', ['bin/alphapilot.js', 'stop'], 3500);
await run('node', ['bin/alphapilot.js', 'status'], 4500);
typePrompt('del state\\STOP');
rmSync(join(ROOT, 'state', 'STOP'), { force: true });
console.log('');
await sleep(700);

console.log(`\n${C.cyan}${C.bold}${line}`);
console.log('  github.com/126vj3-gif/alphapilot-agent');
console.log(`${line}${C.reset}`);
console.log(`${C.green}  backtest = live code  |  LLM can veto or downsize any trade`);
console.log(`${C.green}  every decision journaled  |  kill switch  |  no withdrawal path${C.reset}`);
console.log(`${C.gray}  DRY-RUN on testnet - no real funds were risked in this demo${C.reset}\n`);
log({ t: Date.now(), ev: 'done' });
await sleep(10000);
writeFileSync(DONE, new Date().toISOString());
await sleep(20000);
