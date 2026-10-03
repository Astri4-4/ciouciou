'use strict';

// Open WebUI's OpenAI-compatible API: model list and streamed chat completions.

const trim = (url) => url.replace(/\/+$/, '');

function httpError(status, detail) {
  const err = new Error(detail || `HTTP ${status}`);
  err.status = status;
  return err;
}

async function errorFrom(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.detail || body.error?.message || body.message || '';
  } catch {
    // Non-JSON error body; the status code will do.
  }
  if (res.status === 401 || res.status === 403) detail = 'API key rejected';
  return httpError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

const authHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.apiKey}` });

async function listModels(cfg, timeoutMs = 4000) {
  const res = await fetch(`${trim(cfg.url)}/api/models`, {
    headers: authHeaders(cfg),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await errorFrom(res);
  const body = await res.json();
  return (body.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
}

// Streams the assistant reply, calling onDelta with each text fragment.
async function streamChat(cfg, { model, messages, signal, onDelta }) {
  const res = await fetch(`${trim(cfg.url)}/api/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw await errorFrom(res);

  // Some pipelines/functions ignore stream:true and answer with one JSON body.
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content;
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    if (text) onDelta(text);
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(chunk.error.message || JSON.stringify(chunk.error));
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }
  }
}

module.exports = { listModels, streamChat };
