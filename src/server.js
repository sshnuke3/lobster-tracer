// Lobster-Tracer D1 骨架:Express 起服务 + SQLite 建表 + /health 健康检查
// 设计目标:像浏览器 DevTools 看网络请求一样,看 AI 的 prompt / token 流 / 状态机迁移

import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/lobster-tracer.db');

// ============================================
// 1. SQLite 建表(D1 任务)
// ============================================
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// sessions 表:每次 LLM 调用 = 一行
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,           -- 项目名(Lobster-Tracer / xiaoshuo-cli / ...)
    phase TEXT,                      -- 状态机阶段(intake / outline / draft / review / publish)
    status TEXT DEFAULT 'running',   -- running / completed / failed / timeout
    prompt TEXT NOT NULL,            -- 输入 prompt(摘要)
    response TEXT,                   -- 输出 response(摘要)
    model TEXT,                      -- 使用的模型
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,   -- 耗时
    error TEXT,                      -- 异常信息
    started_at TEXT NOT NULL,
    finished_at TEXT,
    metadata TEXT                    -- JSON 额外字段
  )
`);

// events 表:每个 chunk / 每个状态迁移 = 一行(D2/D5 用)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,        -- chunk / state_transition / error / tool_call
    payload TEXT,                    -- JSON 详情
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);

console.log('✓ SQLite 表结构已建好 (sessions + events)');

// ============================================
// 2. Express 中间件
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ============================================
// 3. /health 健康检查(D1 验收:返回 200)
// ============================================
app.get('/health', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM sessions
  `).get();

  res.json({
    status: 'ok',
    service: 'lobster-tracer',
    version: '0.1.0',
    phase: 'D1-skeleton',
    timestamp: new Date().toISOString(),
    db_stats: stats
  });
});

// ============================================
// 4. /sessions 列出所有会话(简单版,Web UI D4 完善)
// ============================================
app.get('/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare(`
    SELECT id, project, phase, status, model, prompt_tokens, completion_tokens,
           duration_ms, started_at, finished_at
    FROM sessions
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit);
  res.json({ sessions: rows, count: rows.length });
});

// ============================================
// 5. /sessions/:id 单会话详情(简单版)
// ============================================
app.get('/sessions/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });

  const events = db.prepare(`
    SELECT id, event_type, payload, created_at
    FROM events
    WHERE session_id = ?
    ORDER BY id ASC
  `).all(req.params.id);

  res.json({ session, events });
});

// ============================================
// 6. /proxy/v1/chat/completions (D2 占位 — 明天实现 OpenAI 兼容 Stream Proxy)
// ============================================
app.post('/proxy/v1/chat/completions', (req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    message: 'D2 任务:明天实现 OpenAI 兼容 Stream Proxy',
    note: '今天 D1 骨架完成,/health 返回 200 + /sessions 列表可用'
  });
});

// ============================================
// 7. 启动服务
// ============================================
app.listen(PORT, () => {
  console.log(`\n🦞 Lobster-Tracer 启动成功`);
  console.log(`   http://localhost:${PORT}/health`);
  console.log(`   http://localhost:${PORT}/sessions`);
  console.log(`\nD1 验收:`);
  console.log(`   ✓ Express 起服务`);
  console.log(`   ✓ SQLite 建表 (sessions + events)`);
  console.log(`   ✓ /health 返回 200`);
  console.log(`\n下一步: D2 (7.27) 实现 OpenAI 兼容 Stream Proxy`);
});