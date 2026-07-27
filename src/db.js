// Lobster-Tracer D2 模块:db.js - SQLite 操作封装
// 封装:open / insertSession / insertEvent / completeSession / failSession

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
