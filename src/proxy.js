// Lobster-Tracer D4 模块:proxy.js - OpenAI 兼容 Stream Proxy
// 接收 /proxy/v1/chat/completions → 转发 OpenAI → 抓 chunk 落 DB → 流式返回
// D4 修复:① SSE 跨 TCP 包缓冲(不再丢被切开的 delta) ② 用 usage 字段真算 token
//        ③ 入库去截断(完整存 prompt/response) ④ 日志写失败绝不中断流式转发
// D7: ⑤ 会话启动时把 metadata.phase 作为首个真实迁移 init → phase 落库(让 Sankey 有真实数据)

import { request } from 'undici';
import { insertSession, insertEvent, completeSession, failSession, insertTransition } from './db.js';

// OpenAI 上游配置 - 主人用环境变量注入
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// D21: 默认模型 + 禁用模型清单(主人要求:默认 qwen3.7-flash,禁止 qwen3.6-flash)
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen3.7-flash';
const FORBIDDEN_MODELS = new Set(['qwen3.6-flash']);

// 安全写日志:任何 DB 异常都不应中断对流式响应的转发(日志是副产物,响应才是主链路)
function logEvent(sessionId, eventType, payload) {
  try { insertEvent({ sessionId, eventType, payload }); }
  catch (e) { console.error('[proxy] logEvent failed:', e.message); }
}

export async function handleProxy(req, res) {
  const requestBody = req.body;
  // D21: 缺省回退默认模型;若显式请求禁用模型则直接拒绝(硬拦截,真实推理链路生效)
  const requestedModel = requestBody?.model || DEFAULT_MODEL;
  if (FORBIDDEN_MODELS.has(requestedModel)) {
    return res.status(400).json({ error: `model "${requestedModel}" is disabled` });
  }
  const model = requestedModel;
  const isStream = !!requestBody?.stream;
  const reqPhase = requestBody?.metadata?.phase || null;

  // [D14/R3-03] 全局流式超时:防止慢速 / 挂死上游卡住 session、泄漏连接
  //   流式响应可能很久不结束,若不设上限会一直占用资源;超时即中止并标记失败
  const STREAM_TIMEOUT_MS = Number(process.env.STREAM_TIMEOUT_MS) || 300000; // 默认 5 分钟
  const controller = new AbortController();
  const streamTimeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  const cleanupTimeout = () => clearTimeout(streamTimeout);

  // 1. 启动 session(完整存 prompt,不再 slice(0,500) 截断)
  const { id: sessionId } = insertSession({
    project: requestBody.metadata?.project || 'lobster-tracer',
    phase: reqPhase,
    prompt: JSON.stringify(requestBody.messages || []),
    model,
    metadata: { isStream, proxy: 'lobster-tracer-d4' }
  });

  // D7: 首个真实迁移 —— 请求携带 phase 时记录 init → phase(即使 playground 也能生成真实边)
  if (reqPhase) {
    try { insertTransition({ sessionId, from: 'init', to: reqPhase, reason: 'session_start' }); }
    catch (e) { console.error('[proxy] insertTransition failed:', e.message); }
  }

  const startTime = Date.now();

  // [D24/M3+M4] 会话终态写库保护器:try 兜底(防 DB 抖动让 session 卡 running) + closed 短路(防 end/error 竞态重复写)
  let closed = false;
  const finishSession = (finalize) => {
    if (closed) return;
    closed = true;
    try { finalize(); }
    catch (e) { console.error('[proxy] finishSession failed:', e.message); }
  };

  // 2. 失败兜底
  if (!OPENAI_API_KEY) {
    cleanupTimeout();
    logEvent(sessionId, 'error', { reason: 'OPENAI_API_KEY missing' });
    finishSession(() => failSession({ sessionId, error: 'OPENAI_API_KEY missing' }));
    console.error('[proxy] OPENAI_API_KEY missing');
    return res.status(500).json({ error: 'service configuration error' }); // [AUDIT #3] 不泄露部署平台/配置
  }

  logEvent(sessionId, 'proxy_forward', { model, isStream, base: OPENAI_API_BASE });

  // 3. 转发到 OpenAI
  // hotfix(D8.1): 流式时默认注入 stream_options.include_usage —— 让"真 token 统计"自动生效,
  //   不覆盖客户端已显式设置的 stream_options(覆盖优先级: 客户端显式 > 服务端默认)
  const forwardBody = { ...requestBody };
  if (isStream) {
    forwardBody.stream_options = {
      ...(requestBody.stream_options || {}),
      include_usage: true
    };
  }
  let upstreamResponse;
  try {
    upstreamResponse = await request(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Accept': isStream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(forwardBody),
      signal: controller.signal // [D14/R3-03] 透传中止信号,超时即中断等待
    });
  } catch (err) {
    cleanupTimeout();
    if (err.name === 'AbortError') {
      logEvent(sessionId, 'error', { phase: 'upstream_request', error: 'stream timeout' });
      finishSession(() => failSession({ sessionId, error: 'stream timeout' }));
      console.error('[proxy] upstream request timeout', sessionId);
      return res.status(504).json({ error: 'upstream request timeout' });
    }
    logEvent(sessionId, 'error', { phase: 'upstream_request', error: err.message });
    finishSession(() => failSession({ sessionId, error: err.message }));
    console.error('[proxy] upstream request failed:', err.message);
    return res.status(502).json({ error: 'upstream request failed' }); // [AUDIT #3] 不泄露上游网络细节
  }
  // request 阶段成功;流式响应仍可能挂起,下面流式 / 非流分支在各自终态清理 streamTimeout

  // 4. 流式响应 - 抓每个 chunk
  if (isStream) {
    // [AUDIT #1] 透传上游状态码:避免 4xx/5xx 被当 200,客户端误判、会话误标 completed
    res.status(upstreamResponse.statusCode);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);
    // [AUDIT #2] 客户端断开时销毁上游流,防止 TCP 连接泄漏(长会话下耗尽连接池)
    res.on('close', () => { try { upstreamResponse.body.destroy(); } catch (_) { /* already closed */ } cleanupTimeout(); });

    let fullResponse = '';
    let chunkCount = 0;
    let sseBuffer = '';        // 跨 chunk 缓冲,解决 TCP 分包导致的 JSON 行被截断
    let capturedUsage = null;  // 流式 usage 通常在末包,抓到即存

    const handleLine = (dataStr) => {
      if (!dataStr || dataStr === '[DONE]') return;
      const idx = ++chunkCount;  // [D24/M1] 按 SSE-event 计数而非 TCP 包;EOF 尾部 flush 同样计
      try {
        const obj = JSON.parse(dataStr);
        const delta = obj.choices?.[0]?.delta || {};
        if (obj.usage) capturedUsage = obj.usage;
        logEvent(sessionId, 'chunk', {
          idx,
          content_delta: delta.content || null,
          reasoning_delta: delta.reasoning_content || null,
          finish_reason: obj.choices?.[0]?.finish_reason || null,
          usage: obj.usage || null,
          model: obj.model || null,
          ts: Date.now()
        });
      } catch (e) {
        // 仍解析不出(非标 SSE)→ 记 chunk_batch;但原始 delta 已在 fullResponse,不丢
        logEvent(sessionId, 'chunk_batch', {
          chunks_so_far: chunkCount, parse_error: e.message
        });
      }
    };

    upstreamResponse.body.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      fullResponse += chunkStr;
      res.write(chunkStr);

      // D4: 按行缓冲,只处理完整的 `data:` 行;残余半行留到下次或流结束再冲刷
      sseBuffer += chunkStr;
      let nl;
      while ((nl = sseBuffer.indexOf('\n')) !== -1) {
        const rawLine = sseBuffer.slice(0, nl);
        sseBuffer = sseBuffer.slice(nl + 1);
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        handleLine(line.slice(5).trim());
      }
    });

    upstreamResponse.body.on('end', () => {
      // 冲刷缓冲区里最后一行(可能被 EOF 截断在行尾)
      const tail = sseBuffer.trim();
      if (tail.startsWith('data:')) handleLine(tail.slice(5).trim());

      const durationMs = Date.now() - startTime;
      logEvent(sessionId, 'proxy_done', {
        total_chunks: chunkCount, duration_ms: durationMs, usage: capturedUsage
      });
      // D4: token 统计用真实 usage;流式若无 usage 则 completion_tokens 记 0(不再用 chunk 数冒充)
      // [D24/M3+M4] 终态写入包 try + closed 短路:DB 抖动不卡 running,end/error 竞态不重复写
      finishSession(() => completeSession({
        sessionId,
        response: fullResponse,           // 完整存,不再 slice(0,1000)
        promptTokens: capturedUsage?.prompt_tokens || 0,
        completionTokens: capturedUsage?.completion_tokens || 0,
        durationMs
      }));
      res.end();
      cleanupTimeout();
    });

    upstreamResponse.body.on('error', (err) => {
      logEvent(sessionId, 'error', { phase: 'streaming', error: err.message });
      // [D24/M3+M4] closed 短路:若 end 已先写终态,这里不再覆盖
      finishSession(() => failSession({ sessionId, error: err.message }));
      res.end();
      cleanupTimeout();
    });

  } else {
    // 5. 非流式响应
    // [D17/R4-07 修正版] body.text() 在超时 abort 时会 reject:不包 try/catch 会变 unhandled rejection
    let responseBody;
    try {
      responseBody = await upstreamResponse.body.text();
    } catch (err) {
      cleanupTimeout();
      const isAbort = err.name === 'AbortError' || /abort/i.test(err.message || '');
      const msg = isAbort ? 'stream timeout' : err.message;
      logEvent(sessionId, 'error', { phase: 'nonstream_body', error: msg });
      finishSession(() => failSession({ sessionId, error: msg }));
      console.error('[proxy] nonstream body read failed:', msg);
      return res.status(isAbort ? 504 : 502).json({ error: isAbort ? 'upstream request timeout' : 'upstream body read failed' });
    }
    cleanupTimeout();
    let parsed;
    try { parsed = JSON.parse(responseBody); } catch (e) { parsed = { raw: responseBody }; }
    const durationMs = Date.now() - startTime;

    logEvent(sessionId, 'proxy_done', { duration_ms: durationMs, response_size: responseBody.length, usage: parsed.usage || null });

    // [D24/M3] 终态写入包 try:DB 抖动也不让响应发送链路崩
    finishSession(() => completeSession({
      sessionId,
      response: responseBody,            // 完整存,不再 slice(0,1000)
      promptTokens: parsed.usage?.prompt_tokens || 0,
      completionTokens: parsed.usage?.completion_tokens || 0,
      durationMs
    }));

    res.setHeader('X-Session-Id', sessionId);
    res.status(upstreamResponse.statusCode).type('application/json').send(responseBody);
  }
}
