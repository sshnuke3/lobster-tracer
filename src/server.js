// Lobster-Tracer D1+D2 主服务:Express 起服务 + SQLite + Stream Proxy
// D2 在 D1 基础上:加 /proxy/v1/chat/completions 路由 + 拆 db.js + 拆 proxy.js

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDB, listSessions, getSession, getStats, deleteSession, insertSession, insertEvent, insertTransition, getTransitionAggregate, hasRealTransitions, clearTransitions, getAggregateStats, completeSession, failSession } from './db.js';
import { handleProxy } from './proxy.js';
import { setupWS } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/lobster-tracer.db');

const app = express();

// [D15/中危-2] Railway 等反代后部署:启用 trust proxy,让 req.ip 反映真实客户端 IP,
// 限流按客户端区分(否则所有请求塌成反代内网 IP,限流退化成单一全局桶;且可防 XFF 伪造)
app.set('trust proxy', 1);

initDB(DB_PATH);

// [D12.5] demo 自动 seed:DEMO_MODE=1 且当前无真实迁移数据时,启动即灌示例数据
// 解决 Railway ephemeral 文件系统重启 / 重部署后 DB 清空 → 评审看到空白面板的问题
// 本地开发 / CI 不设 DEMO_MODE,不自动灌,避免污染
if (process.env.DEMO_MODE === '1' && !hasRealTransitions()) {
  seedDemoData();
  console.log('[demo] auto-seeded demo data (DEMO_MODE=1)');
}

// 中间件
// [D17/v5-4.2] CSP:脚本仅允许本站(ECharts 已本地化到 /vendor),另补基础安全头
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '1mb' })); // [AUDIT #9] 10mb→1mb,避免大 body 滥用
app.use(express.static(path.join(__dirname, '../public')));

// [AUDIT #6] 写接口最小鉴权:通过 ADMIN_TOKEN 环境变量校验 Bearer token
//   未设 ADMIN_TOKEN 时放行(本地开发友好);生产环境务必设置
function requireToken(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return next(); // 未配置则不强制(本地开发)
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== expected) return res.status(401).json({ error: 'unauthorized: invalid or missing ADMIN_TOKEN' });
  next();
}

// [AUDIT #4/限流] 轻量内存固定窗口限流(无新依赖);proxy 严格、其余宽松
function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map(); // key: ip -> { count, start }
  setInterval(() => hits.clear(), windowMs).unref(); // 窗口滚动清空,不阻塞进程退出
  return (req, res, next) => {
    // [D17/R4-02] 直接用 req.ip:trust proxy=1 下 Express 已取可信的最右侧 XFF;
    // 原手动 split(',')[0] 取最左段 = 攻击者可自带伪造 XFF 绕限流
    const k = req.ip || 'unknown';
    const now = Date.now();
    const rec = hits.get(k) || { count: 0, start: now };
    if (now - rec.start > windowMs) { rec.count = 0; rec.start = now; }
    rec.count++;
    hits.set(k, rec);
    if (rec.count > max) return res.status(429).json({ error: 'too many requests, slow down' });
    next();
  };
}
const limiterProxy = rateLimit({ windowMs: 60000, max: 20 });   // proxy: 20/min,防上游配额燃烧
const limiterGeneral = rateLimit({ windowMs: 60000, max: 120 }); // 其余: 120/min
app.use(limiterGeneral);

// /health 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lobster-tracer',
    version: '0.5.17',
    phase: 'D25-issues-fix',
    timestamp: new Date().toISOString(),
    db_stats: getStats()
  });
});

// /sessions 列表
// [AUDIT #3] 读取 offset 传给 listSessions; [AUDIT #12] limit clamp 到 [1,200] 防全表扫描
app.get('/sessions', (req, res) => {
  const rawLimit = parseInt(req.query.limit) || 50;
  const limit = Math.max(1, Math.min(200, rawLimit));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const sessions = listSessions(limit, offset);
  res.json({ sessions, count: sessions.length });
});

// /sessions/:id 详情
app.get('/sessions/:id', requireToken, (req, res) => {
  const result = getSession(req.params.id);
  if (!result) return res.status(404).json({ error: 'session not found' });
  res.json(result);
});

// D5/D6: 状态机定义 + 阶段迁移(参考主人 xiaoshuo-cli 真实长文工作流)
// 既含正常推进,也含 self-loop(大纲被打回/续写循环)与 error 恢复 —— 对应 README 的异常检测卖点
const PHASE_MACHINE = {
  phases: ['init', 'outline', 'outline_confirm', 'chapter_plan', 'chapter_gen', 'continue', 'verify', 'done', 'error'],
  transitions: [
    { from: 'init', to: 'outline', value: 12 },
    { from: 'outline', to: 'outline_confirm', value: 12 },
    { from: 'outline_confirm', to: 'chapter_plan', value: 10 },
    { from: 'outline_confirm', to: 'outline', value: 2 },   // 大纲被打回 → 自环
    { from: 'chapter_plan', to: 'chapter_gen', value: 10 },
    { from: 'chapter_gen', to: 'continue', value: 9 },
    { from: 'chapter_gen', to: 'error', value: 1 },          // 生成异常
    { from: 'continue', to: 'verify', value: 8 },
    { from: 'continue', to: 'chapter_gen', value: 1 },       // 续写循环
    { from: 'verify', to: 'done', value: 7 },
    { from: 'verify', to: 'continue', value: 1 },
    { from: 'error', to: 'chapter_gen', value: 1 },          // 异常恢复
    { from: 'chapter_gen', to: 'chapter_gen', value: 2 }      // 卡死自环(demo seed 体现, R3-04 对齐)
  ]
};

// D5/D6: 状态机定义接口(Sankey 可视化数据源)
// D7: 有真实迁移数据时返回聚合后的真实路径,否则回退到参考状态机(确保面板永远有图)
app.get('/analytics/statemachine', (req, res) => {
  if (hasRealTransitions()) {
    const { edges, phases } = getTransitionAggregate();
    res.json({
      source: 'real',
      phases,
      transitions: edges.map(e => ({ from: e.from, to: e.to, value: e.value, reasons: e.reasons })),
      reference: PHASE_MACHINE
    });
  } else {
    res.json({ source: 'reference', ...PHASE_MACHINE });
  }
});

// D10: 多会话聚合分析(Fleet 可观测性)—— 只读,与 /health 同级公开
app.get('/analytics/aggregate', (req, res) => {
  try {
    res.json(getAggregateStats());
  } catch (e) {
    console.error('[aggregate]', e.message);
    res.status(500).json({ error: 'internal server error' });
  }
});

// D7: 记录一次状态机迁移(上游长文工作流/多 Agent 系统的集成点)
// 请求体: { from, to, reason?, sessionId? }  —— xiaoshuo-cli 每次 phase 变更调用一次
// [AUDIT #4] 白名单校验 from/to:防止注入任意状态名污染 Sankey、撑爆 phases 集合
// [AUDIT #6] 加 requireToken 鉴权
app.post('/analytics/transition', requireToken, express.json(), (req, res) => {
  const { from, to, reason, sessionId } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const VALID = new Set(PHASE_MACHINE.phases);
  if (!VALID.has(from) || !VALID.has(to)) {
    return res.status(400).json({ error: `invalid phase, allowed: ${PHASE_MACHINE.phases.join(',')}` });
  }
  console.warn('[audit] transition', { from, to, sessionId });
  const id = insertTransition({ sessionId: sessionId || null, from, to, reason });
  res.json({ ok: true, id });
});

// D16: 长文 Agent 端到端 demo session —— 命中 Qoder 赛道叙事(多 Agent / 长时委派 / 自环检测)
// 每相邻 phase 对 → 一条 state_transition 事件;多 Agent 场景在 payload 带 agent/model 徽标
function seedLongAgentSession({ project, prompt, phases, durationMs, success, model, multiAgentMeta }) {
  const finalPhase = phases[phases.length - 1];
  const { id } = insertSession({
    project,
    phase: finalPhase,
    prompt,
    model: model || (multiAgentMeta ? multiAgentMeta[phases[1]]?.model : 'qwen3.7-flash'),
    metadata: multiAgentMeta ? { multiAgent: true, agents: multiAgentMeta } : undefined
  });
  for (let i = 0; i < phases.length - 1; i++) {
    const from = phases[i], to = phases[i + 1];
    const agentInfo = multiAgentMeta ? multiAgentMeta[to] : null;
    const payload = { from, to, reason: 'demo seed (long-agent)' };
    if (agentInfo) { payload.agent = agentInfo.agent; payload.model = agentInfo.model; }
    insertEvent({ sessionId: id, eventType: 'state_transition', payload });
  }
  insertEvent({ sessionId: id, eventType: 'chunk', payload: { text: `【${project}】……（示例产出）` } });
  if (success) {
    completeSession({ sessionId: id, response: `【${project}】……（示例产出）`, promptTokens: 1800, completionTokens: 6000, durationMs });
  } else {
    failSession({ sessionId: id, error: 'demo failure' });
  }
}

// D7/D12.5: 注入示例工作流(状态机迁移 + 示例会话),让 dashboard 全饱满
// 抽成 seedDemoData() 复用:POST /analytics/seed 手动触发,或 DEMO_MODE=1 启动时自动触发
function seedDemoData() {
  // 1) 状态机迁移(让 Sankey 立即有真实路径,含 self-loop 与 error 恢复)
  const steps = [
    ['init', 'outline', 'start'],
    ['outline', 'outline_confirm', 'outline ready'],
    ['outline_confirm', 'outline', 'user rejected outline (self-loop)'],
    ['outline_confirm', 'chapter_plan', 'approved'],
    ['chapter_plan', 'chapter_gen', 'plan ok'],
    ['chapter_gen', 'continue', 'chapter 1 done'],
    ['continue', 'verify', 'all chapters drafted'],
    ['verify', 'continue', 'quality gap → redo'],
    ['continue', 'chapter_gen', 'regenerate (loop)'],
    ['chapter_gen', 'error', 'upstream timeout'],
    ['chapter_gen', 'chapter_gen', 'stuck: regenerating same chapter (self-loop)'],
    ['error', 'chapter_gen', 'retry after error'],
    ['chapter_gen', 'continue', 'retry ok'],
    ['continue', 'verify', 're-verify'],
    ['verify', 'done', 'pass']
  ];
  for (let r = 0; r < 2; r++) {
    for (const [from, to, reason] of steps) insertTransition({ from, to, reason });
  }

  // 2) 示例会话(让会话列表 / 聚合面板饱满:覆盖完成 / 进行中 / 失败三种状态)
  const demoSessions = [
    {
      project: 'xiaoshuo-cli', model: 'qwen3.7-flash', phase: 'done', status: 'completed',
      prompt: '写一篇关于赛博朋克侦探的 3000 字短篇小说，先列大纲再逐章生成。',
      response: '霓虹在雨里晕开，他点燃最后一支烟……（示例正文）',
      promptTokens: 1280, completionTokens: 4200, durationMs: 38000
    },
    {
      project: 'xiaoshuo-cli', model: 'qwen3.6-plus', phase: 'chapter_gen', status: 'running',
      prompt: '生成第 5 章：主角潜入公司数据中心获取证据。',
      response: '通风管道很窄，他屏住呼吸向前爬……（示例中间产出）',
      promptTokens: 960, completionTokens: 3100, durationMs: 26000
    },
    {
      project: 'report-gen', model: 'qwen3.7-flash', phase: 'error', status: 'failed',
      prompt: '根据 Q2 销售数据生成季度复盘报告。',
      response: null, error: 'upstream timeout (demo)',
      promptTokens: 540, completionTokens: 0, durationMs: 12000
    }
  ];
  for (const ds of demoSessions) {
    const { id } = insertSession({ project: ds.project, phase: ds.phase, prompt: ds.prompt, model: ds.model });
    insertEvent({ sessionId: id, eventType: 'state_transition', payload: { from: 'init', to: ds.phase, reason: 'demo seed' } });
    if (ds.response) insertEvent({ sessionId: id, eventType: 'chunk', payload: { text: ds.response } });
    if (ds.status === 'completed') {
      completeSession({ sessionId: id, response: ds.response, promptTokens: ds.promptTokens, completionTokens: ds.completionTokens, durationMs: ds.durationMs });
    }
    if (ds.status === 'failed') {
      failSession({ sessionId: id, error: ds.error || 'demo failure' });
    }
  }

  // 3) 长文 Agent 端到端 session(评审引导用,命中 Qoder 赛道叙事)
  seedLongAgentSession({
    project: '写一篇 3000 字 AI 文章（顺畅完成）',
    prompt: '帮我写一篇 3000 字关于“AI Agent 时代开发者工作流变革”的长文',
    phases: ['init', 'outline', 'outline_confirm', 'chapter_plan', 'chapter_gen', 'chapter_gen', 'chapter_gen', 'continue', 'verify', 'done'],
    durationMs: 4800000, success: true, model: 'qwen3.7-flash'
  });
  seedLongAgentSession({
    project: '写作 Agent 卡壳实录：大纲被打回 3 次',
    prompt: '写一篇关于“AI 与人类协作未来”的长文，初次大纲被用户打回 3 次',
    phases: ['init', 'outline', 'outline_confirm', 'outline', 'outline', 'outline', 'outline_confirm', 'chapter_plan', 'chapter_gen', 'verify', 'done'],
    durationMs: 6200000, success: true, model: 'qwen3.7-flash'
  });
  seedLongAgentSession({
    project: 'AI 编辑部：三个 Agent 接力写文章',
    prompt: 'AI Agent 工具评测长文，3 个 Agent(outline / chapter_gen / verify)协作',
    phases: ['init', 'outline', 'outline_confirm', 'chapter_plan', 'chapter_gen', 'chapter_gen', 'chapter_gen', 'continue', 'verify', 'done'],
    durationMs: 5400000, success: true,
    multiAgentMeta: {
      outline:     { agent: 'outline_agent',     model: 'qwen3-max' },
      chapter_gen: { agent: 'chapter_gen_agent', model: 'claude-sonnet' },
      verify:      { agent: 'verify_agent',      model: 'qwen3-max' }
    }
  });
  // D19: 非写作场景 demo —— 证明可观测性引擎不止服务长文,任何 Agent 工作流都能用
  // phase 路径 init→analyze→review→fix→done 与写作流完全不同,点击该会话可见独立阶段迁移时间线
  seedLongAgentSession({
    project: '代码审查 Agent：自动 Review 并修 Bug',
    prompt: '对一个 PR 做代码审查，发现隐患后自动开修复分支并提交',
    phases: ['init', 'analyze', 'review', 'fix', 'done'],
    durationMs: 2100000, success: true,
    multiAgentMeta: {
      analyze: { agent: 'analyzer_agent', model: 'qwen3-max' },
      review:  { agent: 'reviewer_agent', model: 'claude-sonnet' },
      fix:     { agent: 'fixer_agent',    model: 'qwen3-max' }
    }
  });
  // D20: 生活类 demo —— 让非开发者评审/投票者一眼共鸣:AI 也能帮我规划旅行
  // phase 路径 init→ask_pref→search→plan→budget→plan(预算超支重排自环)→done,与写作/代码流完全不同
  seedLongAgentSession({
    project: 'AI 旅行规划师：帮我安排 5 天东京游',
    prompt: '帮我规划 5 天东京自由行：预算 ¥8000/人，喜欢动漫和美食，2 人行',
    phases: ['init', 'ask_pref', 'search', 'plan', 'budget', 'plan', 'plan', 'done'],
    durationMs: 3300000, success: true,
    multiAgentMeta: {
      ask_pref: { agent: 'pref_agent',    model: 'qwen3-max' },
      search:   { agent: 'search_agent',  model: 'qwen3.7-flash' },
      plan:     { agent: 'planner_agent', model: 'claude-sonnet' },
      budget:   { agent: 'budget_agent',  model: 'qwen3-max' }
    }
  });
}

app.post('/analytics/seed', requireToken, (req, res) => {
  seedDemoData();
  res.json({ ok: true, seeded: listSessions().length });
});

// D7: 清空真实迁移数据(demo 重置)
app.delete('/analytics/transitions', requireToken, (req, res) => {
  console.warn('[audit] clear transitions');
  clearTransitions();
  res.json({ ok: true });
});

// D3.5: DELETE /sessions/:id 级联删 session + events
app.delete('/sessions/:id', requireToken, (req, res) => {
  console.warn('[audit] delete session', req.params.id);
  const result = getSession(req.params.id);
  if (!result) return res.status(404).json({ error: 'session not found' });
  const r = deleteSession(req.params.id);
  res.json({ ok: true, deleted: r });
});

// D3.5: POST /sessions/:id/replay 用历史 prompt + model + metadata 再发一次
app.post('/sessions/:id/replay', requireToken, async (req, res) => {
  console.warn('[audit] replay session', req.params.id);
  const result = getSession(req.params.id);
  if (!result) return res.status(404).json({ error: 'session not found' });
  const s = result.session;
  // 复制原始 prompt + model + metadata
  const originalMeta = s.metadata ? (() => { try { return JSON.parse(s.metadata); } catch { return {}; } })() : {};
  req.body = {
    model: s.model || 'qwen3.7-flash',
    messages: [{ role: 'user', content: s.prompt }],
    stream: req.body?.stream ?? false,
    metadata: { ...originalMeta, replay_from: s.id, replay_at: new Date().toISOString() }
  };
  // 复用 D2 Stream Proxy
  return handleProxy(req, res);
});

// D2: Stream Proxy 路由 —— [AUDIT #2/P0] 限流 + 鉴权(ADMIN_TOKEN 未设则本地放行)
app.post('/proxy/v1/chat/completions', limiterProxy, requireToken, handleProxy);

const server = app.listen(PORT, () => {
  setupWS(server); // D8: WebSocket 挂在 http.Server 上,复用同端口实时推 chunk/状态变更到面板
  console.log(`\n🦞 Lobster-Tracer 启动成功 (D8)`);
  console.log(`   http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/proxy/v1/chat/completions`);
  console.log(`   POST http://localhost:${PORT}/analytics/transition  (上报 phase 迁移)`);
  console.log(`   POST http://localhost:${PORT}/analytics/seed        (注入示例工作流)`);
  console.log(`   ws://localhost:${PORT}                              (实时推送)`);
  console.log(`\nD8 验收:`);
  console.log(`   ✓ WebSocket 复用 HTTP 端口`);
  console.log(`   ✓ 落库即广播,面板无需轮询即时刷新`);
  console.log(`   ✓ 真实状态机迁移落库(transitions 表)`);
});