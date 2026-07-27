// Lobster-Tracer D8 模块:realtime.js - WebSocket 实时推送
// 用 EventEmitter 做进程内消息总线;db.js 在落库时 broadcast,WS 客户端订阅总线
// 这样面板不必轮询,chunk/状态变更即时推到前端 —— 调试器有"正在发生"的现场感

import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';

// 进程内总线(默认值 10 个 listener 上限在高频 chunk 下会告警,这里放开)
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// 任意模块调用 broadcast(type, payload) 即可向所有 WS 客户端推消息
export function broadcast(type, payload) {
  bus.emit('msg', { type, payload, ts: Date.now() });
}

let wss;

// 把 WebSocketServer 挂到已有的 http server 上(复用同一端口,免去额外端口/CORS)
// [AUDIT #11] origin 校验 + [AUDIT #2/P0] token 校验 + [AUDIT #3.5] 心跳 + 连接数上限
export function setupWS(server) {
  wss = new WebSocketServer({ server });
  const allowedOrigin = process.env.WS_ALLOWED_ORIGIN || null;  // 未设则放行(本地开发)
  const expectedToken = process.env.ADMIN_TOKEN || null;        // 未设则放行(本地开发)
  const MAX_CONN = parseInt(process.env.WS_MAX_CONNECTIONS) || 200;

  wss.on('connection', (ws, req) => {
    // 连接数上限(防耗尽)
    if (wss.clients.size > MAX_CONN) { ws.close(1008, 'too many connections'); return; }

    // origin 校验:拒绝非同源网页跨站窃听
    if (allowedOrigin) {
      const origin = req.headers.origin || '';
      if (origin && origin !== allowedOrigin) { ws.close(1008, 'origin not allowed'); return; }
    }

    // token 校验:?token=query 或 Authorization: Bearer header(与 ADMIN_TOKEN 对齐)
    if (expectedToken) {
      let qToken = '';
      try { qToken = new URL(req.url, 'http://localhost').searchParams.get('token') || ''; } catch { /* ignore */ }
      const hToken = (req.headers.authorization || '').startsWith('Bearer ')
        ? req.headers.authorization.slice(7) : '';
      if (qToken !== expectedToken && hToken !== expectedToken) { ws.close(1008, 'unauthorized'); return; }
    }

    // 心跳:30s ping,10s 内无 pong 则终止(清理僵尸连接)
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const hb = setInterval(() => {
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* ignore */ } return; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }, 30000);
    hb.unref();

    const handler = (m) => {
      try { ws.send(JSON.stringify(m)); } catch { /* 客户端断开,丢包即可 */ }
    };
    bus.on('msg', handler);
    // 连接即发一个握手帧,前端据此点亮"实时"指示灯
    try { ws.send(JSON.stringify({ type: 'connected' })); } catch { /* ignore */ }
    ws.on('close', () => { clearInterval(hb); bus.off('msg', handler); });
    ws.on('error', () => { clearInterval(hb); bus.off('msg', handler); });
  });
  return wss;
}
