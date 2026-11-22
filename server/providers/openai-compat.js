// OpenAI 兼容接口适配器（DeepSeek、Kimi、通义千问、GLM、豆包、硅基流动、OpenRouter、OpenAI、Gemini、Ollama）。

import OpenAI from 'openai';

/** 把各家不同形式的思考增量统一成字符串 */
function reasoningText(delta, field) {
  if (!field) return '';
  const v = delta?.[field] ?? (field === 'reasoning_content' ? delta?.reasoning : undefined);
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => x?.text || x?.summary || '').join('');
  return '';
}

/**
 * 流式调用。
 * conf: { preset, baseURL, model, apiKey, effort, maxTokens }
 * messages: [{ role, content, reasoning? }]（框架内部格式）
 * onDelta({ kind: 'reasoning' | 'text', text })
 */
export async function streamOpenAI(conf, system, messages, onDelta, signal) {
  const { preset } = conf;
  const client = new OpenAI({
    apiKey: conf.apiKey || 'not-needed',
    baseURL: conf.baseURL || preset.baseURL,
    maxRetries: 2,
    timeout: conf.timeoutMs || 180000,
  });
  const msgs = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant' && preset.echoReasoning && m.reasoning) {
      msgs.push({ role: 'assistant', content: m.content, [preset.reasoningField]: m.reasoning });
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  }
  const maxTokens = Math.max(conf.maxTokens || 16000, preset.minMaxTokens || 0);
  const body = {
    model: conf.model,
    messages: msgs,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    ...(preset.thinkingParams ? preset.thinkingParams(conf.effort || 'default') : {}),
  };

  const stream = await client.chat.completions.create(body, { signal });
  let text = '';
  let reasoning = '';
  let usage = null;
  let model = conf.model;
  for await (const chunk of stream) {
    if (chunk.model) model = chunk.model;
    const delta = chunk.choices?.[0]?.delta;
    const r = reasoningText(delta, preset.reasoningField);
    if (r) {
      reasoning += r;
      onDelta({ kind: 'reasoning', text: r });
    }
    if (delta?.content) {
      text += delta.content;
      onDelta({ kind: 'text', text: delta.content });
    }
    if (chunk.usage) usage = chunk.usage;
  }
  return {
    text,
    reasoning,
    model,
    usage: {
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cached: usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0,
      reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    message: { role: 'assistant', content: text, reasoning },
  };
}

/** 拉取接口上的模型列表 */
export async function listOpenAIModels(conf) {
  const client = new OpenAI({ apiKey: conf.apiKey || 'not-needed', baseURL: conf.baseURL || conf.preset.baseURL, timeout: 15000 });
  const out = [];
  for await (const m of client.models.list()) out.push(m.id);
  return out.sort();
}
