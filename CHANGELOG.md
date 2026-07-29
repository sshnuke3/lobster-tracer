# 📝 Lobster-Tracer 发布说明（Release Notes）

> 一句话更新文案：Lobster-Tracer 已升级为「AI Agent 可观测性引擎」——新增生活类 demo、代码审查 demo、默认模型切到 qwen3.7-flash、彻底禁用 qwen3.6-flash，并在聚合面板新增「回放建议」把自环卡死经验转化为可行动优化建议。

本文件按版本汇总 D16–D21 的变更，技术语言已翻译成人话，每条说明「对用户/评委有什么用」。

> ⚠️ 公网 demo（Railway）反映最近一次手动 Redeploy 的构建。代码已到 v0.5.18，如需最新特性请在 Railway 控制台对 `lobster-tracer` 点 **Redeploy** 拉取 `main`。

---

## v0.5.18 · D26 · 测试兜底（ISSUE-02 回放建议断言 + ISSUE-01 seed 回归）

### 🧪 测试（Trae issues 报告 ISSUE-02 / 顺带锁 ISSUE-01）
- **ISSUE-02 · 回放建议回归**：`test/smoke.mjs` 对 `GET /analytics/aggregate` 新增 3 条断言——`suggestions` 必须是数组、必须非空、且每条 suggestion 含 `phase/count/hint` 三字段。D23 的回放建议功能从此不被静默改坏。
- **ISSUE-01 · seed 回归**：对 `POST /analytics/seed` 新增断言——返回 `seeded` 必须是 `>0` 的数字，锁死 D25 修复，避免字段被悄悄删掉又回到 `undefined`。
- `npm test` 实测全过（含新增 4 断言）；当前 `suggestions` 非空条数为 1（写作类 `chapter_gen` 自环，符合 `transitions` 表白名单只含写作 phase 的事实）。

### 为什么这事重要（评委视角）
- 评审 issues 报告点名 smoke 缺 `suggestions` 断言，等于"功能上线但无人看守"。补上后，任何让回放建议失效的代码改动会在 CI 立刻红，不会带病进提交。

## v0.5.17 · D25 · 评审 issues 修复（3 处 open 项清零）

### 🛡️ 修复（Trae issues 报告 ISSUE-01 / 03 + 自评 stale 项）
- **ISSUE-03 · 回放建议 hint 字典补全**：`REPLAY_HINTS` 从仅 6 个写作 phase，扩展到覆盖代码审查 demo（`analyze` / `review` / `fix`）与旅行规划 demo（`ask_pref` / `search` / `plan` / `budget`）。评委打开非写作 demo 的自环卡死，现在看到的是针对性整改建议，而非通用兜底文案。
- **ISSUE-01 · `/analytics/seed` 缺 `seeded` 字段**：seed 路由现返回 `{ ok: true, seeded: listSessions().length }`，smoke 测试中 `assert(j.seeded)` 不再拿到 `undefined`。
- **首页 phase grid 校正**：`index.html` 的 `D7-D21` → `D7-D24`，与顶部 badge（已是 D24）自洽，并补述「代码审查 demo + 旅行规划 demo + 回放建议 + 代理层加固」。

### 为什么这事重要（评委视角）
- `REPLAY_HINTS` 缺口是这份报告里唯一「评委打开即见效」的硬伤——旅行规划 demo 的 `plan→plan` 预算超支自环，修复前只会显示"该阶段历史上卡死 N 次"的通用话术。现在命中即给"把预算硬约束前置进 planner"的精确建议，直接强化 Qoder 记忆引擎叙事。

## v0.5.16 · D24 · 代理层健壮性加固（proxy hardening）

### 🛡️ 修复（评审 🟡 中等项 M1 / M3 / M4）
- **M1 · 字符流 x 轴计数语义修正**：`chunkCount` 从「按 TCP 包计数」改为「按 SSE 事件计数」（`proxy.js` 中将自增移入 `handleLine`）。单 TCP 包内多个 `data:` 行现在各自递增 idx，dashboard 字符流时间线 x 轴不再出现重复 idx。
- **M3 · 会话终态写库加 try 保护**：`completeSession` / `failSession` 全部包进 `finishSession()` 保护器。DB 抖动（磁盘满 / 锁）不再让 session 永久卡在 `running`、也不再冒泡成 500 中断响应链路。
- **M4 · `end`/`error` 竞态短路**：新增 `closed` 标志，流式结束时若 `error` 先到也不会把 completed 覆盖回 failed（反之亦然），杜绝重复写终态。

### 为什么这事重要（评委视角）
- 之前若 demo 时 DB 偶发抖动，session 会卡死、评委点开显示"running"破功；竞态也可能让完成态被错误翻转。这三项把"演示雷"提前排掉，且对生产部署同样有价值（多进程 zero-downtime 部署残留老进程时尤其明显）。

## v0.5.15 · D23 · 回放建议（从观测到指导）

### ✨ 新功能
- **聚合面板新增「💡 回放建议」卡片**：基于历史 `self-loop` 数据，自动给每个曾卡死的 phase 生成可行动整改建议（如 `chapter_gen` 卡死 N 次 → "建议拆分章节粒度 / 设 max_retries 上限"）。
- 每条建议由已持久化的 `transitions` 历史推导，无需人工配置，开箱即有（demo 数据含自环，评委点开即见）。

### 为什么这事重要（命中 Qoder 记忆引擎 C3）
- 之前 Lobster-Tracer 只"观测"自环卡死；现在它能把历史卡死经验**转化为指导执行的建议**，补齐了评审点名的 C3 最弱项（原 5/10），从"看清 Agent 在做什么"进到"告诉 Agent 怎么改"。

### 对用户意味着什么
- 不再只是冷冰冰的"卡死 N 次"图表，而是直接告诉你"下一个 Agent 任务该怎么优化 prompt"。

---

## v0.5.14 · D21 · 默认模型切换 + 硬性禁用旧模型

### 🔧 优化
- **默认模型改为 `qwen3.7-flash`**：playground 下拉、历史筛选、所有 demo 与回放兜底统一使用新模型，无需手动选。
- **proxy 层硬性拦截 `qwen3.6-flash`**：任何请求旧模型的调用直接返回 `400 {error: "model is disabled"}`，在真实推理链路生效，不是表面提示。

### 对用户意味着什么
- 打开 playground 默认就是新模型，开箱即用。
- 旧模型被彻底封死，避免误用已弃用模型导致效果不稳。

---

## v0.5.13 · D20 · 第一个生活类 Demo（AI 旅行规划师）

### ✨ 新功能
- **新增「AI 旅行规划师：帮我安排 5 天东京游」端到端 demo**：`init → 问偏好 → 搜目的地 → 排行程 → 算预算 → 重排自环 → done`，4 个生活化 Agent（pref / search / planner / budget）。
- **特意设计「预算超支被打回重排」自环**（`plan → plan`），评委点开即可看到面板高亮「⚠️ 自环 = Agent 卡死信号」。
- `PHASE_ZH` 增加 `问偏好 / 搜目的地 / 排行程 / 算预算` 中文对照，时间线显示中文。

### 对用户意味着什么
- 终于有一个**非开发者也能秒懂**的 demo——旅游规划比写代码/写文章更有共鸣，证明可观测性引擎不局限于技术场景。

---

## v0.5.12 · D19 · 提交前收尾（通用性 + 文档自洽）

### ✨ 新功能
- **新增非写作场景 demo「代码审查 Agent：自动 Review 并修 Bug」**：`init → analyze → review → fix → done`，3 个 Agent（analyzer / reviewer / fixer），展示引擎对代码类工作流同样适用。

### 🔧 优化
- **补强 C3「记忆引擎」叙事**：把 `transitions` 持久化 ↔ Qoder 记忆引擎的数据基础讲透，提升赛道契合度论据。
- **新增「三步接入 Qoder Quest 模式」说明**：通过 `/analytics/transition` API 上报 phase，零源码改动集成。
- **文档自洽**：修正首页 phase grid 与 badge 不一致、README 甘特图误标「已提交 Qoder」等问题。

### 对用户意味着什么
- demo 从「全是写作」扩展到「写作 + 代码」，通用性一眼可见。
- 提交材料前后一致，评委不会看到版本/进度对不上的破绽。

---

## v0.5.11 · D18 · 叙事重构（定位升级）

### 🔧 优化
- **定位从「调试器」升级为「AI Agent 可观测性引擎」**：强调「让多 Agent 协作的每一步决策透明可追溯」，更贴 Qoder 赛道调性。
- **demo 生活化命名**：「写一篇 3000 字 AI 文章」「写作 Agent 卡壳实录」「AI 编辑部：三个 Agent 接力写文章」。
- **面板引导 + phase 中文对照（PHASE_ZH）**：Sankey 标签 / tooltip 显示中文，自环标注「⚠️ 自环 = Agent 卡死信号」。
- **新增「30 秒体验指南」横幅**，降低评委上手门槛。

### 对用户意味着什么
- 非技术评委也能一眼看懂产品价值，不用先懂「状态机」「可观测性」这些术语。

---

## v0.5.10 · D17 · 审计清零（安全加固）

### 🔧 优化
- **playground 鉴权透传修正**：DELETE / replay 正确携带 `Authorization`，修复「补丁被后置 header 覆盖」导致鉴权形同虚设的问题。
- **限流防 XFF 伪造**：限流 key 改用 `req.ip`（配合 `trust proxy`），伪造 `X-Forwarded-For` 无法绕过。
- **新增 CSP 安全头 + nosniff + Referrer-Policy**。
- **非流式超时闭环**：代理非流式响应包 `try/catch`，上游中断即 `504 + failSession`，不再卡死。
- **ECharts 本地化**（1MB 自托管），去掉外链 CDN 依赖，离线可用、加载更快。

### 🐛 修复
- smoke 测试新增「seed 后会话数 ≥ 6」断言，防止 demo 数据缺失回归。

### 对用户意味着什么
- 公开 demo 更安全，抗限流绕过、抗 XSS、抗资源耗尽；离线也能完整加载面板。

---

## v0.5.9 · D16 · demo 叙事增强（长文 Agent 端到端）

### ✨ 新功能
- **新增 3 个长文 Agent 端到端 demo session**：顺畅完成 / 卡壳被打回 3 次 / 三 Agent 接力写文章，多 Agent 元数据（agent + model）进入 `metadata` 与状态迁移事件。
- **冷启动遮罩**：首次加载显示引导遮罩，加载完成自动隐藏（60s 兜底），避免评委看到空白屏。
- **评审引导**：README 增加 5 分钟体验路线。

### 对用户意味着什么
- 评委打开即有真实可点的多 Agent 协作案例，不用自己造数据。

---

## ❓ 常见问题（FAQ）

**Q：这跟普通的 LLM 日志/trace 工具有什么区别？**
A：普通工具只做日志回放或 trace 树。Lobster-Tracer 额外做三件事：① 用状态机把抽象流程变成可度量的迁移路径；② 把「自环/回环」直接识别为卡死信号并高亮；③ 跨会话聚合出「哪个模型最耗 token、哪个 phase 最易卡死」的组织级知识。

**Q：公网 demo 需要登录吗？**
A：不需要。公开实例以 `DEMO_MODE=1` 启动，匿名开放并自动灌入 8 个示例会话，打开即用。

**Q：怎么接入我自己的 Agent / Qoder？**
A：Agent 每进入一个阶段，调用 `POST /analytics/transition` 上报 `{ from, to, reason, sessionId?, agent?, model? }` 即可，无需改 Qoder 源码；想观测新工作流，扩展 `PHASE_MACHINE.phases` 词表，Sankey 自动适配。

**Q：默认模型能改吗？**
A：可以。默认模型由 `proxy.js` 的 `DEFAULT_MODEL` 决定，也可用环境变量覆盖；`qwen3.6-flash` 已被硬性禁用（请求即 400）。

**Q：生产部署安全吗？**
A：所有写接口、proxy 与 WebSocket 都带鉴权，设置 `ADMIN_TOKEN` 后强制校验；建议同时设置 `WS_ALLOWED_ORIGIN` 防跨站订阅。公开 demo 为便于评审匿名开放，生产务必设强随机 `ADMIN_TOKEN`。
