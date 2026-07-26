// Lobster-Tracer D2 模块:proxy.js - OpenAI 兼容 Stream Proxy
// 接收 /proxy/v1/chat/completions → 转发 OpenAI → 抓 chunk 落 DB → 流式返回

import { request } from 'undici';
import { insertSession, insertEvent, completeSession, failSession } from './db.js';

// OpenAI 上游配置 - 主人用环境变量注入
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export async function handleProxy(req, res) {
  const requestBody = req.body;
  const model = requestBody?.model || 'unknown';
  const isStream = !!requestBody?.stream;

  // 1. 启动 session
  const { id: sessionId } = insertSession({
    project: requestBody.metadata?.project || 'lobster-tracer',
    phase: requestBody.metadata?.phase || null,
    prompt: JSON.stringify(requestBody.messages || []).slice(0, 500),
    model,
    metadata: { isStream, proxy: 'lobster-tracer-d2' }
  });

  const startTime = Date.now();

  // 2. 失败兜底
  if (!OPENAI_API_KEY) {
    insertEvent({ sessionId, eventType: 'error', payload: { reason: 'OPENAI_API_KEY missing' } });
    failSession({ sessionId, error: 'OPENAI_API_KEY missing' });
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured in Railway env vars' });
  }

  insertEvent({ sessionId, eventType: 'proxy_forward', payload: { model, isStream, base: OPENAI_API_BASE } });

  // 3. 转发到 OpenAI
  let upstreamResponse;
  try {
    upstreamResponse = await request(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Accept': isStream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    insertEvent({ sessionId, eventType: 'error', payload: { phase: 'upstream_request', error: err.message } });
    failSession({ sessionId, error: err.message });
    return res.status(502).json({ error: err.message });
  }

  // 4. 流式响应 - 抓每个 chunk
  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);

    let fullResponse = '';
    let chunkCount = 0;

    upstreamResponse.body.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      fullResponse += chunkStr;
      chunkCount++;
      res.write(chunkStr);

      // D3.6: 每个 SSE chunk 真入库(拆 SSE 行,解析 data: {...} 拿 delta)
      // 优先解析流式 JSON,抓 delta.content 或 delta.reasoning_content
      try {
        const lines = chunkStr.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]'));
        for (const line of lines) {
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          const obj = JSON.parse(dataStr);
          const delta = obj.choices?.[0]?.delta || {};
          insertEvent({
            sessionId,
            eventType: 'chunk',
            payload: {
              idx: chunkCount,
              content_delta: delta.content || null,
              reasoning_delta: delta.reasoning_content || null,
              finish_reason: obj.choices?.[0]?.finish_reason || null,
              usage: obj.usage || null,
              model: obj.model || null,
              ts: Date.now()
            }
          });
        }
      } catch (e) {
        // 解析失败(可能 SSE 跨 chunk 拼接)→ 用 chunk_batch 替代
        insertEvent({
          sessionId,
          eventType: 'chunk_batch',
          payload: { chunks_so_far: chunkCount, last_chunk_size: chunk.length, parse_error: e.message }
        });
      }
    });

    upstreamResponse.body.on('end', () => {
      const durationMs = Date.now() - startTime;
      insertEvent({ sessionId, eventType: 'proxy_done', payload: { total_chunks: chunkCount, duration_ms: durationMs } });
      completeSession({
        sessionId,
        response: fullResponse.slice(0, 1000),
        promptTokens: 0,
        completionTokens: chunkCount,
        durationMs
      });
      res.end();
    });

    upstreamResponse.body.on('error', (err) => {
      insertEvent({ sessionId, eventType: 'error', payload: { phase: 'streaming', error: err.message } });
      failSession({ sessionId, error: err.message });
      res.end();
    });

  } else {
    // 5. 非流式响应
    const responseBody = await upstreamResponse.body.text();
    let parsed;
    try { parsed = JSON.parse(responseBody); } catch (e) { parsed = { raw: responseBody }; }
    const durationMs = Date.now() - startTime;

    insertEvent({
      sessionId,
      eventType: 'proxy_done',
      payload: { duration_ms: durationMs, response_size: responseBody.length }
    });

    completeSession({
      sessionId,
      response: responseBody.slice(0, 1000),
      promptTokens: parsed.usage?.prompt_tokens || 0,
      completionTokens: parsed.usage?.completion_tokens || 0,
      durationMs
    });

    res.setHeader('X-Session-Id', sessionId);
    res.status(upstreamResponse.statusCode).type('application/json').send(responseBody);
  }
}