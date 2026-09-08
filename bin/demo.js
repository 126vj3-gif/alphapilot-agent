#!/usr/bin/env node
/**
 * Demo script — a ~60 second walkthrough of the whole agent for the
 * hackathon demo video: backtest → live cycle → status → kill switch.
 * Runs entirely on testnet public data in DRY-RUN mode. No keys needed.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (args) =>
  execSync(`node "${join(ROOT, 'bin', 'alphapilot.js')}" ${args}`, {
    encoding: 'utf8',
    env: process.env,
  });

const banner = (t) =>
  console.log(`\n${'═'.repeat(64)}\n  ${t}\n${'═'.repeat(64)}`);

banner('1/4 · Backtest — same strategy & risk code as live (BTCUSDT 1h, 30d)');
console.log(run('backtest --symbol BTCUSDT --interval 1h --days 30').trim());

banner('2/4 · Live decision cycle — real-time testnet price, DRY-RUN execution');
console.log(run('once').trim());

banner('3/4 · Ledger & position status');
console.log(run('status').trim());

banner('4/4 · Kill switch — one command to refuse every new order');
console.log(run('stop').trim());
console.log('  (delete state/STOP to re-arm the agent)\n');
