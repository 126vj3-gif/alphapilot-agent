---
name: alphapilot
description: |
  AlphaPilot — a self-contained strategy-execution AI agent for Binance spot markets.
  observe market → generate signals (SMA cross + RSI reversion ensemble) → LLM analyst
  second opinion (approve / veto / downsize with natural-language reasoning) → risk gate
  (position sizing, daily loss limit, cooldown, kill switch) → execute (dry-run or live
  MARKET orders) → journal every decision to disk. Includes a backtester that replays
  history through the exact same strategy and risk code used live. Trigger whenever the
  user wants to run, backtest, or inspect an automated trading strategy on Binance —
  phrases like "run my strategy", "backtest BTCUSDT", "explain the market",
  "how is the agent doing", or "stop trading".
metadata:
  author: alphapilot
  version: "1.1"
---

# AlphaPilot — Strategy Execution Agent

A trading agent built on Binance Agent OS primitives: the official `@binance/spot`
SDK for market data and execution, the Skills Hub skill format for packaging, and a
binance-cli-compatible configuration surface (same env vars: `BINANCE_API_KEY`,
`BINANCE_SECRET_KEY`, `BINANCE_API_ENV`).

## When to Use

| User intent | Command |
|-------------|---------|
| Run one decision cycle (observe → signal → LLM review → risk → execute) | `npx alphapilot once` |
| Start the continuous loop | `npx alphapilot run` |
| Natural-language market brief from the LLM analyst | `npx alphapilot explain` |
| Backtest a symbol/interval | `npx alphapilot backtest --symbol BTCUSDT --interval 1h --days 90` |
| Show ledger, position, LLM stats, daily counters | `npx alphapilot status` |
| Arm the kill switch | `npx alphapilot stop` |

## Prerequisites

- Node.js ≥ 22
- `npm install` in the repo root
- For live trading only: Binance API key with **SPOT trading permission, no
  withdrawal permission**. Dry-run (default) and backtest need no credentials at
  all — public market data endpoints suffice.
- Optional AI layer: `LLM_PROVIDER` + `LLM_API_KEY` (any OpenAI-compatible provider:
  zhipu / openai / deepseek / groq / ollama). Without a key the agent runs purely
  mechanical rules — only the second opinion is skipped.

## Behaviour Model

Every cycle runs the same pipeline, and every step appends to
`state/agent-state.json` (human-readable JSON journal):

1. **Observe** — fetch klines for the configured symbol/interval.
2. **Manage exits first** — open position checked against stop-loss / take-profit
   before any new entry is considered.
3. **Signal** — ensemble of two strategies votes; a trade needs score ≥ 0.5 and no
   dissenting vote.
4. **LLM analyst** — on a proposed entry, the LLM receives market context and vote
   details, and answers with a JSON verdict: APPROVE, VETO (blocks the entry), or
   DOWNSIZE (scales confidence down → smaller position). Its reasoning is journaled
   verbatim. Errors degrade gracefully to the mechanical signal.
5. **Risk gate** — sizing (fraction of equity × confidence), daily loss limit,
   trade cap, per-symbol cooldown, minimum notional, kill switch.
6. **Execute** — dry-run fills at live market price (default) or real MARKET orders
   via `@binance/spot`.

## Configuration

Copy `.env.example` to `.env`. Key switches:

- `DRY_RUN` — `true` (default) simulates; `false` places real orders.
- `BINANCE_API_ENV` — `testnet` (default) | `prod`.
- `KILL_SWITCH=1` or a `state/STOP` file makes the agent refuse all new orders.
- `RISK__*` — every risk parameter is overridable.

## Backtesting

The backtester replays historical klines through the identical strategy and risk
functions used live, so simulated and live behaviour cannot drift apart. Fills are
assumed at candle close (conservative; no lookahead — the strategy only ever sees
`candles.slice(0, i + 1)`).
