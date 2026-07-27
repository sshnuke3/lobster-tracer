// Lobster-Tracer D2 模块:db.js - SQLite 操作封装
// 封装:open / insertSession / insertEvent / completeSession / failSession

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { broadcast } from './realtime.js';

let db;

export function initDB(dbPath) {
  // better-sqlite3 不会自动建父目录,首跑必须先确保 data/ 存在
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      phase TEXT,
      status TEXT DEFAULT 'running',
      prompt TEXT NOT NULL,
      response TEXT,
      model TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    -- FK 不自动建索引,events 按 session_id 查询频繁,显式建索引避免全表扫
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

    -- D7: 状态机迁移表(真实工作流路径,对应 Sankey 可视化)
    -- session_id 可空(工作流级迁移不依赖单次会话);删除会话时置 NULL 而非级联删
    CREATE TABLE IF NOT EXISTS transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      from_phase TEXT NOT NULL,
      to_phase TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transitions_session ON transitions(session_id);
  `);

  return db;
}

// 插入 session
export function insertSession({ project, phase, prompt, model, metadata }) {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, project, phase, status, prompt, model, started_at, metadata)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(id, project, phase || null, prompt, model, startedAt, metadata ? JSON.stringify(metadata) : null);
  return { id, startedAt };
}

// 插入 event(chunk/state_transition/error)
export function insertEvent({ sessionId, eventType, payload }) {
  db.prepare(`
    INSERT INTO events (session_id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, eventType, payload ? JSON.stringify(payload) : null, new Date().toISOString());
  // D8: 落库即广播,让 WebSocket 客户端(调试面板)即时收到 —— 不去重、不节流,保真
  // [AUDIT #9] 改异步广播:setImmediate 解耦,避免高频 chunk 下同步 emit 阻塞 DB 写线程
  try { setImmediate(() => broadcast('event', { sessionId, eventType, payload })); } catch { /* swallow */ }
}

// 完成 session
export function completeSession({ sessionId, response, promptTokens, completionTokens, durationMs }) {
  db.prepare(`
    UPDATE sessions
    SET status = 'completed', response = ?, prompt_tokens = ?, completion_tokens = ?, duration_ms = ?, finished_at = ?
    WHERE id = ?
  `).run(response, promptTokens, completionTokens, durationMs, new Date().toISOString(), sessionId);
}

// 失败 session
export function failSession({ sessionId, error }) {
  db.prepare(`
    UPDATE sessions
    SET status = 'failed', error = ?, finished_at = ?
    WHERE id = ?
  `).run(error, new Date().toISOString(), sessionId);
}

// D3.5: 删除 session(级联删 events)
// [AUDIT #8] 包进事务:避免删 events 后第二步失败留下孤儿 session(无 events)
export function deleteSession(id) {
  const tx = db.transaction(() => {
    const result = db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
    const eventsDeleted = result.changes;
    const r2 = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    const sessionDeleted = r2.changes;
    return { sessionDeleted, eventsDeleted };
  });
  return tx();
}

// 查询 sessions
// [AUDIT #3] 支持 offset:配合前端"加载更多",原实现忽略 offset 导致重复返回第一页
export function listSessions(limit = 50, offset = 0) {
  return db.prepare(`
    SELECT id, project, phase, status, model, prompt_tokens, completion_tokens,
           duration_ms, started_at, finished_at
    FROM sessions
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

// 查询 session 详情
export function getSession(id) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return null;
  const events = db.prepare(`
    SELECT id, event_type, payload, created_at
    FROM events
    WHERE session_id = ?
    ORDER BY id ASC
  `).all(id);
  return { session, events };
}

// 统计
export function getStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM sessions
  `).get();
}

// D7: 记录一次状态机迁移(from → to,reason 说明为何迁移)
export function insertTransition({ sessionId, from, to, reason }) {
  const id = db.prepare(`
    INSERT INTO transitions (session_id, from_phase, to_phase, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId ?? null, from, to, reason || null, new Date().toISOString());
  return id.lastInsertRowid;
}

// D7: 聚合真实迁移数据(供 Sankey 使用)。返回 { edges:[{from,to,value,reasons}], phases:[...] }
// 按 from→to 求和得到边权重;reasons 用 JSON_GROUP_ARRAY 合并为 JSON 数组
// [AUDIT #14] 改用 JSON_GROUP_ARRAY:原 GROUP_CONCAT 用逗号拼接,reason 含逗号时前端 split(',') 会误拆
export function getTransitionAggregate() {
  const rows = db.prepare(`
    SELECT from_phase as "from", to_phase as "to", COUNT(*) as value,
           JSON_GROUP_ARRAY(DISTINCT reason) as reasons_json
    FROM transitions
    GROUP BY from_phase, to_phase
    ORDER BY value DESC
  `).all();
  const edges = rows.map(r => {
    let reasons = '';
    try { reasons = JSON.parse(r.reasons_json || '[]').filter(Boolean).join(', '); } catch { reasons = ''; }
    return { from: r.from, to: r.to, value: r.value, reasons };
  });
  const phases = [...new Set(edges.flatMap(e => [e.from, e.to]))];
  return { edges, phases };
}

// D7: 真实迁移数据是否为空(决定 Sankey 用真实还是参考状态机)
export function hasRealTransitions() {
  const r = db.prepare('SELECT COUNT(*) as c FROM transitions').get();
  return r.c > 0;
}

// D7: 清空真实迁移数据(用于 demo 重置)
export function clearTransitions() {
  db.prepare('DELETE FROM transitions').run();
}

// D10: 多会话聚合分析(Fleet 可观测性)
// 跨全部会话汇总 token / 失败率 / 各模型消耗 / 状态机自环(长任务卡死信号) / Top 会话排行
// 全部参数化查询,无拼接 SQL
export function getAggregateStats() {
  const base = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(prompt_tokens), 0) AS total_prompt,
      COALESCE(SUM(completion_tokens), 0) AS total_completion,
      COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
      COALESCE(AVG(prompt_tokens), 0) AS avg_prompt,
      COALESCE(AVG(completion_tokens), 0) AS avg_completion,
      COALESCE(AVG(duration_ms), 0) AS avg_duration_ms,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
    FROM sessions
  `).get();

  const byModel = db.prepare(`
    SELECT model,
           COUNT(*) AS n,
           COALESCE(SUM(prompt_tokens), 0) AS prompt,
           COALESCE(SUM(completion_tokens), 0) AS completion,
           COALESCE(SUM(duration_ms), 0) AS duration_ms
    FROM sessions
    WHERE model IS NOT NULL AND model <> ''
    GROUP BY model
    ORDER BY n DESC
    LIMIT 12
  `).all();

  const byProject = db.prepare(`
    SELECT project, COUNT(*) AS n
    FROM sessions
    GROUP BY project
    ORDER BY n DESC
    LIMIT 12
  `).all();

  // 状态机自环:from_phase == to_phase 即"卡在同一阶段反复横跳"(长文任务典型卡死特征)
  const transitions = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN from_phase = to_phase THEN 1 ELSE 0 END) AS self_loops
    FROM transitions
  `).get();

  const selfLoopByPhase = db.prepare(`
    SELECT from_phase AS phase, COUNT(*) AS n
    FROM transitions
    WHERE from_phase = to_phase
    GROUP BY from_phase
    ORDER BY n DESC
    LIMIT 12
  `).all();

  const topSessions = db.prepare(`
    SELECT substr(id, 1, 8) AS id8, model, phase, status,
           (prompt_tokens + completion_tokens) AS total_tokens,
           (duration_ms / 1000.0) AS duration_s
    FROM sessions
    ORDER BY total_tokens DESC
    LIMIT 8
  `).all();

  const selfLoopRate = transitions.total
    ? (transitions.self_loops / transitions.total)
    : 0;

  return {
    base,
    byModel,
    byProject,
    transitions: {
      total: transitions.total || 0,
      self_loops: transitions.self_loops || 0,
      self_loop_rate: selfLoopRate
    },
    selfLoopByPhase,
    topSessions
  };
}
