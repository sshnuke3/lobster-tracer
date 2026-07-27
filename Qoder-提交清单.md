# 🦞 Lobster-Tracer · Qoder 赛道提交清单（复制粘贴用）

> 赛道链接：https://survey.alibaba.com/apps/zhiliao/N-AebRVPx
> 比赛页：https://hackathon2026.app.weavefox.cn/
> 截止：2026-8-9 ｜ 当前代码版本 v0.5.9（D16，待 push；Railway 需 Redeploy 拉取）

下面每一项对应表单一个字段。**方括号 `[...]` 是需要你本人填写的个人信息**，其余可直接复制。

---

## 一、表单字段逐项填写

| # | 表单字段 | 类型 | 填写内容 |
|---|---|---|---|
| 1 | 我已阅读并知晓大赛规则，确认参赛 | ☑ 勾选框 | ✅ 勾选 |
| 2 | 我已知晓并同意，确认参赛 | ☑ 勾选框 | ✅ 勾选 |
| 3 | 您的姓名/昵称 | 文本 0/100 | `[你的昵称 / 姓名]` |
| 4 | 您的作品名称 | 文本 0/100 | `Lobster-Tracer` |
| 5 | 您的手机号 | 文本 0/100 | `[你的手机号]` |
| 6 | 您的作品功能描述 | 文本 0/1000 | 见下方「功能描述原文」 |
| 7 | 您的作品类型 | 单选 | **Web/H5** |
| 8 | 您的作品公网访问链接 | 文本 0/100 | `https://lobster-tracer-production.up.railway.app/dashboard.html` |
| 9 | 您的作品源代码或演示材料链接 | 文本 0/100 | `https://github.com/sshnuke3/lobster-tracer`（含使用手册.md） |
| 10 | 您的邮箱（绑定Qoder账号） | 文本 0/100 | `[你绑定 Qoder 的邮箱]` |
| 11 | 我承诺：作品为原创… | 单选 是/否 | **是** |

---

## 二、功能描述原文（直接复制，约 320 字，远低于 1000 上限）

```
Lobster-Tracer 是一个 AI 长文工作流可视化调试器，给跑 LLM 长任务（小说生成、报告撰写、多 Agent 协作）的人当 DevTools 用。它实时抓取每次 LLM 调用的 prompt、产出与 token 消耗，把长任务的阶段迁移（大纲→章节生成→校验→完成）画成 ECharts Sankey 流程图，自动检测卡死信号（状态机 self-loop、流式断流、上游超时），并通过 WebSocket 实时推送，将多个会话聚合成可观测面板（总 token、失败率、各模型消耗、自环 Top、会话排行）。后端 Node.js 20 + Express + better-sqlite3，前端原生 HTML + ECharts，代理用 undici 自写 OpenAI 兼容 Stream Proxy，已通过多轮独立安全审计并闭环修复。
```

---

## 三、提交前必须做的 3 件事（影响评审有效性）

1. **Railway 重新部署（重要）**
   - 当前公网实例仍跑旧版，代码已到 **v0.5.9**（D16：3 个长文 Agent session + 评审引导 + 冷启动遮罩；含 D14 XSS/超时 + D15 修复）。
   - 去 Railway 控制台对 `lobster-tracer` 点 **Redeploy**，拉取最新 main（含 D14–D16），使全部修复与 demo 叙事上线。
   - 验证：访问 `/dashboard.html` 看右上角版本号应为 `v0.5.9`。

2. **确保 GitHub 仓库公开**
   - 提交链接 `https://github.com/sshnuke3/lobster-tracer` 必须 `Public`，否则评委无法访问源码。
   - 如仓库私有，在 GitHub 设置里改为 Public，或改为指向使用手册/演示页。

3. **同步更新使用手册版本号（已完成）**
   - `使用手册.md` 已同步到 **v0.5.9** / D16，版本一致，评委不会看到版本错配。

---

## 四、赛事硬性要求完成度

| 要求 | 状态 | 说明 |
|---|---|---|
| 公网可访问链接 | ✅ | Railway demo，匿名可访问 |
| 作品使用手册 | ✅（待小修） | `使用手册.md`，需同步到 v0.5.8 |
| 小红书图文笔记（带 #外滩大会全民黑客松# #外滩大会AI Coding大赛#） | ⏳ 待发布 | 需在小红书发笔记并提交链接 |
| Qoder 信息清单（本表单） | ⏳ 待提交 | 即本文件内容 |

---

## 五、小红书笔记（下一步，待你确认文案后发布）

- 话题必须带：`#外滩大会全民黑客松#` + `#外滩大会AI Coding大赛#`
- 内容建议：1 句话定位 + 3 张图（dashboard 面板 / Sankey 状态机 / 聚合分析）+ 公网链接 + 核心亮点（实时 WebSocket、自写 Proxy、安全审计闭环）。
- 发布后把笔记链接回填到比赛「人气奖」报名页：https://fe.xiaohongshu.com/ditto/vincent/fe7df19060a54918bbc4537b1149af61

---

*本清单为复制粘贴参考，最终以你在 Qoder 表单实际填写并提交为准（提交可修改，以最后一次为准）。*
