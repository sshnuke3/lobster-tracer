# 🦞 Lobster-Tracer

> **AI Agent 可观测性引擎** — 让多 Agent 协作的每一步决策透明、可追溯。

[![Version](https://img.shields.io/badge/version-0.5.20-blue)](https://github.com/sshnuke3/lobster-tracer)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Demo](https://img.shields.io/badge/demo-online-brightgreen)](https://lobster-tracer-production.up.railway.app)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

---

## 它解决什么问题

当 AI Agent 执行长任务（写长文、多轮协作、自动化工作流），你看不到它在做什么：

- 哪个 Agent 在哪个阶段卡住、反复重试？
- 多个 Agent 接力时，谁掉链子了？
- 一个长任务跑下来，token 烧在哪一步？

**Lobster-Tracer 把 Agent 的每一次 LLM 调用、每一个状态迁移、每一次自环卡死，实时可视化成 Sankey 流程图 + 阶段迁移时间线 + 聚合分析面板。**

它之于 Agent，就像 DevTools 之于网页——但定位是「Agent 运行就需要」的可观测性基础设施，不是「出了问题才用」的调试器。

**同类项目大多只做日志回放或 trace 树；Lobster-Tracer 额外做了三件事**：① 用**状态机建模**把抽象流程变成可度量的迁移路径；② 把「自环/回环」直接识别为**卡死信号**并高亮；③ 跨会话**聚合**出「哪个模型最耗 token、哪个 phase 最易卡死」的组织级知识。

## ✨ 功能特性

| 能力 | 说明 |
|---|---|
| 🔀 实时 Sankey 状态机图 | 把 Agent 的 phase 迁移画成可度量路径；`A → A` 自环边 = 「Agent 卡死」可视化信号 |
| 👥 多 Agent 协作时间线 | 每个节点标注负责 Agent + 所用模型，接力中谁掉链子一目了然 |
| 📊 聚合分析面板 | 跨会话 token 汇总 / 各模型消耗 / 自环 Top / 会话排行（Fleet 可观测性） |
| ⚡ WebSocket 实时推送 | 事件落库即广播，面板免轮询即时刷新，右上角「实时」指示灯 |
| 🔌 OpenAI 兼容 Stream Proxy | 自写 undici 代理，真实 token 统计；请求带 `metadata.phase` 自动落迁移 |
| 🚨 异常检测 | 自环 / 回环自动高亮，卡死与重试一目了然 |
| 🎲 一键 Demo | `DEMO_MODE=1` 启动自动灌入 8 个示例会话（写作 / 代码审查 / 旅行规划） |

## 🚀 30 秒上手

```bash
npm install
npm start
# 打开 http://localhost:3000/dashboard.html
```

把你的 LLM 调用改成走 Lobster-Tracer 的 proxy，并带上 `metadata.phase`，状态迁移就会被自动记录：

```js
await fetch('http://localhost:3000/proxy/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen3.7-flash',
    stream: true,
    messages: [{ role: 'user', content: '写一篇 3000 字文章' }],
    metadata: { phase: 'chapter_gen' }   // ← 这一步会被自动记录为状态迁移
  })
});
```

刷新 dashboard，Sankey 图里立刻多了一条路径。

## 📦 安装（分场景）

| 场景 | 做法 |
|---|---|
| **本地开发** | `npm install && npm start`，访问 `http://localhost:3000` |
| **公开 Demo（Railway）** | Variables 删掉 `ADMIN_TOKEN` + 加 `DEMO_MODE=1` → 匿名开放、启动自动灌示例数据 |
| **生产部署（Railway）** | Variables 加 `ADMIN_TOKEN`（强随机串）+ `WS_ALLOWED_ORIGIN`（前端域名）收口 |
| **容器部署** | `docker build -t lobster-tracer . && docker run -p 3000:3000 -e DEMO_MODE=1 lobster-tracer` |

> 公开 demo 默认不强制鉴权（仅设 `ADMIN_TOKEN` 后生效），本地开发零配置。详见下方「安全配置」。

## 🌐 公网链接

https://lobster-tracer-production.up.railway.app

## 🧭 评审引导（5 分钟体验路线）

打开 [公网实例](https://lobster-tracer-production.up.railway.app/dashboard.html)，面板已自动灌入 demo 数据，**无需注册/登录**。

1. **看全局** — Sankey 状态机图展示完整工作流 `init → outline → chapter_gen → verify → done`；注意 `chapter_gen → chapter_gen` 自环边 = 「Agent 卡死」可视化。
2. **看多 Agent 协作** — 点「AI 编辑部：三个 Agent 接力写文章」，右侧时间线展示 `outline_agent → chapter_gen_agent → verify_agent` 接力，每节点标注 Agent + 模型。
3. **看异常检测** — 点「写作 Agent 卡壳实录：大纲被打回 3 次」，Sankey 画出明显回环，聚合面板显示自环次数 Top。
4. **看实时推送** — 右上角「实时」指示灯亮 = WebSocket 已连接，新事件落库即广播、面板免轮询刷新。

## 🛠️ 技术栈

- **后端**：Node.js 20 + Express + better-sqlite3（WAL 模式）
- **前端**：原生 HTML + ECharts 5（Sankey 状态机图 + chunk 字符流时间线）
- **代理**：undici 自写 OpenAI 兼容 Stream Proxy（不接 SDK；SSE 跨包缓冲 + 真实 token 统计）
- **部署**：Railway / Docker（免费档即可）

## 📡 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 + DB 统计 |
| GET | `/sessions` | 列出所有会话 |
| GET | `/sessions/:id` | 单会话详情 + events 流 |
| GET | `/analytics/statemachine` | 状态机定义（Sankey 数据源；有真实迁移数据时返回聚合路径） |
| GET | `/analytics/aggregate` | 多会话聚合分析（token 汇总 / 模型消耗 / 自环卡死信号 / Top 会话），Fleet 可观测性 |
| POST | `/analytics/transition` | 上报一次 phase 迁移 `{"from","to","reason?","sessionId?"}`（上游长文工作流集成点） |
| POST | `/analytics/seed` | 注入一条示例工作流（含 self-loop + error 恢复），demo 用 |
| DELETE | `/analytics/transitions` | 清空真实迁移数据（demo 重置） |
| POST | `/proxy/v1/chat/completions` | OpenAI 兼容 Stream Proxy（带 `metadata.phase` 自动落 `init→phase` 迁移） |
| WS | `ws://host/` | 实时推送：落库即广播事件，面板免轮询刷新 |
| GET | `/dashboard.html` | 📊 可视化面板（含「注入示例工作流」按钮 + 实时指示灯） |
| GET | `/playground.html` | ▶ Stream Proxy 测试 / 会话历史 |

## 🔐 安全配置（公网部署必读）

D9 起所有写接口、`/proxy` 与 WebSocket 均带鉴权，但**默认不强制**——仅在设置环境变量后生效（本地开发零配置）：

| 变量 | 作用 | 公网必设？ |
|---|---|---|
| `ADMIN_TOKEN` | 写接口与 WebSocket 的 Bearer / `?token=` 校验密钥 | 公开 demo **不设置**（匿名开放）；生产部署 **必设** 强随机串 |
| `WS_ALLOWED_ORIGIN` | WebSocket 仅允许的来源，防跨站订阅 | 建议 |

- **本地**：`cp .env.example .env`（已被 `.gitignore` 忽略）填入 `ADMIN_TOKEN`，启动前 `set -a; . ./.env; set +a`（项目无 dotenv 自动加载）。
- 启用 `ADMIN_TOKEN` 后，打开 dashboard 需带 `?token=你的ADMIN_TOKEN` 才能建立 WS 实时连接；公开 demo 不设则直接访问。

## 🏆 参赛赛道 & Qoder 共生

**Qoder — AI Agent 可观测性引擎 / 多 Agent 协作可视化 / 长期委托执行链路观测**

| Qoder 提供 | Lobster-Tracer 补全 |
|---|---|
| Multi-Agent 协作编排 | 协作过程的**可视化** —— 谁在什么阶段做了什么，一目了然 |
| 长期委托执行 | 执行链路的**可观测性** —— 长任务卡在哪步、自环几次，实时可见 |
| 记忆与知识引擎 | 记忆的**持久化验证** —— 每次 LLM 调用全量落库，Agent 记忆不丢失 |
| 理解→规划→执行→验证→迭代 | 这个闭环的**状态机建模** —— Sankey 把抽象流程变成可度量迁移路径 |

**Qoder 让 Agent 能做事。Lobster-Tracer 让你看清 Agent 在做什么。**

### 🧠 记忆引擎：观测即沉淀

`transitions` 表持久化每一次 phase 迁移（含 agent / model / 耗时），`sessions` 表留存完整 prompt / response，可随时回溯任意历史决策。跨会话聚合（`/analytics/aggregate`）把「哪个模型最耗 token、哪个 phase 最易卡死」提炼为组织级知识——正是 Qoder 记忆与知识引擎的**可验证数据基础**。

### 🔗 三步接入 Qoder Quest 模式

通过 `/analytics/transition` API 上报每个 phase，与任何多 Agent 系统解耦集成（无需改 Qoder 源码）：

1. Agent 每进入一个阶段，调用 `POST /analytics/transition` 上报 `{ from, to, reason, sessionId?, agent?, model? }`；
2. 面板实时渲染 Sankey / 阶段迁移时间线，卡死自环自动高亮；
3. 想观测别的 Agent 工作流，只需在 `PHASE_MACHINE.phases` 扩展阶段词表（如 `analyze` / `review` / `fix`），状态机与 Sankey 自动适配。

> 示例 demo「代码审查 Agent：自动 Review 并修 Bug」即用 `init → analyze → review → fix → done` 路径，证明可观测性引擎不限于长文写作。

## 🧪 测试

```bash
npm test   # 运行 test/smoke.mjs —— 自动校验 /health /aggregate /statemachine /sessions + 写接口 401/200 鉴权
```

冒烟脚本无新依赖（仅 Node 内置 `child_process` + `fetch`），临时库落在 `data/smoke-test.db`（已 gitignore），不污染真实数据。

## 🤝 贡献指南

1. Fork 本仓库并创建特性分支（`git checkout -b feat/xxx`）；
2. 本地 `npm install && npm start` 跑通，新增能力请补 smoke 断言（`test/smoke.mjs`）；
3. 提交信息遵循 `Dxx: 简述` 的阶段性约定，便于评委追溯开发脉络；
4. 发起 PR，描述「解决了什么 / 怎么验证」。

所有写接口与 WebSocket 默认不强制鉴权（仅 `ADMIN_TOKEN` 设置后生效），请勿在 PR 中提交任何密钥或 `.env`。

## 📜 License

[MIT](LICENSE)

---

*更新时间: 2026-07-30 · 版本 v0.5.20 · 部署平台: Railway*
