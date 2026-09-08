/**
 * LLM analyst layer — the "AI" in AI agent.
 *
 * Given market context and the ensemble's mechanical votes, an LLM acts as
 * a second opinion: it can approve, veto, or size-down a proposed trade, and
 * it writes every judgment as natural language into the decision journal.
 *
 * Provider-agnostic over plain OpenAI-compatible HTTP (works with OpenAI,
 * Zhipu GLM, DeepSeek, Groq, local Ollama, ...). When no key is configured
 * the agent degrades gracefully to the pure-rules pipeline — the LLM is an
 * enhancement, never a hard dependency.
 */
const PROVIDERS = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant' },
  ollama: { url: 'http://localhost:11434/v1/chat/completions', model: 'lama3' },
};

const SYSTEM_PROMPT = `You are the risk analyst inside AlphaPilot, a spot-trading agent on Binance.
You receive recent OHLCV statistics and the votes of two mechanical strategies.
Your job: give a second opinion on the proposed action.

Respond with ONLY a JSON object, no markdown, no prose:
{
  "decision": "APPROVE" | "VETO" | "DOWNSIZE",
  "confidence_adjustment": -0.5 to 0.5,
  "reason": "one or two short sentences of concrete reasoning"
}

Rules:
- VETO when the technical signal contradicts obvious context (e.g. voting BUY into a steep intraday collapse, or the signal is stale relative to volatility).
- DOWNSIZE when direction is plausible but the environment is noisy or the trend is weak.
- APPROVE when the mechanical votes and the market context agree.
- Be conservative: when in doubt, prefer DOWNSIZE over APPROVE, VETO over DOWNSIZE.
- "reason" must reference concrete numbers you were given.`;

export class LLMAnalyst {
  constructor(cfg) {
    this.cfg = cfg;
    this.enabled = Boolean(cfg.llm.apiKey);
    this.providerName = cfg.llm.provider;
    this.stats = { calls: 0, vetoes: 0, downsizes: 0, errors: 0 };
  }

  /** Build a compact, token-efficient market context string. */
  #context(candles, signal, position) {
    const n = candles.length;
    const last = candles[n - 1];
    const prev = candles[n - 2];
    const closes = candles.map((c) => c.close);
    const hi = Math.max(...candles.slice(-48).map((c) => c.high));
    const lo = Math.min(...candles.slice(-48).map((c) => c.low));
    const vol24 = candles.slice(-24).reduce((a, c) => a + c.volume, 0);
    const chg1 = ((last.close - prev.close) / prev.close * 100).toFixed(2);
    const chg24 = ((last.close - closes[n - 25] - 0) / closes[n - 25] * 100).toFixed(2);
    const ctx = [
      `symbol: ${this.cfg.symbol} (${this.cfg.interval} bars)`,
      `last close: ${last.close}, prev: ${prev.close} (${chg1}%), 24h: ${chg24}%`,
      `48-bar range: ${lo.toFixed(2)} - ${hi.toFixed(2)}, price at ${(((last.close - lo) / (hi - lo)) * 100).toFixed(0)}% of range`,
      `last bar volume: ${last.volume.toFixed(2)}, 24h volume: ${vol24.toFixed(2)}`,
      `mechanical votes: ${signal.reason}`,
    ];
    if (position) {
      ctx.push(`open position: entry=${position.entryPrice}, stop=${position.stopLoss.toFixed(2)}, target=${position.takeProfit.toFixed(2)}, current PnL=${(((last.close - position.entryPrice) / position.entryPrice) * 100).toFixed(2)}%`);
    }
    return ctx.join('\n');
  }

  /**
   * Second opinion on a proposed action.
   * Returns { decision, confidenceAdjustment, reason, provider, model } or null when disabled.
   */
  async review(candles, signal, position = null) {
    if (!this.enabled) return null;
    const provider = PROVIDERS[this.providerName];
    if (!provider) return null;

    const body = {
      model: this.cfg.llm.model || provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.#context(candles, signal, position) + `\n\nproposed action: ${signal.action} (confidence ${signal.confidence?.toFixed(2)})` },
      ],
      temperature: 0.2,
      max_tokens: 300,
    };

    this.stats.calls++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.stats.errors++;
        return { decision: 'APPROVE', confidenceAdjustment: 0, reason: `LLM analyst unavailable (HTTP ${res.status}) — falling back to mechanical signal`, provider: this.providerName, model: body.model, degraded: true };
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const json = JSON.parse(text.replace(/```json|```/g, '').trim());
      const decision = ['APPROVE', 'VETO', 'DOWNSIZE'].includes(json.decision) ? json.decision : 'APPROVE';
      if (decision === 'VETO') this.stats.vetoes++;
      if (decision === 'DOWNSIZE') this.stats.downsizes++;
      return {
        decision,
        confidenceAdjustment: Math.max(-0.5, Math.min(0.5, Number(json.confidence_adjustment) || 0)),
        reason: String(json.reason || '').slice(0, 400),
        provider: this.providerName,
        model: body.model,
      };
    } catch (err) {
      this.stats.errors++;
      return {
        decision: 'APPROVE',
        confidenceAdjustment: 0,
        reason: `LLM analyst error (${err.message}) — falling back to mechanical signal`,
        provider: this.providerName,
        model: body.model,
        degraded: true,
      };
    }
  }

  /**
   * One-shot natural-language market brief (for `alphapilot explain`).
   * Works without any trading intent — pure narration of the tape.
   */
  async explain(candles, signal) {
    if (!this.enabled) return null;
    const provider = PROVIDERS[this.providerName];
    if (!provider) return null;
    const body = {
      model: this.cfg.llm.model || provider.model,
      messages: [
        { role: 'system', content: 'You are a concise market analyst. Reply in the same language the user writes in. Max 120 words, no disclaimers, reference concrete numbers.' },
        { role: 'user', content: this.#context(candles, signal, null) + '\n\nWrite a short market brief for a trader holding no position: what is the tape doing, and what levels matter?' },
      ],
      temperature: 0.3,
      max_tokens: 300,
    };
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.llm.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  }
}

export const llmProviders = Object.keys(PROVIDERS);
