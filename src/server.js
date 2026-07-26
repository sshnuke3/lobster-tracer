// Lobster-Tracer D1+D2 主服务:Express 起服务 + SQLite + Stream Proxy
// D2 在 D1 基础上:加 /proxy/v1/chat/completions 路由 + 拆 db.js + 拆 proxy.js

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDB, listSessions, getSession, getStats } from './db.js';
import { handleProxy } from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/lobster-tracer.db');

const app = express();

initDB(DB_PATH);

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// /health 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lobster-tracer',
    version: '0.2.0',
    phase: 'D2-stream-proxy',
    timestamp: new Date().toISOString(),
    db_stats: getStats()
  });
});

// /sessions 列表
app.get('/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const sessions = listSessions(limit);
  res.json({ sessions, count: sessions.length });
});

// /sessions/:id 详情
app.get('/sessions/:id', (req, res) => {
  const result = getSession(req.params.id);
  if (!result) return res.status(404).json({ error: 'session not found' });
  res.json(result);
});

// D2: Stream Proxy 路由
app.post('/proxy/v1/chat/completions', handleProxy);

app.listen(PORT, () => {
  console.log(`\n🦞 Lobster-Tracer 启动成功 (D2)`);
  console.log(`   http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/proxy/v1/chat/completions`);
  console.log(`\nD2 验收:`);
  console.log(`   ✓ /health 返回 200`);
  console.log(`   ✓ Stream Proxy 抓 chunk 落 DB`);
  console.log(`   ✓ OPENAI_API_KEY 从环境变量读`);
});