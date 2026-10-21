function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  return '';
}

function partsOf(payload) {
  const choice = payload?.choices?.[0];
  const delta = choice?.delta || choice?.message || payload?.message || {};
  return {
    answer: textOf(delta.content || delta.text || payload?.output_text),
    reasoning: textOf(delta.reasoning_content || delta.reasoning || payload?.reasoning_content),
    cumulative: !choice?.delta
  };
}

async function readChatResponse(response, onUpdate = () => {}) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('event-stream')) {
    const raw = await response.text();
    if (raw.trimStart().startsWith('data:')) {
      return readSseText(raw, onUpdate);
    }
    const payload = JSON.parse(raw);
    if (payload?.error) throw new Error(payload.error.message || String(payload.error));
    const result = partsOf(payload);
    onUpdate(result);
    return result;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let reasoning = '';
  const consume = event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (payload?.error) throw new Error(payload.error.message || String(payload.error));
    const parts = partsOf(payload);
    if (parts.cumulative) {
      if (parts.answer) answer = parts.answer;
      if (parts.reasoning) reasoning = parts.reasoning;
    } else {
      answer += parts.answer;
      reasoning += parts.reasoning;
    }
    if (parts.answer || parts.reasoning) onUpdate({ answer, reasoning });
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r\n/g, '\n');
      const events = normalized.split('\n\n');
      buffer = events.pop();
      for (const event of events) consume(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    return { answer, reasoning };
  } finally {
    reader.releaseLock();
  }
}

async function readSseText(raw, onUpdate) {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } });
  return readChatResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), onUpdate);
}

module.exports = { readChatResponse, partsOf };
