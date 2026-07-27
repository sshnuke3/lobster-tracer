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
  try { broadcast('event', { sessionId, eventType, payload }); } catch { /* swallow */ }
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
export function deleteSession(id) {
  const result = db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
  const eventsDeleted = result.changes;
  const r2 = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  const sessionDeleted = r2.changes;
  return { sessionDeleted, eventsDeleted };
}

// 查询 sessions
export function listSessions(limit = 50) {
  return db.prepare(`
    SELECT id, project, phase, status, model, prompt_tokens, completion_tokens,
           duration_ms, started_at, finished_at
    FROM sessions
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
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
// 按 from→to 求和得到边权重;reasons 用 GROUP_CONCAT 合并该边出现过的迁移原因
export function getTransitionAggregate() {
  const rows = db.prepare(`
    SELECT from_phase as "from", to_phase as "to", COUNT(*) as value,
           GROUP_CONCAT(DISTINCT reason) as reasons
    FROM transitions
    GROUP BY from_phase, to_phase
    ORDER BY value DESC
  `).all();
  const edges = rows.map(r => ({ from: r.from, to: r.to, value: r.value, reasons: r.reasons || '' }));
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
