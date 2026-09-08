# 黑客松提交清单(赛道 A)

截止:**2026-09-09 07:59 (UTC+8)** · 奖池 20,000 USDC(第1名 2,000 / 第2名 1,500 / 第3名 1,000 / 4–53名各 300)

## 必做步骤(需要你本人操作)

- [ ] **资格确认**:币安账户已完成 KYC;账户所在地区不在排除名单(US / UK / EEA / 香港 / 新加坡等)
- [ ] **关注 @binancezh 并转发**活动推文(https://x.com/binancezh/status/2095036992849653927)
- [ ] **把项目推到你的 GitHub**:
      ```
      cd C:\Users\Administrator\agentos\binance-agent
      git remote add origin https://github.com/<你的用户名>/alphapilot-agent.git
      git push -u origin main
      ```
- [ ] **录 Demo 视频**(可选加分):终端里跑 `node bin/demo.js`,全程约 60 秒,
      覆盖回测 → 实时决策 → 状态 → kill switch 四个环节
- [ ] **回复/引用原推文**提交作品:附 GitHub 链接 + 一句话介绍,例如:
      > "AlphaPilot — 用 Binance Agent OS 官方 @binance/spot SDK 打造的策略执行 Agent:
      > 信号→风控→执行→全量审计日志闭环,回测与实盘共用同一份代码。GitHub: <链接>"
- [ ] **填写官方表单**(推文中的 app.binance.com 链接,需要币安 UID)

## 提交前自查

- [ ] `.env` 不在 git 里(`.gitignore` 已配置,只提交 `.env.example`)
- [ ] `state/` 不在 git 里(本地账本)
- [ ] README 里的回测数据与最新一次运行一致
- [ ] 确认仓库可见性为 public

## 项目亮点(写推文/表单可用)

1. **真·Agent OS 原语**:官方 `@binance/spot` SDK、Skills Hub 技能格式打包、binance-cli 兼容的环境变量面
2. **回测=实盘**:同一份策略+风控代码,消除"回测很美、实盘翻车"的漂移
3. **风控优先**:日亏损上限、置信度加权仓位、冷却、kill switch、无提币路径
4. **全量审计**:每个决策落盘为人类可读 JSON 日志
5. **零门槛验证**:`npm install && npx alphapilot backtest` 即可在测试网真实数据上复现,不需要任何 API key
