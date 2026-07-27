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

## 📡 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 + DB 统计 |
| GET | `/sessions` | 列出所有会话 |
| GET | `/sessions/:id` | 单会话详情 + events 流 |
| GET | `/analytics/statemachine` | 状态机定义(Sankey 数据源,参考 xiaoshuo-cli 真实工作流) |
| POST | `/proxy/v1/chat/completions` | OpenAI 兼容 Stream Proxy |
| GET | `/dashboard.html` | 📊 可视化调试面板 |
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
| D7-D14 | 8.1-8 | 完善 + 部署 + 录 demo | ⏳ |
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
*版本 v0.3.0*  
*部署平台: Railway*
