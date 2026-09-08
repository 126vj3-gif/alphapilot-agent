# AlphaPilot — Strategy-Execution Agent on Binance Agent OS

> Binance Agent OS Mini Hackathon · Track A ("搭 Agent" / Build an AI Agent)
> 一个把「策略信号 → LLM 分析师 → 风控 → 执行 → 审计」做成完整闭环的现货策略执行 AI Agent。

AlphaPilot 是一个用 Binance Agent OS 官方原语构建的**策略执行 AI Agent**:机械策略产生信号后,
由 **LLM 分析师层做第二意见裁决**(批准 / 否决 / 降仓位),再经多层风控闸门,以 dry-run 或
真实模式执行订单,并把每一个决策——包括 AI 的自然语言推理——落盘成人类可读的审计日志。
内置回测引擎,回测与实盘跑的是**同一份**策略与风控代码。

## 为什么这算"用上了 Agent OS"

| Agent OS 组件 | AlphaPilot 的用法 |
|---|---|
| **Binance APIs**(`@binance/spot` 官方 SDK) | 行情(K线/价格)与订单执行的全部通道 |
| **Skills Hub 技能格式** | 本项目以标准 `skills/alphapilot/SKILL.md` 打包,可直接进 Skills Hub 生态 |
| **binance-cli 兼容面** | 同一套环境变量(`BINANCE_API_KEY` / `BINANCE_API_ENV`),CLI 语义对齐 |
| **MCP 接入路径** | Agent 的决策循环(`once`/`run`/`status`/`backtest`)可直接被任何 MCP 客户端当作工具调用 |

## 架构

```
            ┌──────────────────────────────────────────────────────────┐
            │                        AlphaPilot                         │
            │                                                          │
 klines ──▶ │  Market ──▶ Strategy ──▶ LLM ──▶ Risk ──▶ Executor       │
 (spot SDK) │  (observe)  (ensemble   analyst  (gate)   (dry-run /     │
            │              votes)     (2nd op)          live MARKET)   │
            │      │           │         │        │         │          │
            │      └───────────┴────┬────┴────────┴─────────┘          │
            │                  StateStore                              │
            │     (JSON ledger: trades + NL decision journal)          │
            └──────────────────────────────────────────────────────────┘
```

一次决策循环(`alphapilot once`):

1. **观察** — 拉取 symbol/interval 的 K线
2. **先管出场** — 持仓先过止损/止盈,再考虑新进场
3. **信号** — SMA 交叉(趋势)+ RSI 极值回归(震荡)投票,得分 ≥ 0.5 且无反对票才出手
4. **LLM 分析师** — 提议进场时,大模型收到行情上下文 + 双策略投票明细,输出
   `APPROVE / VETO / DOWNSIZE` 裁决与自然语言理由;被否决的交易直接拦截,
   被降仓的交易按调整后的置信度缩量。**无 API key 时自动降级为纯机械规则,零功能损失**
5. **风控闸门** — 仓位 = 权益 × 比例 × 置信度;日亏损上限、日笔数上限、单币种冷却、最小名义额、kill switch
6. **执行** — dry-run 按实时价模拟成交(默认),或 `@binance/spot` 真实 MARKET 单

## 快速开始

```bash
npm install

# 单次决策(默认 DRY-RUN + testnet,无需任何 API key)
npx alphapilot once

# AI 市场简报(需配 LLM_API_KEY,支持智谱/OpenAI/DeepSeek/Groq/Ollama)
npx alphapilot explain

# 30 天回测(真实历史K线)
npx alphapilot backtest --symbol BTCUSDT --interval 1h --days 30

# 持续运行(默认 60s 一轮)
npx alphapilot run

# 查看账本(含 LLM 裁决统计)/ 紧急停止
npx alphapilot status
npx alphapilot stop
```

**实盘(可选)**:复制 `.env.example` → `.env`,填入仅有现货交易权限的 API key
(务必关闭提币权限),设 `DRY_RUN=false`。`BINANCE_API_ENV=prod` 切主网。

**AI 层(可选)**:`LLM_PROVIDER`(zhipu/openai/deepseek/groq/ollama)+
`LLM_API_KEY`。不填则纯机械规则运行,`explain` 命令提示需要 key。

## 网页工作台

```bash
npm run workbench   # 打开 http://localhost:3210
```

浏览器看盘 + 结构化分析工作台：lightweight-charts 蜡烛图(MA7/25/99、S/R 价格线、斐波那契 0.618)、确定性规则引擎输出「趋势结构 / 多周期共振 / ATR 聚类支撑压力 / 摆动点自动斐波那契 / 观察计划(观察区·突破口·作废位·目标)」。LLM 仅基于规则数据撰写中文观察报告,不编造任何价位;右侧实时显示 Agent 账本与最近决策,支持一键急停。图表库已本地化分发(离线可用),页面自带渲染自检 beacon。

## 实测结果(测试网真实数据,2026-09-08)

| 回测 | 窗口 | 收益 | 笔数 | 胜率 | 最大回撤 |
|---|---|---|---|---|---|
| BTCUSDT 1h × 30d | 650 根K线 | +0.19% | 12 | 66.7% | 0.33% |
| ETHUSDT 1h × 30d | 650 根K线 | +0.24% | 4 | 50% | 0.21% |

LLM 分析师层验证:APPROVE / DOWNSIZE / VETO 三分支、置信度调整、自然语言决策日志、
`explain` 简报全链路通过(OpenAI 兼容协议)。仓位上限 10% × 置信度缩放,
故绝对收益温和、回撤极小——风控优先于收益,这是设计选择。

## 安全设计

- **无提币路径**:代码里根本不存在 withdrawal 调用;API key 只需要现货交易权限
- **dry-run 默认开**:不碰交易所的任何下单端点
- **kill switch**:环境变量或 `state/STOP` 文件,一键拒绝所有新订单
- **全量审计**:每个决策(OBSERVE / SIGNAL / RISK_BLOCK / ORDER_FILL)都写进 `state/agent-state.json`
- **testnet 优先**:默认环境是 `testnet.binance.vision`

## 项目结构

```
bin/alphapilot.js          CLI 入口(once / run / explain / backtest / status / stop)
src/config.js              .env + 环境变量 → 运行配置
src/market.js              行情层(@binance/spot: klines / ticker / account)
src/strategies/            策略层:sma-cross、rsi-reversion、ensemble
src/llm.js                 LLM 分析师层(OpenAI 兼容多提供商,VETO/DOWNSIZE 裁决)
src/risk.js                风控闸门与仓位管理
src/executor.js            执行层(dry-run 模拟 / 真实 MARKET 单)
src/agent.js               Agent 主循环
src/backtest.js            回测引擎(与实盘共用策略+风控代码)
src/state.js               JSON 账本与决策日志
skills/alphapilot/SKILL.md Binance Skills Hub 格式的技能包
```

## 声明

本项目为黑客松演示作品,不构成投资建议。加密货币交易风险极高,实盘请自担风险。
