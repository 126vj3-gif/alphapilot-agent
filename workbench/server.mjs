import http from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MarketData } from '../src/market.js';
import { loadConfig } from '../src/config.js';
import { getStrategy } from '../src/strategies/index.js';
import { LLMAnalyst } from '../src/llm.js';
import { StateStore } from '../src/state.js';
import { analyzeSymbol, toSec } from './analysis.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = process.env.WB_PORT || 3210;

const cfg = loadConfig({});
const market = new MarketData(cfg);
const analyst = new LLMAnalyst(cfg);
const strategy = getStrategy(cfg.strategy);
const store = new StateStore(cfg.stateDir);

const klineCache = new Map(); // key -> {t, data}
const KL_TTL = 15_000;

async function getKlines(symbol, interval, limit = 300) {
  const key = `${symbol}:${interval}:${limit}`;
  const hit = klineCache.get(key);
  if (hit && Date.now() - hit.t < KL_TTL) return hit.data;
  const data = await market.klines(symbol, interval, limit);
  klineCache.set(key, { t: Date.now(), data });
  return data;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function buildAnalysis(symbol, interval) {
  const base = await getKlines(symbol, interval, 300);
  const mtfTfs = ['15m', '1h', '4h', '1d'].filter((tf) => tf !== interval);
  const mtf = {};
  for (const tf of mtfTfs) {
    try { mtf[tf] = await getKlines(symbol, tf, tf === '1d' || tf === '4h' ? 400 : 80); } catch { /* keep others */ }
  }
  const signal = strategy.evaluate(base);
  return analyzeSymbol(base, mtf, signal);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'POST' && url.pathname === '/api/beacon') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        writeFileSync(join(ROOT, 'workbench', 'render-beacon.json'), body);
        json(res, 200, { ok: true });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(cfg.stateDir, { recursive: true });
      writeFileSync(join(cfg.stateDir, 'STOP'), `${new Date().toISOString()}\n`);
      return json(res, 200, { ok: true, message: 'Kill switch armed — agent refuses new orders' });
    }

    if (url.pathname === '/api/klines') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const interval = url.searchParams.get('interval') || '1h';
      const limit = Math.min(500, Number(url.searchParams.get('limit') || 300));
      const candles = await getKlines(symbol, interval, limit);
      return json(res, 200, {
        symbol, interval, env: cfg.apiEnv,
        candles: candles.map((c) => ({
          time: Math.floor(c.closeTime / 1000),
          open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
      });
    }

    if (url.pathname === '/api/analyze') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const interval = url.searchParams.get('interval') || '1h';
      return json(res, 200, { symbol, interval, ...(await buildAnalysis(symbol, interval)) });
    }

    if (url.pathname === '/api/report') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const interval = url.searchParams.get('interval') || '1h';
      const a = await buildAnalysis(symbol, interval);
      let narrative = null, source = 'rules';
      if (analyst.enabled) {
        try {
          narrative = await analyst.complete(
            '你是 AlphaPilot 工作台的首席技术分析师。用中文写一份简洁的观察报告。'
            + '严格规则：所有数字必须直接引用我提供的数据，禁止编造任何价位；不要给出投资建议；'
            + '不超过 220 字；按「结构 / 多周期 / 观察计划 / 风险点」四段输出，每段一两句话。',
            JSON.stringify(a),
            { temperature: 0.3, maxTokens: 600 },
          );
          if (narrative) source = `llm:${analyst.providerName}`;
        } catch { /* fall through to rules template */ }
      }
      if (!narrative) {
        const s = a.structure, p = a.plan;
        narrative = [
          `结构：${s.trend}，收盘 ${a.price}（SMA20 ${s.sma20} / SMA50 ${s.sma50}），RSI ${s.rsi14}（${s.rsiZone}），ATR ${s.atr14}。`,
          `多周期：${a.resonance.verdict}（共振分 ${a.resonance.score}）——${a.resonance.timeframes.map((m) => `${m.tf}:${m.label}`).join('，')}。`,
          `观察计划：${p.bias}${p.zone ? `，观察区 ${p.zone[0]}–${p.zone[1]}` : ''}${p.breakout ? `，突破参考 ${p.breakout}` : ''}${p.breakdown ? `，破位参考 ${p.breakdown}` : ''}${p.invalid ? `，作废位 ${p.invalid}` : ''}${p.target ? `，目标参考 ${p.target}` : ''}。`,
          `风险点：单一周期信号不构成入场依据；所有价位由规则计算，仅供观察。`,
        ].join('\n');
      }
      return json(res, 200, { symbol, interval, source, narrative, analysis: a });
    }

    if (url.pathname === '/api/agent') {
      const st = store.load();
      return json(res, 200, {
        mode: cfg.dryRun ? 'DRY-RUN' : 'LIVE',
        env: cfg.apiEnv,
        killSwitch: cfg.killSwitch || existsSync(join(cfg.stateDir, 'STOP')),
        equity: st.quote + (st.position ? st.position.qty * (st.position.entryPrice || 0) : 0),
        position: st.position,
        tradesToday: st.tradesToday,
        recentJournal: st.journal.slice(-8).reverse(),
      });
    }

    // static files
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const fp = join(PUBLIC, file.replace(/\.\./g, ''));
    if (existsSync(fp) && !fp.endsWith('/')) {
      const ext = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[fp.slice(fp.lastIndexOf('.'))] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${ext}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(readFileSync(fp));
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`AlphaPilot workbench: http://localhost:${PORT}  (env=${cfg.apiEnv}, llm=${analyst.enabled ? analyst.providerName : 'off'})`);
});
