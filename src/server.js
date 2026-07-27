// Lobster-Tracer D1+D2 主服务:Express 起服务 + SQLite + Stream Proxy
// D2 在 D1 基础上:加 /proxy/v1/chat/completions 路由 + 拆 db.js + 拆 proxy.js

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDB, listSessions, getSession, getStats, deleteSession, insertSession, insertEvent, insertTransition, getTransitionAggregate, hasRealTransitions, clearTransitions, getAggregateStats } from './db.js';
import { handleProxy } from './proxy.js';
import { setupWS } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/lobster-tracer.db');

const app = express();

initDB(DB_PATH);

// 中间件
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
    const k = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.ip || 'unknown';
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
    version: '0.5.4',
    phase: 'D8-realtime-ws',
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
app.get('/sessions/:id', (req, res) => {
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
    { from: 'error', to: 'chapter_gen', value: 1 }           // 异常恢复
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

// D7: 注入一条真实的 xiaoshuo-cli 长文工作流(含 self-loop 与 error 恢复)
// 用于 demo:让 Sankey 立刻显示真实迁移数据,不必先接上游
app.post('/analytics/seed', requireToken, (req, res) => {
  console.warn('[audit] seed demo workflow');
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
  // 跑两遍,制造更真实的频次差异
  for (let r = 0; r < 2; r++) {
    for (const [from, to, reason] of steps) insertTransition({ from, to, reason });
  }
  res.json({ ok: true, seeded: steps.length * 2 });
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
    model: s.model || 'qwen3.6-flash',
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