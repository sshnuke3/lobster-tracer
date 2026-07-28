// Lobster-Tracer D11 冒烟测试(修审计 #18 零测试)
// 无新依赖:仅用 Node 内置 child_process + fetch
// 用法: npm test  (即 node test/smoke.mjs)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rmSync } from 'node:fs';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3993;
const TOKEN = 'smoke-test-token-' + Date.now();
// 落在 data/ 下(gitignore),避免污染真实库;initDB 会自动建父目录
const DB_PATH = path.join(ROOT, 'data', 'smoke-test.db');
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  rmSync(DB_PATH, { force: true });
  rmSync(DB_PATH + '-wal', { force: true });
  rmSync(DB_PATH + '-shm', { force: true });
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ADMIN_TOKEN: TOKEN, DB_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('server did not become healthy in time');
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}

async function main() {
  const server = startServer();
  let failed = 0;
  try {
    await waitHealth();

    console.log('1) GET /health');
    let r = await fetch(`${BASE}/health`);
    let j = await r.json();
    assert(r.ok && j.version, `/health ok, version=${j.version}`);
    assert(typeof j.db_stats === 'object', '/health returns db_stats');

    console.log('2) GET /analytics/aggregate (public, read-only)');
    r = await fetch(`${BASE}/analytics/aggregate`);
    j = await r.json();
    assert(r.status === 200, '/analytics/aggregate -> 200');
    assert(typeof j.base?.total === 'number', `aggregate base.total(sessions)=${j.base?.total}`);
    assert(typeof j.transitions?.self_loops === 'number', `aggregate transitions.self_loops=${j.transitions?.self_loops}`);
    assert(Array.isArray(j.byModel), 'aggregate byModel is array');
    assert(Array.isArray(j.topSessions), 'aggregate topSessions is array');

    console.log('3) GET /analytics/statemachine');
    r = await fetch(`${BASE}/analytics/statemachine`);
    j = await r.json();
    assert(r.ok && j.source, `statemachine source=${j.source}`);

    console.log('4) POST /analytics/seed WITH token -> 200');
    r = await fetch(`${BASE}/analytics/seed`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    j = await r.json();
    assert(r.status === 200 && j.ok, `seed ok (seeded=${j.seeded})`);

    console.log('4b) GET /analytics/statemachine after seed -> source=real');
    r = await fetch(`${BASE}/analytics/statemachine`);
    j = await r.json();
    // [D18/M-14] seed 后 Sankey 应切换到真实迁移数据源,而非回退参考状态机
    assert(r.ok && j.source === 'real', `statemachine source=real after seed (got ${j.source})`);

    console.log('5) DELETE /analytics/transitions WITHOUT token -> 401');
    r = await fetch(`${BASE}/analytics/transitions`, { method: 'DELETE' });
    assert(r.status === 401, `unauthorized 401 (got ${r.status})`);

    console.log('6) DELETE /analytics/transitions WITH token -> 200');
    r = await fetch(`${BASE}/analytics/transitions`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
    j = await r.json();
    assert(r.status === 200 && j.ok, 'authorized -> 200');

    console.log('7) GET /sessions (seed 后应 >=6: 3 基础 demo + 4 长文 Agent)');
    r = await fetch(`${BASE}/sessions?limit=100`);
    j = await r.json();
    assert(r.ok && Array.isArray(j.sessions), `/sessions -> 200 (count=${j.count})`);
    // [D17/R4-04] seed 后数据断言:确保 seedDemoData 真的灌了 6 个示例会话,而非仅接口 200
    assert(j.sessions.length >= 6, `seeded sessions >= 6 (got ${j.sessions.length})`);

    console.log('7b) GET /sessions/:id auth gate (no token -> 401, with token -> 404)');
    r = await fetch(`${BASE}/sessions/__nonexistent__`);
    assert(r.status === 401, `session detail without token -> 401 (got ${r.status})`);
    r = await fetch(`${BASE}/sessions/__nonexistent__`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert(r.status === 404, `session detail with token -> 404 not-found (got ${r.status})`);

    console.log('8) POST /analytics/transition WITH token -> 200');
    r = await fetch(`${BASE}/analytics/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ from: 'init', to: 'outline', reason: 'smoke' }),
    });
    assert(r.status === 200, `transition -> 200 (got ${r.status})`);

    // [D15/中危-1] WebSocket 鉴权端到端:无 token/错 token -> close 1008;正确 token -> connected 握手帧
    const wsUrl = (tok) => `ws://localhost:${PORT}${tok === undefined ? '' : `?token=${encodeURIComponent(tok)}`}`;
    const waitClose = (ws) => new Promise((res) => {
      ws.on('close', (code) => res(code));
      ws.on('error', () => {});
      setTimeout(() => res('timeout'), 3000);
    });
    const waitMsg = (ws) => new Promise((res) => {
      ws.on('message', (d) => { try { res(JSON.parse(d.toString())); } catch { res(d.toString()); } });
      ws.on('error', () => {});
      setTimeout(() => res('timeout'), 3000);
    });

    console.log('9) WS connect WITHOUT token -> close 1008');
    let c9 = await waitClose(new WebSocket(wsUrl()));
    assert(c9 === 1008, `WS no token -> 1008 (got ${c9})`);

    console.log('10) WS connect WITH correct token -> {type:"connected"}');
    let w10 = new WebSocket(wsUrl(TOKEN));
    let m10 = await waitMsg(w10);
    assert(m10 && m10.type === 'connected', `WS token -> connected (got ${JSON.stringify(m10)})`);
    w10.close();

    console.log('11) WS connect WITH wrong token -> close 1008');
    let c11 = await waitClose(new WebSocket(wsUrl('wrong-token')));
    assert(c11 === 1008, `WS wrong token -> 1008 (got ${c11})`);

    console.log('\n✅ ALL SMOKE TESTS PASSED');
  } catch (e) {
    console.error('\n❌ ' + e.message);
    failed++;
  } finally {
    server.kill('SIGTERM');
    rmSync(DB_PATH, { force: true });
    rmSync(DB_PATH + '-wal', { force: true });
    rmSync(DB_PATH + '-shm', { force: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
