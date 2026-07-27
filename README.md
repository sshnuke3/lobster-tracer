# 🦞 Lobster-Tracer

> AI 长文工作流可视化调试器 — 像浏览器 DevTools 看网络请求一样,看 AI 的 prompt / token 流 / 状态机迁移

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

## 🎯 产品定位

给跑 LLM 长任务的人用的 DevTools:
- 看 prompt / token 流(像 Chrome DevTools 的 Network)
- 看状态机迁移(像 Chrome DevTools 的 State · ECharts Sankey)
- 异常检测(断流/超时/重复/JSON 解析失败)
- 一键导出诊断报告(Markdown / 小红书图文)

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
| `ADMIN_TOKEN` | 写接口(`/proxy` + 5 个 analytics/delete/replay)与 WebSocket 的 Bearer / `?token=` 校验密钥 | **是** |
| `WS_ALLOWED_ORIGIN` | WebSocket 仅允许的来源,防跨站订阅(如 `https://lobster-tracer-production.up.railway.app`) | 建议 |

- **Railway**:Variables 加 `ADMIN_TOKEN`(强随机串)+ `WS_ALLOWED_ORIGIN`(前端域名)→ 重新部署即收口。
- **本地**:`cp .env.example .env`(已被 `.gitignore` 忽略)填入 `ADMIN_TOKEN`,启动前 `set -a; . ./.env; set +a`(项目无 dotenv 自动加载)。
- 启用 `ADMIN_TOKEN` 后,打开 dashboard 需带 `?token=你的ADMIN_TOKEN` 才能建立 WS 实时连接。

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
| D11 | 8.4 | 收尾工程:LICENSE 文件 + 最小冒烟测试(修审计 #18 零测试) | ⏳ |
| D12 | 8.5 | 一键导出诊断报告(Markdown / 小红书图文,对齐产品定位) | ⏳ |
| D13-14 | 8.6-7 | 录 2-3min demo + 写 Qoder 赛道 pitch | ⏳ |
| **D15** | **8.9** | **提交 Qoder 赛道** | ⏳ |

## 🏆 参赛赛道

**Qoder — AI 长文工作流可视化调试器 / 多 Agent 协作 / 长期委托**

## 💡 为什么 Lobster-Tracer 适合 Qoder 赛道

1. **自己理解 OpenAI 兼容协议** — 用 undici 自写 Stream Proxy,不接 LangChain SDK
2. **真实工作流数据** — xiaoshuo-cli phase 状态机直接搬过来当 demo(见 `/analytics/statemachine`)
3. **真实异常检测** — 主人实战踩的 self-loop / stream 协议断点 = 真实案例;状态机里专门画了自环与 error 恢复
4. **完整闭环** — 抓 → 存 → 查 → 可视化 → 异常检测 → 导出诊断报告
5. **ECharts + Node.js** = Qoder 评委最熟悉的技术栈

## 📜 License

MIT

---

*更新时间: 2026-07-27*  
*版本 v0.5.3*  
*部署平台: Railway*
