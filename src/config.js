import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Minimal .env parser — no dependency needed. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

const fileEnv = loadEnvFile(join(ROOT, '.env'));
const env = { ...fileEnv, ...process.env }; // real env wins over .env

const ENV_MAP = {
  testnet: 'https://testnet.binance.vision',
  demo: 'https://testnet.binance.vision',
  prod: 'https://api.binance.com',
};

const DEFAULT_RISK = {
  maxPositionPct: 0.10,
  maxDailyLossPct: 0.03,
  maxDailyTrades: 20,
  stopLossPct: 0.02,
  takeProfitPct: 0.04,
  cooldownMin: 15,
  minQuoteNotional: 5,
};

function riskFromEnv() {
  const risk = { ...DEFAULT_RISK };
  for (const key of Object.keys(DEFAULT_RISK)) {
    const raw = env[`RISK__${key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`];
    if (raw !== undefined && raw !== '') {
      const num = Number(raw);
      if (Number.isFinite(num)) risk[key] = num;
    }
  }
  return risk;
}

export function loadConfig(overrides = {}) {
  const apiEnv = (overrides.apiEnv || env.BINANCE_API_ENV || 'testnet').toLowerCase();
  const llmProvider = (env.LLM_PROVIDER || 'zhipu').toLowerCase();
  const cfg = {
    symbol: overrides.symbol || env.SYMBOL || 'BTCUSDT',
    interval: overrides.interval || env.INTERVAL || '1h',
    strategy: overrides.strategy || env.STRATEGY || 'ensemble',
    dryRun: overrides.dryRun !== undefined
      ? overrides.dryRun
      : (env.DRY_RUN ?? 'true') !== 'false',
    killSwitch: (env.KILL_SWITCH ?? '0') === '1' || existsSync(join(ROOT, 'state', 'STOP')),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS || 60_000),
    apiEnv,
    basePath: ENV_MAP[apiEnv] || ENV_MAP.testnet,
    apiKey: env.BINANCE_API_KEY || '',
    apiSecret: env.BINANCE_SECRET_KEY || '',
    risk: overrides.risk || riskFromEnv(),
    stateDir: join(ROOT, 'state'),
    llm: {
      provider: llmProvider,
      model: env.LLM_MODEL || '',
      apiKey: env.LLM_API_KEY || '',
    },
  };
  return cfg;
}

export const ROOT_DIR = ROOT;
