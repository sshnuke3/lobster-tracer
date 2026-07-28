# 🦞 Lobster-Tracer

> AI Agent 可观测性引擎 — 让多 Agent 协作的每一步决策透明可追溯
> 可视化 · 异常检测 · 状态机建模 · 实时推送

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

## 🎯 产品定位

当 AI Agent 执行长任务（写长文、多轮协作、自动化工作流），你看不到它在做什么：

- 哪个 Agent 在哪个阶段卡住反复重试？
- 多个 Agent 接力时谁掉链子了？
- 一个长任务跑下来，token 烧在哪一步？

Lobster-Tracer 把 Agent 的每一次 LLM 调用、每一个状态迁移、每一次自环卡死，实时可视化成 **Sankey 流程图 + 阶段迁移时间线 + 聚合面板**。

**不再黑盒。**（辅助理解：它之于 Agent，就像 DevTools 之于网页——但定位是"Agent 运行就需要"的可观测性基础设施，不是"出了问题才用"的调试器。）

## 🦞 评审引导（5 分钟体验路线）

打开 [公网实例](https://lobster-tracer-production.up.railway.app/dashboard.html) → 面板已自动灌入 demo 数据，**无需注册/登录**。

**第 1 步 · 看全局**
- 下方 Sankey 状态机图展示 Agent 完整工作流：`init → outline → chapter_gen → verify → done`
- 注意 `chapter_gen → chapter_gen` 的自环边 —— 这就是"Agent 卡死"的可视化

**第 2 步 · 看多 Agent 协作**
- 左侧点「AI 编辑部：三个 Agent 接力写文章」
- 右侧「阶段迁移时间线」展示 3 个 Agent 接力：`outline_agent → chapter_gen_agent → verify_agent`
- 每个节点标注负责 Agent 和所用模型（qwen3-max / claude-sonnet）

**第 3 步 · 看异常检测**
- 点「写作 Agent 卡壳实录：大纲被打回 3 次」
- 大纲反复被打回 → Sankey 图里画出明显回环，聚合面板显示自环次数 Top —— Fleet 视角的 Agent 可观测性

**第 4 步 · 看实时推送**
- 右上角"实时"指示灯亮起 = WebSocket 已连接
- 新的 Agent 执行事件落库即广播，面板免轮询即时刷新

## 🚀 公网链接

https://lobster-tracer-production.up.railway.app

## 🛠️ 技术栈

- **后端**: Node.js 20 + Express + better-sqlite3 (WAL 模式)
- **前端**: 原生 HTML + ECharts 5(Sankey 状态机图 + chunk 字符流时间线)
- **代理**: undici 自写 OpenAI 兼容 Stream Proxy(不接 SDK,显技术深度;SSE 跨包缓冲 + 真实 token 统计)
- **部署**: Railway(免费档 $5/月赠额)

## 📦 快速开始

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 🔐 安全配置(公网部署必读)

D9 起所有写接口、`/proxy` 与 WebSocket 均已带鉴权,但**默认不强制**——仅在设置了环境变量后生效(本地开发零配置):

| 变量 | 作用 | 公网必设? |
|---|---|---|
| `ADMIN_TOKEN` | 写接口(`/proxy` + 5 个 analytics/delete/replay)与 WebSocket 的 Bearer / `?token=` 校验密钥 | 公开 demo **不设置**(实例匿名开放);生产部署 **必设** 强随机串 |
| `WS_ALLOWED_ORIGIN` | WebSocket 仅允许的来源,防跨站订阅(如 `https://lobster-tracer-production.up.railway.app`) | 建议 |

- **Railway(公开 demo)**:Variables 删掉 `ADMIN_TOKEN` + 新增 `DEMO_MODE=1` → 实例匿名开放且启动自动灌示例数据(重启自愈)。
- **Railway(生产)**:Variables 加 `ADMIN_TOKEN`(强随机串)+ `WS_ALLOWED_ORIGIN`(前端域名)→ 重新部署即收口。
- **本地**:`cp .env.example .env`(已被 `.gitignore` 忽略)填入 `ADMIN_TOKEN`,启动前 `set -a; . ./.env; set +a`(项目无 dotenv 自动加载)。
- 启用 `ADMIN_TOKEN` 后,打开 dashboard 需带 `?token=你的ADMIN_TOKEN` 才能建立 WS 实时连接;公开 demo 不设则直接访问。

## 📡 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 + DB 统计 |
| GET | `/sessions` | 列出所有会话 |
| GET | `/sessions/:id` | 单会话详情 + events 流 |
| GET | `/analytics/statemachine` | 状态机定义(Sankey 数据源;有真实迁移数据时返回聚合路径,否则回退参考状态机) |
| GET | `/analytics/aggregate` | 多会话聚合分析(token 汇总 / 各模型消耗 / 状态机自环卡死信号 / Top 会话排行),Fleet 可观测性(D10) |
| POST | `/analytics/transition` | 上报一次 phase 迁移 `{"from","to","reason?","sessionId?"}`(上游长文工作流的集成点) |
| POST | `/analytics/seed` | 注入一条示例 xiaoshuo-cli 工作流(含 self-loop + error 恢复),demo 用 |
| DELETE | `/analytics/transitions` | 清空真实迁移数据(demo 重置) |
| POST | `/proxy/v1/chat/completions` | OpenAI 兼容 Stream Proxy(请求带 `metadata.phase` 会自动落 `init→phase` 迁移) |
| WS | `ws://host/` | 实时推送:落库即广播 chunk/状态变更事件,调试面板订阅后免轮询即时刷新(D8) |
| GET | `/dashboard.html` | 📊 可视化调试面板(含"注入示例工作流"按钮 + 实时指示灯) |
| GET | `/playground.html` | ▶ Stream Proxy 测试 / 会话历史 |

## 🧪 测试

```bash
npm test   # 运行 test/smoke.mjs —— 子进程起服务,自动校验 /health /aggregate /statemachine /sessions + 写接口 401/200 鉴权,跑完清理临时库
```

冒烟脚本无新依赖(仅 Node 内置 `child_process` + `fetch`),临时库落在 `data/smoke-test.db`(已 gitignore),不污染真实数据。

## 📅 开发甘特图

| D | 日期 | 任务 | 状态 |
|---|---|---|---|
| D1 | 7.26 | 项目骨架 + SQLite 建表 + Express 起服务 | ✅ |
| D2 | 7.27 | F1 OpenAI 兼容 Stream Proxy(undici 自写) | ✅ |
| D3 | 7.28 | F2 会话存储 + replay + 级联删 + chunk 落库 | ✅ |
| D4 | 7.29 | Proxy 加固:SSE 跨包缓冲 + 真实 usage token 统计 + 入库去截断 | ✅ |
| D5 | 7.30 | F3 状态机字段 + 阶段定义 | ✅ |
| D6 | 7.31 | F3 状态机可视化(ECharts Sankey + 字符流时间线) | ✅ |
| **D7** | **8.1** | **真实状态机迁移落库(transitions 表 + 聚合接口 + Sankey 切真实数据 + 示例注入)** | ✅ |
| **D8** | **8.2** | **WebSocket 实时推送(落库即广播,面板免轮询即时刷新 + 实时指示灯)** | ✅ |
| **D9** | **8.2** | **安全加固:合并多份审计修复(鉴权/限流/XSS 全转义/WS token+心跳/错误脱敏,剔除通配 CORS)** | ✅ |
| **D10** | **8.3** | **多会话聚合分析(跨会话 token 汇总 / 各模型消耗 / 状态机自环卡死信号 / Top 会话排行,Fleet 可观测性)** | ✅ |
| **D11** | **8.4** | **收尾工程:LICENSE 文件(MIT 全文)+ 最小冒烟测试(修审计 #18 零测试)** | ✅ |
| D12 | 8.5 | 残余安全加固(v3 审计报告):XSS + proxy 日志 + /sessions/:id 鉴权 | ✅ |
| D12.5 | 8.5 | demo 自动 seed + 单一公开实例(DEMO_MODE,满足赛事公开可访问要求) | ✅ |
| D13-14 | 8.6-7 | 作品使用手册(已完成) + 小红书图文笔记(待发) | ⏳ |
| **D15** | **8.9** | **提交 Qoder 赛道（表单待本人提交）** | ⏳ |
| D16 | 8.9 | demo 叙事增强：3 个长文 Agent session + 评审引导 + 冷启动遮罩（v0.5.9） | ✅ |
| D17 | 8.9 | 审计清零：playground 鉴权透传 + 限流防 XFF 伪造 + CSP 头 + 流式/非流超时闭环 + ECharts 本地化（v0.5.10） | ✅ |
| D18 | 8.9 | 叙事重构：定位改"Agent 可观测性引擎" + demo 生活化命名 + 面板引导/中文对照 + 30 秒体验指南（v0.5.11） | ✅ |
| D19 | 8.9 | 提交前收尾：加非写作代码审查 demo + C3 记忆叙事补强 + Qoder 集成说明 + 文档同步（v0.5.12） | ✅ |

## 🏆 参赛赛道

**Qoder — AI Agent 可观测性引擎 / 多 Agent 协作可视化 / 长期委托执行链路观测**

## 💡 Lobster-Tracer × Qoder：补全 Agent 可观测性的最后一环

| Qoder 提供 | Lobster-Tracer 补全 |
|---|---|
| Multi-Agent 协作编排 | 协作过程的**可视化** —— 谁在什么阶段做了什么，一目了然 |
| 长期委托执行 | 执行链路的**可观测性** —— 长任务卡在哪步、自环几次，实时可见 |
| 记忆与知识引擎 | 记忆的**持久化验证** —— 每次 LLM 调用全量落库，Agent 记忆不丢失 |
| 理解→规划→执行→验证→迭代 | 这个闭环的**状态机建模** —— Sankey 图把抽象流程变成可度量的迁移路径 |

**Qoder 让 Agent 能做事。Lobster-Tracer 让你看清 Agent 在做什么。**

技术上的底气：undici 自写 OpenAI 兼容 Stream Proxy（不接 SDK）、真实工作流状态机、实战踩过的 self-loop / 断流案例、抓→存→查→可视化→异常检测完整闭环。

### 🧠 记忆引擎：观测即沉淀（补强 C3 契合度）

Lobster-Tracer 不止"看"，更是 Agent 工作流的**记忆底座**：`transitions` 表持久化每一次 phase 迁移（含 agent / model / 耗时），`sessions` 表留存完整 prompt / response，可随时回溯任意历史决策。跨会话聚合（`/analytics/aggregate`）把"哪个模型最耗 token、哪个 phase 最易卡死"提炼为组织级知识——这正是 Qoder 记忆与知识引擎的**可验证数据基础**。

### 🔗 三步接入 Qoder Quest 模式

Lobster-Tracer 通过 `/analytics/transition` API 上报每个 phase，与任何多 Agent 系统解耦集成（无需改 Qoder 源码）：

1. Agent 每进入一个阶段，调用 `POST /analytics/transition` 上报 `{ from, to, reason, sessionId?, agent?, model? }`；
2. 面板实时渲染 Sankey / 阶段迁移时间线，卡死自环自动高亮；
3. 想观测别的 Agent 工作流，只需在 `PHASE_MACHINE.phases` 扩展阶段词表（如 `analyze` / `review` / `fix`），状态机与 Sankey 自动适配。

> 示例 demo「代码审查 Agent：自动 Review 并修 Bug」即用 `init → analyze → review → fix → done` 路径，证明可观测性引擎不限于长文写作，所有 Agent 工作流都能用。

## 📜 License

MIT

---

*更新时间: 2026-07-28*  
*版本 v0.5.12*  
*部署平台: Railway*
