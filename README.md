# 🦞 Lobster-Tracer

> AI 长文工作流可视化调试器 — 像浏览器 DevTools 看网络请求一样,看 AI 的 prompt / token 流 / 状态机迁移

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

## 🎯 产品定位

给跑 LLM 长任务的人用的 DevTools:
- 看 prompt / token 流(像 Chrome DevTools 的 Network)
- 看状态机迁移(像 Chrome DevTools 的 State)
- 异常检测(断流/超时/重复/JSON 解析失败)
- 一键导出诊断报告(Markdown / 小红书图文)

## 🚀 公网链接

https://lobster-tracer-production.up.railway.app

## 🛠️ 技术栈

- **后端**: Node.js 20 + Express + better-sqlite3 (WAL 模式) + WebSocket
- **前端**: 原生 HTML + Tailwind(待 D4 加)
- **可视化**: ECharts(待 D5-D6 加 sankey 状态机图)
- **代理**: undici 自写 OpenAI 兼容 Stream Proxy(不接 SDK,显技术深度)
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
| GET | `/sessions` | 列出所有会话(D2/D4 完善) |
| GET | `/sessions/:id` | 单会话详情 + events 流 |
| POST | `/proxy/v1/chat/completions` | OpenAI 兼容 Stream Proxy(D2 占位)|

## 📅 15 天开发甘特图

| D | 日期 | 任务 | 状态 |
|---|---|---|---|
| D1 | 7.26 | 项目骨架 + SQLite 建表 + Express 起服务 | ✅ |
| D2 | 7.27 | F1 OpenAI 兼容 Stream Proxy | ⏳ |
| D3 | 7.28 | F2 会话存储 | ⏳ |
| D4 | 7.29 | Web UI 基础 | ⏳ |
| D5 | 7.30 | F3 状态机字段 + 阶段定义 | ⏳ |
| D6 | 7.31 | F3 状态机可视化(ECharts sankey) | ⏳ |
| D7-D14 | 8.1-8 | 完善 + 部署 + 录 demo | ⏳ |
| **D15** | **8.9** | **提交 Qoder 赛道** | ⏳ |

## 🏆 参赛赛道

**Qoder — AI 长文工作流可视化调试器 / 多 Agent 协作 / 长期委托**

## 💡 为什么 Lobster-Tracer 适合 Qoder 赛道

1. **自己理解 OpenAI 兼容协议** — 用 undici 自写 Stream Proxy,不接 LangChain SDK
2. **真实工作流数据** — xiaoshuo-cli phase 状态机直接搬过来当 demo
3. **真实异常检测** — 主人实战踩的 self-loop / stream 协议断点 = 真实案例
4. **完整闭环** — 抓 → 存 → 查 → 可视化 → 异常检测 → 导出诊断报告
5. **WebSocket + ECharts + Node.js** = Qoder 评委最熟悉的技术栈

## 📜 License

MIT

---

*生成时间: 2026-07-26 15:39 CST*  
*D1 骨架版本 0.1.0*  
*部署平台: Railway*
