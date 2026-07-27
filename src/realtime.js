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
export function setupWS(server) {
  wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    const handler = (m) => {
      try { ws.send(JSON.stringify(m)); } catch { /* 客户端断开,丢包即可 */ }
    };
    bus.on('msg', handler);
    // 连接即发一个握手帧,前端据此点亮"实时"指示灯
    try { ws.send(JSON.stringify({ type: 'connected' })); } catch { /* ignore */ }
    ws.on('close', () => bus.off('msg', handler));
    ws.on('error', () => bus.off('msg', handler));
  });
  return wss;
}
