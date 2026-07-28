# 🦞 Lobster-Tracer · Qoder 赛道提交清单（复制粘贴用）

> 赛道链接：https://survey.alibaba.com/apps/zhiliao/N-AebRVPx
> 比赛页：https://hackathon2026.app.weavefox.cn/
> 截止：2026-8-9 ｜ 当前代码版本 v0.5.13（D20 生活类 demo；Railway 需手动 Redeploy 拉取）

下面每一项对应表单一个字段。**方括号 `[...]` 是需要你本人填写的个人信息**，其余可直接复制。

---

## 一、表单字段逐项填写

| # | 表单字段 | 类型 | 填写内容 |
|---|---|---|---|
| 1 | 我已阅读并知晓大赛规则，确认参赛 | ☑ 勾选框 | ✅ 勾选 |
| 2 | 我已知晓并同意，确认参赛 | ☑ 勾选框 | ✅ 勾选 |
| 3 | 您的姓名/昵称 | 文本 0/100 | `[你的昵称 / 姓名]` |
| 4 | 您的作品名称 | 文本 0/100 | `Lobster-Tracer · AI Agent 可观测性引擎` |
| 5 | 您的手机号 | 文本 0/100 | `[你的手机号]` |
| 6 | 您的作品功能描述 | 文本 0/1000 | 见下方「功能描述原文」 |
| 7 | 您的作品类型 | 单选 | **Web/H5** |
| 8 | 您的作品公网访问链接 | 文本 0/100 | `https://lobster-tracer-production.up.railway.app/dashboard.html` |
| 9 | 您的作品源代码或演示材料链接 | 文本 0/100 | `https://github.com/sshnuke3/lobster-tracer`（含使用手册.md） |
| 10 | 您的邮箱（绑定Qoder账号） | 文本 0/100 | `[你绑定 Qoder 的邮箱]` |
| 11 | 我承诺：作品为原创… | 单选 是/否 | **是** |

---

## 二、功能描述原文（直接复制，约 700 字，低于 1000 上限）

```
【痛点】你让 AI Agent 写一篇 3000 字长文，它卡在哪一步？大纲改了 3 次你知道吗？3 个 Agent 接力时谁掉链子了？长任务跑下来，token 烧在哪一步？当 Agent 从"一句话问答"走向"长任务协作"，黑盒问题被放大 10 倍——你无法观测，就无法改进。

【方案】Lobster-Tracer 是 AI Agent 工作流的可观测性引擎。它把 Agent 的每一次 LLM 调用、每一个状态迁移、每一次自环卡死，实时可视化成 Sankey 流程图 + 阶段迁移时间线 + 聚合面板。核心能力：① 状态机建模——Agent 工作流抽象为 phase 状态机，Sankey 图实时展示迁移路径；② 异常检测——自环卡死（Agent 反复生成同一内容）、断流、超时自动可视化；③ 多 Agent 可视化——每个阶段标注负责 Agent 与所用模型；④ 实时推送——WebSocket 落库即广播，面板免轮询即时刷新；⑤ Fleet 可观测性——跨会话聚合 token / 失败率 / 各模型消耗 / 自环 Top。

【命中 Qoder 能力】Multi-Agent Collaboration → 协作过程可视化；Long-duration Execution → 长任务执行链路可观测；Memory & Knowledge → 每次 LLM 调用全量落库 + 状态机迁移持久化；理解→规划→执行→验证→迭代 → 完整闭环的状态机建模。Qoder 让 Agent 能做事，Lobster-Tracer 让你看清 Agent 在做什么。

【技术亮点】undici 自写 OpenAI 兼容 Stream Proxy（SSE 跨包缓冲 + 真实 token 统计）；better-sqlite3 WAL + 全参数化查询；WebSocket 四层防护（连接上限/origin/token/心跳）；内存固定窗口限流 + trust proxy 反代适配；CSP 安全头 + ECharts 本地化零 CDN 依赖；多轮独立安全审计闭环 + 冒烟测试覆盖核心路径与鉴权。

【体验入口】公网实例打开即用、无需注册，demo 自动灌数据（首访约 30-60s 冷启动，已加遮罩提示）。源代码 MIT 开源，含完整使用手册。
```

---

## 三、提交前必须做的 3 件事（影响评审有效性）

1. **Railway 重新部署（待你点）**
   - 当前公网实例仍为 **v0.5.12**（D19）。D20 生活类 demo（AI 旅行规划师）已 push 到最新 main，但 Railway **不会自动部署**（auto-deploy 关闭，已在 D15/D19 实测确认）。
   - 去 Railway 控制台对 `lobster-tracer` 点 **Redeploy**，拉取最新 main；验证 `/health` version=`0.5.13` 且会话列表出现「AI 旅行规划师：帮我安排 5 天东京游」。

2. **确保 GitHub 仓库公开**
   - 提交链接 `https://github.com/sshnuke3/lobster-tracer` 必须 `Public`，否则评委无法访问源码。
   - 如仓库私有，在 GitHub 设置里改为 Public，或改为指向使用手册/演示页。

3. **同步更新使用手册版本号（已完成）**
   - `使用手册.md` 已同步到 **v0.5.13** / D20，版本一致，评委不会看到版本错配。

---

## 四、赛事硬性要求完成度

| 要求 | 状态 | 说明 |
|---|---|---|
| 公网可访问链接 | ✅ | Railway demo，匿名可访问 |
| 作品使用手册 | ✅ | `使用手册.md`，已同步 v0.5.13（含 30 秒体验指南） |
| 小红书图文笔记（带 #外滩大会全民黑客松# #外滩大会AI Coding大赛#） | ⏳ 待发布 | 需在小红书发笔记并提交链接 |
| Qoder 信息清单（本表单） | ⏳ 待提交 | 即本文件内容 |

---

## 五、小红书笔记（下一步，待你确认文案后发布）

- 话题必须带：`#外滩大会全民黑客松#` + `#外滩大会AI Coding大赛#`
- 内容建议：1 句话定位 + 3 张图（dashboard 面板 / Sankey 状态机 / 聚合分析）+ 公网链接 + 核心亮点（实时 WebSocket、自写 Proxy、安全审计闭环）。
- 发布后把笔记链接回填到比赛「人气奖」报名页：https://fe.xiaohongshu.com/ditto/vincent/fe7df19060a54918bbc4537b1149af61

---

*本清单为复制粘贴参考，最终以你在 Qoder 表单实际填写并提交为准（提交可修改，以最后一次为准）。*
